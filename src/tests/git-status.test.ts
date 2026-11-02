import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  classifyChange,
  collectGitOverview,
  defaultShell,
  parseGitStatus,
  runShellCommand,
  withToolPath,
} from "../utils/git-status";

const HASH = "0".repeat(40);

/** Builds `git status --porcelain=v2 -z` output from records. */
const porcelain = (...records: string[]): string => records.map((record) => `${record}\0`).join("");

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const describeWithGit = hasGit ? describe : describe.skip;

describe("parseGitStatus", () => {
  it("reads branch headers", () => {
    const { branch, changes } = parseGitStatus(
      porcelain("# branch.oid abc123", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +2 -1"),
    );
    expect(branch).toEqual({
      head: "main",
      detached: false,
      initial: false,
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    });
    expect(changes).toEqual([]);
  });

  it("recognises detached heads and repositories without commits", () => {
    expect(parseGitStatus(porcelain("# branch.oid (initial)", "# branch.head main")).branch).toEqual({
      head: "main",
      detached: false,
      initial: true,
      ahead: 0,
      behind: 0,
    });
    expect(parseGitStatus(porcelain("# branch.oid abc123", "# branch.head (detached)")).branch).toEqual({
      detached: true,
      initial: false,
      ahead: 0,
      behind: 0,
    });
  });

  it("parses ordinary, renamed, unmerged, untracked and ignored records", () => {
    const { changes } = parseGitStatus(
      porcelain(
        `1 .M N... 100644 100644 100644 ${HASH} ${HASH} prompts/a b.hjson`,
        `1 A. N... 000000 100644 100644 ${HASH} ${HASH} prompts/new.hjson`,
        `1 MM N... 100644 100644 100644 ${HASH} ${HASH} prompts/both.hjson`,
        `1 .D N... 100644 100644 000000 ${HASH} ${HASH} prompts/gone.hjson`,
        `2 R. N... 100644 100644 100644 ${HASH} ${HASH} R100 prompts/renamed.hjson`,
        "prompts/original.hjson",
        `2 C. N... 100644 100644 100644 ${HASH} ${HASH} C90 prompts/copy.hjson`,
        "prompts/source.hjson",
        `u UU N... 100644 100644 100644 100644 ${HASH} ${HASH} ${HASH} prompts/conflict.hjson`,
        "? prompts/untracked dir/",
        "! prompts/ignored.hjson",
      ),
      (relativePath) => `/repo/${relativePath}`,
    );

    expect(changes.map((change) => [change.path, change.kind, change.staged, change.unstaged])).toEqual([
      ["prompts/a b.hjson", "modified", false, true],
      ["prompts/new.hjson", "added", true, false],
      ["prompts/both.hjson", "modified", true, true],
      ["prompts/gone.hjson", "deleted", false, true],
      ["prompts/renamed.hjson", "renamed", true, false],
      ["prompts/copy.hjson", "copied", true, false],
      ["prompts/conflict.hjson", "conflicted", true, true],
      ["prompts/untracked dir/", "untracked", false, false],
    ]);
    expect(changes[0].absPath).toBe("/repo/prompts/a b.hjson");
    expect(changes[0].index).toBe(".");
    expect(changes[0].worktree).toBe("M");
    expect(changes[4].from).toBe("prompts/original.hjson");
    expect(changes[5].from).toBe("prompts/source.hjson");
    expect(changes[7].index).toBe("?");
  });

  it("tolerates empty and malformed output", () => {
    expect(parseGitStatus("")).toEqual({
      branch: { detached: false, initial: false, ahead: 0, behind: 0 },
      changes: [],
    });
    expect(parseGitStatus(porcelain("1 .M", "2 R.", "u UU", "garbage")).changes).toEqual([]);
  });
});

describe("classifyChange", () => {
  it("maps status letters to change kinds", () => {
    expect(classifyChange(".", "M")).toBe("modified");
    expect(classifyChange("M", ".")).toBe("modified");
    expect(classifyChange("A", ".")).toBe("added");
    expect(classifyChange(".", "D")).toBe("deleted");
    expect(classifyChange("R", ".")).toBe("renamed");
    expect(classifyChange("C", ".")).toBe("copied");
    expect(classifyChange(".", "T")).toBe("typechange");
    expect(classifyChange("U", "U")).toBe("conflicted");
    expect(classifyChange("A", "A")).toBe("conflicted");
    expect(classifyChange("D", "D")).toBe("conflicted");
    // A deletion wins over a rename on the other side.
    expect(classifyChange("R", "D")).toBe("renamed");
    expect(classifyChange("A", "D")).toBe("deleted");
  });
});

describe("withToolPath / defaultShell", () => {
  it("appends the usual macOS tool directories once", () => {
    const env = withToolPath({ PATH: "/usr/bin:/custom" });
    const entries = env.PATH!.split(path.delimiter);
    expect(entries.slice(0, 2)).toEqual(["/usr/bin", "/custom"]);
    expect(entries.filter((entry) => entry === "/usr/bin")).toHaveLength(1);
    expect(entries).toContain("/opt/homebrew/bin");
    expect(entries).toContain("/bin");
  });

  it("falls back to an existing shell", () => {
    expect(defaultShell({ SHELL: "/nonexistent/shell" })).toMatch(/^\/bin\/(zsh|bash|sh)$/);
    expect(defaultShell({ SHELL: "relative/sh" })).toMatch(/^\/bin\/(zsh|bash|sh)$/);
    expect(defaultShell({ SHELL: "/bin/sh" })).toBe("/bin/sh");
  });
});

describeWithGit("collectGitOverview", () => {
  let dir: string;
  let repoDir: string;
  let promptsDir: string;
  let env: NodeJS.ProcessEnv;

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "quickgpt-git-status-"));
    // Isolate git from the user's global configuration (signing, hooks, default branch...).
    env = {
      ...process.env,
      HOME: dir,
      XDG_CONFIG_HOME: path.join(dir, "xdg"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    };
    repoDir = path.join(dir, "repo");
    promptsDir = path.join(repoDir, "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });
    git(repoDir, "init", "-q");
    git(repoDir, "symbolic-ref", "HEAD", "refs/heads/main");
    fs.writeFileSync(path.join(promptsDir, "a.hjson"), "[]\n");
    fs.writeFileSync(path.join(repoDir, "README.md"), "# prompts\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-q", "-m", "init prompts");
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports a clean repository with its last commit", async () => {
    const overview = await collectGitOverview([promptsDir], { env });
    expect(overview.available).toBe(true);
    expect(overview.unmanaged).toEqual([]);
    expect(overview.repos).toHaveLength(1);
    const [repo] = overview.repos;
    expect(repo.root).toBe(fs.realpathSync(repoDir));
    expect(repo.name).toBe("repo");
    expect(repo.roots).toEqual([promptsDir]);
    expect(repo.head).toBe("main");
    expect(repo.initial).toBe(false);
    expect(repo.detached).toBe(false);
    expect(repo.upstream).toBeUndefined();
    expect(repo.clean).toBe(true);
    expect(repo.changes).toEqual([]);
    expect(repo.lastCommit?.subject).toBe("init prompts");
    expect(repo.lastCommit?.author).toBe("Test");
    expect(repo.lastCommit?.shortHash).toMatch(/^[0-9a-f]{7,}$/);
    expect(repo.error).toBeUndefined();
  });

  it("maps changed paths back onto the configured prompt directory", async () => {
    fs.writeFileSync(path.join(promptsDir, "a.hjson"), "[ { title: A } ]\n");
    fs.writeFileSync(path.join(promptsDir, "b.hjson"), "[]\n");
    fs.writeFileSync(path.join(repoDir, "README.md"), "# changed\n");
    try {
      const [repo] = (await collectGitOverview([promptsDir], { env })).repos;
      expect(repo.clean).toBe(false);
      const byPath = new Map(repo.changes.map((change) => [change.path, change]));
      expect(Array.from(byPath.keys()).sort()).toEqual(["README.md", "prompts/a.hjson", "prompts/b.hjson"]);
      // The configured directory may differ from git's canonical root (macOS /var -> /private/var).
      expect(byPath.get("prompts/a.hjson")?.absPath).toBe(path.join(promptsDir, "a.hjson"));
      expect(byPath.get("prompts/a.hjson")?.kind).toBe("modified");
      expect(byPath.get("prompts/b.hjson")?.kind).toBe("untracked");
      expect(byPath.get("README.md")?.absPath).toBe(path.join(fs.realpathSync(repoDir), "README.md"));
    } finally {
      git(repoDir, "checkout", "-q", "--", ".");
      fs.rmSync(path.join(promptsDir, "b.hjson"), { force: true });
    }
  });

  it("groups several roots of the same repository and lists unmanaged ones", async () => {
    const otherDir = path.join(repoDir, "more");
    const plainDir = path.join(dir, "plain");
    fs.mkdirSync(otherDir);
    fs.mkdirSync(plainDir);
    try {
      const overview = await collectGitOverview([promptsDir, otherDir, plainDir, path.join(dir, "missing")], { env });
      expect(overview.repos).toHaveLength(1);
      expect(overview.repos[0].roots).toEqual([promptsDir, otherDir]);
      expect(overview.unmanaged).toEqual([plainDir]);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });

  it("handles repositories without any commit", async () => {
    const freshDir = path.join(dir, "fresh");
    fs.mkdirSync(freshDir);
    git(freshDir, "init", "-q");
    git(freshDir, "symbolic-ref", "HEAD", "refs/heads/main");
    try {
      const [repo] = (await collectGitOverview([freshDir], { env })).repos;
      expect(repo.initial).toBe(true);
      expect(repo.head).toBe("main");
      expect(repo.lastCommit).toBeUndefined();
      expect(repo.clean).toBe(true);
    } finally {
      fs.rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it("surfaces an unhealthy git instead of calling directories unmanaged silently", async () => {
    const fakeBin = path.join(dir, "fake-bin");
    fs.mkdirSync(fakeBin, { recursive: true });
    const fakeGit = path.join(fakeBin, "git");
    fs.writeFileSync(
      fakeGit,
      "#!/bin/sh\necho 'xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)' 1>&2\nexit 1\n",
    );
    fs.chmodSync(fakeGit, 0o755);
    const overview = await collectGitOverview([promptsDir], { env: { ...env, PATH: fakeBin } });
    expect(overview.available).toBe(true);
    expect(overview.repos).toEqual([]);
    expect(overview.unmanaged).toEqual([promptsDir]);
    expect(overview.error).toContain("xcode-select --install");
  });
});

describe("runShellCommand", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "quickgpt-shell-run-"));
    // A fresh HOME keeps the login shell from sourcing the developer's profile.
    env = { ...process.env, HOME: dir };
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("captures output, exit code and working directory", async () => {
    const result = await runShellCommand('echo "out $(pwd -P)" && echo err 1>&2 && exit 3', {
      cwd: dir,
      env,
      shell: "/bin/sh",
    });
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.shell).toBe("/bin/sh");
    expect(result.cwd).toBe(dir);
    expect(result.stdout.trim()).toBe(`out ${fs.realpathSync(dir)}`);
    expect(result.stderr.trim()).toBe("err");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps git non-interactive", async () => {
    const result = await runShellCommand("echo $GIT_TERMINAL_PROMPT $GIT_EDITOR", { cwd: dir, env, shell: "/bin/sh" });
    expect(result.stdout.trim()).toBe("0 true");
  });

  it("keeps only the tail of long output", async () => {
    const result = await runShellCommand("i=0; while [ $i -lt 400 ]; do echo line$i; i=$((i+1)); done", {
      cwd: dir,
      env,
      shell: "/bin/sh",
      maxOutputChars: 100,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeLessThanOrEqual(100);
    expect(result.stdout.trim().endsWith("line399")).toBe(true);
  });

  it("kills the whole process group on timeout", async () => {
    const started = Date.now();
    // `sleep` runs as a child of the shell here, so only a group kill ends it promptly.
    const result = await runShellCommand("sleep 20; echo never", {
      cwd: dir,
      env,
      shell: "/bin/sh",
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(result.stdout).not.toContain("never");
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 15_000);

  it("reports a shell that cannot be started", async () => {
    const result = await runShellCommand("true", { cwd: dir, env, shell: path.join(dir, "no-such-shell") });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toMatch(/ENOENT/);
  });
});
