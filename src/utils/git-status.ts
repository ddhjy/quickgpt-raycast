/**
 * Git support for the Prompt Map page: finds the repositories the prompt
 * directories live in, reads their status, and runs the user's commit command.
 *
 * Used by the Prompt Map server bundle, so nothing here may import
 * `@raycast/api`.
 */

import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export type GitChangeKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "untracked"
  | "conflicted";

export interface GitChange {
  /** Path relative to the repository root, `/`-separated as git prints it. */
  path: string;
  /** Absolute path, translated back into the configured prompt directory when possible. */
  absPath: string;
  /** Previous path for renames and copies. */
  from?: string;
  /** Index (staged) status letter, `.` when unchanged. */
  index: string;
  /** Worktree (unstaged) status letter, `.` when unchanged. */
  worktree: string;
  kind: GitChangeKind;
  staged: boolean;
  unstaged: boolean;
}

export interface GitBranchInfo {
  /** Branch name; undefined when HEAD is detached. */
  head?: string;
  detached: boolean;
  /** True for a repository without any commit. */
  initial: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  /** Committer time in seconds since the epoch. */
  timestamp: number;
  author: string;
}

export interface GitRepoStatus extends GitBranchInfo {
  /** Absolute repository root as git reports it. */
  root: string;
  name: string;
  /** Prompt directories inside this repository, as configured. */
  roots: string[];
  changes: GitChange[];
  clean: boolean;
  lastCommit?: GitCommitInfo;
  error?: string;
}

export interface GitOverview {
  /** False when no git binary could be run. */
  available: boolean;
  repos: GitRepoStatus[];
  /** Prompt directories that are not inside any git repository. */
  unmanaged: string[];
  checkedAt: string;
  error?: string;
}

export interface GitOverviewOptions {
  env?: NodeJS.ProcessEnv;
  /** Timeout per git command. */
  timeoutMs?: number;
  now?: Date;
}

export interface ShellRunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  shell?: string;
  timeoutMs?: number;
  /** Characters kept from the end of each output stream. */
  maxOutputChars?: number;
}

export interface ShellRunResult {
  command: string;
  cwd: string;
  shell: string;
  /** Null when the process was killed by a signal or failed to start. */
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
const DEFAULT_GIT_TIMEOUT_MS = 15_000;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT = 20_000;
const GIT_MISSING_MESSAGE =
  "未找到可用的 git 命令，请安装 Xcode Command Line Tools（xcode-select --install）或 Homebrew 的 git";

/** PATH with the usual macOS tool locations appended, since Raycast's environment can be minimal. */
export function withToolPath(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const current = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const merged = [...current];
  for (const dir of EXTRA_PATH) if (!merged.includes(dir)) merged.push(dir);
  return { ...env, PATH: merged.join(path.delimiter) };
}

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** The user's login shell when it exists, otherwise zsh or sh. */
export function defaultShell(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
  for (const candidate of candidates) {
    if (candidate && path.isAbsolute(candidate) && isExecutableFile(candidate)) return candidate;
  }
  return "/bin/sh";
}

/** Splits a porcelain record into `count` space-separated fields and the remaining path. */
function splitFields(line: string, count: number): { fields: string[]; rest: string } | undefined {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const end = line.indexOf(" ", start);
    if (end === -1) return undefined;
    fields.push(line.slice(start, end));
    start = end + 1;
  }
  return { fields, rest: line.slice(start) };
}

export function classifyChange(index: string, worktree: string): GitChangeKind {
  if (index === "U" || worktree === "U" || (index === "A" && worktree === "A") || (index === "D" && worktree === "D")) {
    return "conflicted";
  }
  if (index === "R" || worktree === "R") return "renamed";
  if (index === "C" || worktree === "C") return "copied";
  if (index === "D" || worktree === "D") return "deleted";
  if (index === "A" || worktree === "A") return "added";
  if (index === "T" || worktree === "T") return "typechange";
  return "modified";
}

function parseBranchHeader(header: string, branch: GitBranchInfo): void {
  const space = header.indexOf(" ");
  const key = space === -1 ? header : header.slice(0, space);
  const value = space === -1 ? "" : header.slice(space + 1);
  switch (key) {
    case "branch.oid":
      branch.initial = value === "(initial)";
      break;
    case "branch.head":
      if (value === "(detached)") branch.detached = true;
      else branch.head = value;
      break;
    case "branch.upstream":
      branch.upstream = value;
      break;
    case "branch.ab": {
      const match = value.match(/\+(\d+) -(\d+)/);
      if (match) {
        branch.ahead = Number(match[1]);
        branch.behind = Number(match[2]);
      }
      break;
    }
  }
}

/**
 * Parses `git status --porcelain=v2 --branch -z` output. `absPathFor` turns a
 * repository-relative path into the absolute path shown to the page.
 */
export function parseGitStatus(
  output: string,
  absPathFor: (relativePath: string) => string = (relativePath) => relativePath,
): { branch: GitBranchInfo; changes: GitChange[] } {
  const branch: GitBranchInfo = { detached: false, initial: false, ahead: 0, behind: 0 };
  const changes: GitChange[] = [];
  const tokens = output.split("\0");

  const push = (index: string, worktree: string, kind: GitChangeKind, relativePath: string, from?: string): void => {
    changes.push({
      path: relativePath,
      absPath: absPathFor(relativePath),
      from,
      index,
      worktree,
      kind,
      staged: index !== "." && index !== "?",
      unstaged: worktree !== "." && worktree !== "?",
    });
  };

  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i];
    if (!line) continue;
    if (line.startsWith("# ")) {
      parseBranchHeader(line.slice(2), branch);
      continue;
    }
    const type = line[0];
    if (type === "?") {
      push("?", "?", "untracked", line.slice(2));
      continue;
    }
    if (type === "!") continue;
    if (type === "1") {
      const parsed = splitFields(line, 8);
      if (!parsed) continue;
      const [, xy] = parsed.fields;
      push(xy[0], xy[1], classifyChange(xy[0], xy[1]), parsed.rest);
      continue;
    }
    if (type === "2") {
      const parsed = splitFields(line, 9);
      if (!parsed) continue;
      const [, xy, , , , , , , score] = parsed.fields;
      // With -z the original path follows as its own NUL-terminated token.
      const from = tokens[++i] ?? "";
      const kind: GitChangeKind = score.startsWith("C") ? "copied" : "renamed";
      push(xy[0], xy[1], kind, parsed.rest, from);
      continue;
    }
    if (type === "u") {
      const parsed = splitFields(line, 10);
      if (!parsed) continue;
      const [, xy] = parsed.fields;
      push(xy[0], xy[1], "conflicted", parsed.rest);
    }
  }
  return { branch, changes };
}

class GitCommandError extends Error {
  constructor(
    message: string,
    public code: number | string | undefined,
    public stderr: string,
  ) {
    super(message);
  }
}

function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          const detail = (stderr || error.message).trim().split("\n")[0];
          reject(new GitCommandError(detail, code, stderr));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function realpathOr(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

async function readLastCommit(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<GitCommitInfo | undefined> {
  try {
    const output = await runGit(["log", "-1", "--format=%H%x1f%h%x1f%ct%x1f%an%x1f%s"], repoRoot, env, timeoutMs);
    const [hash, shortHash, timestamp, author, subject] = output.trim().split("\x1f");
    if (!hash) return undefined;
    return { hash, shortHash, timestamp: Number(timestamp), author, subject: subject ?? "" };
  } catch {
    // Repositories without commits have no log.
    return undefined;
  }
}

/**
 * Status of every git repository containing one of `roots` (configured
 * prompt directories). Roots sharing a repository are grouped.
 */
export async function collectGitOverview(
  roots: readonly string[],
  options: GitOverviewOptions = {},
): Promise<GitOverview> {
  const env = withToolPath(options.env ?? process.env);
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const checkedAt = (options.now ?? new Date()).toISOString();
  const unmanaged: string[] = [];
  const byRepo = new Map<string, { configured: string; real: string }[]>();
  let gitMissing: string | undefined;
  let firstError: string | undefined;

  for (const root of Array.from(new Set(roots))) {
    if (!isDirectory(root)) continue;
    try {
      const top = (await runGit(["rev-parse", "--show-toplevel"], root, env, timeoutMs)).trim();
      if (!top) {
        unmanaged.push(root);
        continue;
      }
      const list = byRepo.get(top) ?? [];
      list.push({ configured: root, real: realpathOr(root) });
      byRepo.set(top, list);
    } catch (error) {
      if (error instanceof GitCommandError && error.code === "ENOENT") {
        gitMissing = GIT_MISSING_MESSAGE;
        break;
      }
      // Anything other than "not a git repository" means git itself is unhealthy; report it rather than
      // silently treating the directory as unmanaged.
      if (error instanceof GitCommandError && !/not a git repository/i.test(error.stderr)) {
        firstError ??= /xcrun|xcode-select/i.test(error.stderr) ? GIT_MISSING_MESSAGE : error.message;
      }
      unmanaged.push(root);
    }
  }

  if (gitMissing) {
    return { available: false, repos: [], unmanaged: Array.from(new Set(roots)), checkedAt, error: gitMissing };
  }

  const repos = await Promise.all(
    Array.from(byRepo.entries()).map(async ([repoRoot, mappings]): Promise<GitRepoStatus> => {
      const absPathFor = (relativePath: string): string => {
        const real = path.join(repoRoot, relativePath);
        for (const mapping of mappings) {
          if (real === mapping.real) return mapping.configured;
          if (real.startsWith(mapping.real + path.sep)) return mapping.configured + real.slice(mapping.real.length);
        }
        return real;
      };
      const base: GitRepoStatus = {
        root: repoRoot,
        name: path.basename(repoRoot),
        roots: mappings.map((mapping) => mapping.configured),
        detached: false,
        initial: false,
        ahead: 0,
        behind: 0,
        changes: [],
        clean: true,
      };
      try {
        const [statusOutput, lastCommit] = await Promise.all([
          runGit(["--no-optional-locks", "status", "--porcelain=v2", "--branch", "-z"], repoRoot, env, timeoutMs),
          readLastCommit(repoRoot, env, timeoutMs),
        ]);
        const parsed = parseGitStatus(statusOutput, absPathFor);
        return { ...base, ...parsed.branch, changes: parsed.changes, clean: parsed.changes.length === 0, lastCommit };
      } catch (error) {
        return { ...base, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  repos.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return { available: true, repos, unmanaged, checkedAt, ...(firstError ? { error: firstError } : {}) };
}

/**
 * Runs `command` through a login shell in `cwd`, capturing output. Git is kept
 * non-interactive so a misconfigured command fails instead of hanging.
 */
export function runShellCommand(command: string, options: ShellRunOptions): Promise<ShellRunResult> {
  const env = withToolPath(options.env ?? process.env);
  const shell = options.shell ?? defaultShell(env);
  const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const maxOutput = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT;
  const started = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const keepTail = (current: string, chunk: string): string => {
      const next = current + chunk;
      return next.length > maxOutput ? next.slice(next.length - maxOutput) : next;
    };
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        cwd: options.cwd,
        shell,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    };

    let child: ReturnType<typeof spawn>;
    try {
      // Detached gives the shell its own process group, so a timeout can also
      // take down whatever it spawned (for example a hung `git push`).
      child = spawn(shell, ["-lc", command], {
        cwd: options.cwd,
        env: { ...env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error);
      resolve({
        command,
        cwd: options.cwd,
        shell,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
      return;
    }

    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => {
        if (!settled) killGroup("SIGKILL");
      }, 3000).unref();
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout = keepTail(stdout, chunk)));
    child.stderr?.on("data", (chunk: string) => (stderr = keepTail(stderr, chunk)));
    child.on("error", (error) => {
      stderr = keepTail(stderr, (stderr ? "\n" : "") + error.message);
      finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}
