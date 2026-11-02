import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import * as hjson from "hjson";
import {
  GIT_CONFIG_FILE,
  startPromptMapServer,
  TOKEN_HEADER,
  type PromptMapGitStatus,
  type RunningPromptMapServer,
} from "../prompt-map/server";
import type { ShellRunResult } from "../utils/git-status";

interface ApiResponse {
  ok: boolean;
  changed?: boolean;
  focusKey?: string;
  focusKeys?: string[];
  undoToken?: string;
  error?: string;
  model: { totals: { files: number; prompts: number } };
}

const readJson = async (response: Response): Promise<ApiResponse> => (await response.json()) as ApiResponse;

const LIBRARY = `[
  { title: Code
    subprompts: [
      { title: Plan
        content:
        '''
        Body {{i}}
        '''
      }
      { title: Second
        content: "Two"
      }
    ]
  }
]
`;

describe("prompt-map server", () => {
  let dir: string;
  let stateDir: string;
  let outsideFile: string;
  let libraryFile: string;
  let server: RunningPromptMapServer;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "quickgpt-map-server-"));
    const libraryDir = path.join(dir, "library");
    stateDir = path.join(dir, "state");
    fs.mkdirSync(libraryDir);
    libraryFile = path.join(libraryDir, "code.hjson");
    fs.writeFileSync(libraryFile, LIBRARY);
    outsideFile = path.join(dir, "outside.hjson");
    fs.writeFileSync(outsideFile, LIBRARY);
    const templatePath = path.join(dir, "index.html");
    fs.writeFileSync(
      templatePath,
      '<html><script id="d" type="application/json">/*__PROMPT_MAP_DATA__*/</script></html>',
    );
    server = await startPromptMapServer({
      sources: [libraryDir],
      editableRoots: [libraryDir],
      stateDir,
      templatePath,
      port: 0,
      idleTimeoutMs: 0,
    });
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const headers = () => ({ "Content-Type": "application/json", [TOKEN_HEADER]: server.token });
  const post = (route: string, body: unknown) =>
    fetch(`http://127.0.0.1:${server.port}${route}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

  it("requires the token", async () => {
    const page = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(page.status).toBe(403);
    const api = await fetch(`http://127.0.0.1:${server.port}/api/model`);
    expect(api.status).toBe(403);
  });

  it("serves the rendered page and the model with the token", async () => {
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('"editable":true');
    expect(html).toContain("Plan");

    const model = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/model`, { headers: headers() })
    ).json()) as ApiResponse["model"];
    expect(model.totals).toEqual({ files: 1, prompts: 3 });
  });

  it("updates a prompt, backs the file up and refuses stale expectations", async () => {
    const response = await post("/api/edit", {
      op: "update",
      file: libraryFile,
      indexPath: [0, 0],
      expect: { title: "Plan", content: "Body {{i}}" },
      content: "Body {{i}}\nSecond line",
    });
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.ok).toBe(true);
    expect(body.changed).toBe(true);
    expect(body.focusKey).toBe(`${libraryFile}#0.0`);
    const parsed = hjson.parse(fs.readFileSync(libraryFile, "utf8")) as { subprompts: { content: string }[] }[];
    expect(parsed[0].subprompts[0].content).toBe("Body {{i}}\nSecond line");
    expect(fs.readdirSync(path.join(stateDir, "backups"))).toHaveLength(1);

    const stale = await post("/api/edit", {
      op: "update",
      file: libraryFile,
      indexPath: [0, 0],
      expect: { content: "Body {{i}}" },
      content: "Overwrite",
    });
    expect(stale.status).toBe(409);
  });

  it("deletes with undo", async () => {
    const before = fs.readFileSync(libraryFile, "utf8");
    const deleted = await readJson(await post("/api/edit", { op: "delete", file: libraryFile, indexPath: [0, 1] }));
    expect(deleted.ok).toBe(true);
    expect(deleted.undoToken).toBeTruthy();
    expect(deleted.model.totals.prompts).toBe(2);

    const undone = await readJson(await post("/api/undo", { token: deleted.undoToken }));
    expect(undone.ok).toBe(true);
    expect(undone.model.totals.prompts).toBe(3);
    expect(fs.readFileSync(libraryFile, "utf8")).toBe(before);

    const expired = await post("/api/undo", { token: deleted.undoToken });
    expect(expired.status).toBe(410);
  });

  it("adds a child and focuses it", async () => {
    const added = await readJson(
      await post("/api/edit", { op: "add", file: libraryFile, indexPath: [0], title: "新提示词" }),
    );
    expect(added.ok).toBe(true);
    expect(added.focusKey).toBe(`${libraryFile}#0.2`);
    expect(added.model.totals.prompts).toBe(4);
  });

  it("moves several prompts and undoes the move", async () => {
    const before = fs.readFileSync(libraryFile, "utf8");
    const moved = await readJson(
      await post("/api/edit", {
        op: "move",
        items: [
          { file: libraryFile, indexPath: [0, 1], expect: { title: "Second" } },
          { file: libraryFile, indexPath: [0, 0], expect: { title: "Plan" } },
        ],
        target: { file: libraryFile, indexPath: [0, 2], where: "after" },
      }),
    );
    expect(moved.ok).toBe(true);
    expect(moved.changed).toBe(true);
    expect(moved.focusKeys).toEqual([`${libraryFile}#0.1`, `${libraryFile}#0.2`]);
    const parsed = hjson.parse(fs.readFileSync(libraryFile, "utf8")) as { subprompts: { title: string }[] }[];
    expect(parsed[0].subprompts.map((prompt) => prompt.title)).toEqual(["新提示词", "Second", "Plan"]);

    const undone = await readJson(await post("/api/undo", { token: moved.undoToken }));
    expect(undone.ok).toBe(true);
    expect(fs.readFileSync(libraryFile, "utf8")).toBe(before);
  });

  it("deletes several prompts in one request and refuses stale ones", async () => {
    const stale = await post("/api/edit", {
      op: "delete",
      items: [{ file: libraryFile, indexPath: [0, 0], expect: { title: "Not Plan" } }],
    });
    expect(stale.status).toBe(409);

    const deleted = await readJson(
      await post("/api/edit", {
        op: "delete",
        items: [
          { file: libraryFile, indexPath: [0, 0] },
          { file: libraryFile, indexPath: [0, 2] },
        ],
      }),
    );
    expect(deleted.ok).toBe(true);
    expect(deleted.model.totals.prompts).toBe(2);
    await post("/api/undo", { token: deleted.undoToken });
  });

  it("rejects moves into a prompt's own subtree", async () => {
    const response = await post("/api/edit", {
      op: "move",
      items: [{ file: libraryFile, indexPath: [0] }],
      target: { file: libraryFile, indexPath: [0, 0], where: "inside-last" },
    });
    expect(response.status).toBe(400);
  });

  it("rejects files outside the editable roots", async () => {
    const response = await post("/api/edit", { op: "update", file: outsideFile, indexPath: [0, 0], content: "x" });
    expect(response.status).toBe(403);
    expect(fs.readFileSync(outsideFile, "utf8")).toBe(LIBRARY);
  });
});

interface GitApiResponse {
  ok: boolean;
  error?: string;
  git: PromptMapGitStatus;
  result?: ShellRunResult;
}

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

(hasGit ? describe : describe.skip)("prompt-map server git", () => {
  let dir: string;
  let repoDir: string;
  let repoRoot: string;
  let libraryFile: string;
  let stateDir: string;
  let server: RunningPromptMapServer;
  const savedEnv: Record<string, string | undefined> = {};

  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: repoDir, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const headers = () => ({ "Content-Type": "application/json", [TOKEN_HEADER]: server.token });
  const post = (route: string, body: unknown) =>
    fetch(`http://127.0.0.1:${server.port}${route}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
  const getGit = async (): Promise<GitApiResponse> =>
    (await (await fetch(`http://127.0.0.1:${server.port}/api/git`, { headers: headers() })).json()) as GitApiResponse;
  const readGit = async (response: Response): Promise<GitApiResponse> => (await response.json()) as GitApiResponse;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "quickgpt-map-git-"));
    // The server runs git with the process environment, so isolate it from the developer's configuration.
    const isolation: Record<string, string> = {
      GIT_CONFIG_GLOBAL: path.join(dir, "gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    };
    for (const [key, value] of Object.entries(isolation)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    fs.writeFileSync(isolation.GIT_CONFIG_GLOBAL, "");

    repoDir = path.join(dir, "repo");
    const libraryDir = path.join(repoDir, "prompts");
    stateDir = path.join(dir, "state");
    fs.mkdirSync(libraryDir, { recursive: true });
    libraryFile = path.join(libraryDir, "code.hjson");
    fs.writeFileSync(libraryFile, LIBRARY);
    git("init", "-q");
    git("symbolic-ref", "HEAD", "refs/heads/main");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    repoRoot = fs.realpathSync(repoDir);

    const templatePath = path.join(dir, "index.html");
    fs.writeFileSync(
      templatePath,
      '<html><script id="d" type="application/json">/*__PROMPT_MAP_DATA__*/</script></html>',
    );
    server = await startPromptMapServer({
      sources: [libraryDir],
      editableRoots: [libraryDir],
      stateDir,
      templatePath,
      port: 0,
      idleTimeoutMs: 0,
      commitTimeoutMs: 10_000,
    });
  });

  afterAll(async () => {
    await server.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("requires the token", async () => {
    expect((await fetch(`http://127.0.0.1:${server.port}/api/git`)).status).toBe(403);
  });

  it("reports the repository and marks files edited through the page", async () => {
    const clean = await getGit();
    expect(clean.ok).toBe(true);
    expect(clean.git.available).toBe(true);
    expect(clean.git.commitCommand).toBe("");
    expect(clean.git.running).toBe(false);
    expect(path.isAbsolute(clean.git.shell)).toBe(true);
    expect(clean.git.unmanaged).toEqual([]);
    expect(clean.git.repos).toHaveLength(1);
    expect(clean.git.repos[0]).toMatchObject({ root: repoRoot, name: "repo", head: "main", clean: true, changes: [] });
    expect(clean.git.repos[0].lastCommit?.subject).toBe("init");

    const edited = await post("/api/edit", {
      op: "update",
      file: libraryFile,
      indexPath: [0, 0],
      expect: { title: "Plan" },
      content: "Body {{i}} edited",
    });
    expect(edited.status).toBe(200);

    const dirty = await getGit();
    expect(dirty.git.repos[0].clean).toBe(false);
    expect(dirty.git.repos[0].changes).toHaveLength(1);
    // absPath uses the configured directory so the page can match it against its own file paths.
    expect(dirty.git.repos[0].changes[0]).toMatchObject({
      path: "prompts/code.hjson",
      kind: "modified",
      staged: false,
      unstaged: true,
      absPath: libraryFile,
    });
  });

  it("refuses to commit without a command and validates the configuration", async () => {
    const missing = await post("/api/git/commit", { repo: repoRoot });
    expect(missing.status).toBe(400);
    expect((await readGit(missing)).error).toContain("提交命令");

    expect((await post("/api/git/config", { commitCommand: 5 })).status).toBe(400);
    expect((await post("/api/git/config", { commitCommand: "x".repeat(4001) })).status).toBe(400);
    expect(fs.existsSync(path.join(stateDir, GIT_CONFIG_FILE))).toBe(false);
  });

  it("stores the commit command and runs it in the repository root", async () => {
    const command = 'git add -A && git -c commit.gpgsign=false commit -q -m "map commit" && echo "ran in $(pwd -P)"';
    const saved = await readGit(await post("/api/git/config", { commitCommand: `  ${command}  ` }));
    expect(saved.ok).toBe(true);
    expect(saved.git.commitCommand).toBe(command);
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, GIT_CONFIG_FILE), "utf8"))).toEqual({
      commitCommand: command,
    });

    const outside = await post("/api/git/commit", { repo: dir });
    expect(outside.status).toBe(403);
    expect(git("log", "--oneline").trim().split("\n")).toHaveLength(1);

    const response = await post("/api/git/commit", { repo: repoRoot });
    expect(response.status).toBe(200);
    const body = await readGit(response);
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ exitCode: 0, timedOut: false, cwd: repoRoot, command });
    expect(body.result?.stdout).toContain(`ran in ${repoRoot}`);
    expect(body.git.running).toBe(false);
    expect(body.git.repos[0].clean).toBe(true);
    expect(body.git.repos[0].changes).toEqual([]);
    expect(body.git.repos[0].lastCommit?.subject).toBe("map commit");
    expect(git("log", "--oneline").trim().split("\n")).toHaveLength(2);
  }, 20_000);

  it("returns the output of a failing command without failing the request", async () => {
    await post("/api/git/config", { commitCommand: "echo boom 1>&2; exit 3" });
    const body = await readGit(await post("/api/git/commit", { repo: repoRoot }));
    expect(body.ok).toBe(true);
    expect(body.result?.exitCode).toBe(3);
    expect(body.result?.stderr).toContain("boom");
  }, 20_000);

  it("runs one command at a time and reports it as running", async () => {
    await post("/api/git/config", { commitCommand: "sleep 1" });
    const first = post("/api/git/commit", { repo: repoRoot });
    const second = post("/api/git/commit", { repo: repoRoot });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await getGit()).git.running).toBe(true);
    const statuses = (await Promise.all([first, second])).map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect((await getGit()).git.running).toBe(false);
  }, 20_000);

  it("clears the command again", async () => {
    const cleared = await readGit(await post("/api/git/config", { commitCommand: "" }));
    expect(cleared.git.commitCommand).toBe("");
    expect((await post("/api/git/commit", { repo: repoRoot })).status).toBe(400);
  });
});
