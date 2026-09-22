import fs from "fs";
import os from "os";
import path from "path";
import * as hjson from "hjson";
import { startPromptMapServer, TOKEN_HEADER, type RunningPromptMapServer } from "../prompt-map/server";

interface ApiResponse {
  ok: boolean;
  changed?: boolean;
  focusKey?: string;
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

  it("rejects files outside the editable roots", async () => {
    const response = await post("/api/edit", { op: "update", file: outsideFile, indexPath: [0, 0], content: "x" });
    expect(response.status).toBe(403);
    expect(fs.readFileSync(outsideFile, "utf8")).toBe(LIBRARY);
  });
});
