/**
 * Local Prompt Map server.
 *
 * Runs outside Raycast as a detached Node process (bundled into
 * `assets/prompt-map/server.js`), serves the Prompt Map page for the current
 * library and applies edits to the `.hjson` files through the surgical HJSON
 * editor. It binds to 127.0.0.1 only, requires a per-launch token on every
 * request, backs up a file before each write, and exits after a period of
 * inactivity.
 *
 * CLI usage (what the extension spawns):
 *   node server.js --sources '["/path/to/prompts"]' --editable-roots '["/path/to/prompts"]' --state <dir>
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { addChild, deletePrompt, resolvePrompt, updateFields, valueOf } from "../utils/hjson-edit";
import {
  buildPromptMapModel,
  findPromptMapNode,
  isInsideAny,
  loadPromptLibrary,
  type PromptMapModel,
} from "../utils/prompt-map-model";
import { renderPromptMapPage } from "../utils/prompt-map-page";

export const SERVER_STATE_FILE = "server.json";
export const TOKEN_HEADER = "x-prompt-map-token";
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const UNDO_TTL_MS = 10 * 60 * 1000;
const MAX_BACKUPS = 200;

export interface PromptMapServerOptions {
  /** Directories or files the library is loaded from. */
  sources: string[];
  /** Directories whose files may be edited. */
  editableRoots: string[];
  /** Directory for `server.json` and backups. */
  stateDir: string;
  /** Path of the page template (`index.html`). */
  templatePath: string;
  port?: number;
  host?: string;
  token?: string;
  idleTimeoutMs?: number;
  /** Called when the idle timeout elapses; the CLI exits the process. */
  onIdle?: () => void;
  log?: (message: string) => void;
}

export interface PromptMapServerState {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
  sources: string[];
  editableRoots: string[];
}

export interface RunningPromptMapServer {
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

interface EditPayload {
  op: "update" | "add" | "delete";
  file: string;
  indexPath: number[];
  title?: string;
  content?: string;
  expect?: { title?: string; content?: string };
}

interface UndoEntry {
  file: string;
  before: string;
  after: string;
  expires: number;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

function pruneBackups(backupDir: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(backupDir).filter((name) => name.endsWith(".hjson"));
  } catch {
    return;
  }
  if (entries.length <= MAX_BACKUPS) return;
  entries
    .map((name) => ({ name, mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime)
    .slice(0, entries.length - MAX_BACKUPS)
    .forEach(({ name }) => fs.rmSync(path.join(backupDir, name), { force: true }));
}

/**
 * Copies `filePath` into the backup directory with a timestamp and returns the
 * backup path.
 */
export function backupFile(filePath: string, backupDir: string): string {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `${path.basename(filePath, ".hjson")}.${stamp}.hjson`);
  fs.copyFileSync(filePath, target);
  pruneBackups(backupDir);
  return target;
}

export async function startPromptMapServer(options: PromptMapServerOptions): Promise<RunningPromptMapServer> {
  const host = options.host ?? "127.0.0.1";
  const token = options.token ?? crypto.randomBytes(16).toString("hex");
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const log = options.log ?? (() => undefined);
  const backupDir = path.join(options.stateDir, "backups");
  const undoStore = new Map<string, UndoEntry>();
  let idleTimer: NodeJS.Timeout | undefined;

  const touch = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    if (!options.onIdle || idleTimeoutMs <= 0) return;
    idleTimer = setTimeout(() => options.onIdle?.(), idleTimeoutMs);
    idleTimer.unref();
  };

  const buildModel = (): PromptMapModel => {
    const library = loadPromptLibrary(options.sources);
    return buildPromptMapModel(library.roots, {
      sourceDirs: options.sources,
      editableRoots: options.editableRoots,
      editable: true,
      errors: library.errors,
    });
  };

  const hasToken = (req: http.IncomingMessage, url: URL): boolean => {
    const header = req.headers[TOKEN_HEADER];
    const provided = typeof header === "string" ? header : url.searchParams.get("t");
    return provided === token;
  };

  const assertEditable = (filePath: string): string => {
    const resolved = path.resolve(filePath);
    if (
      !isInsideAny(resolved, options.editableRoots) ||
      options.editableRoots.some((root) => path.resolve(root) === resolved)
    ) {
      throw new HttpError(403, "This file is outside the editable prompt directories");
    }
    return resolved;
  };

  const applyEdit = (payload: EditPayload): { changed: boolean; focusKey?: string; undoToken?: string } => {
    if (!payload || typeof payload !== "object") throw new HttpError(400, "Bad payload");
    if (!Array.isArray(payload.indexPath) || !payload.indexPath.every((i) => Number.isInteger(i) && i >= 0)) {
      throw new HttpError(400, "Bad index path");
    }
    const filePath = assertEditable(String(payload.file ?? ""));
    const text = fs.readFileSync(filePath, "utf8");

    // Optimistic concurrency: refuse to overwrite a prompt that changed on disk.
    if (payload.expect && (payload.op === "update" || payload.op === "delete")) {
      const node = resolvePrompt(text, payload.indexPath);
      for (const key of ["title", "content"] as const) {
        const expected = payload.expect[key];
        if (typeof expected !== "string") continue;
        if ((valueOf(node, key) ?? "") !== expected) {
          throw new HttpError(409, `「${key}」已在磁盘上被修改，请刷新页面后再编辑`);
        }
      }
    }

    let next: string;
    let focusKey: string | undefined;
    if (payload.op === "update") {
      next = updateFields(text, payload.indexPath, { title: payload.title, content: payload.content });
      focusKey = `${filePath}#${payload.indexPath.join(".")}`;
    } else if (payload.op === "add") {
      const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "新提示词";
      const content = typeof payload.content === "string" ? payload.content : "";
      const result = addChild(text, payload.indexPath, { title, content });
      next = result.text;
      focusKey = `${filePath}#${result.indexPath.join(".")}`;
    } else if (payload.op === "delete") {
      next = deletePrompt(text, payload.indexPath);
    } else {
      throw new HttpError(400, `Unknown op ${String(payload.op)}`);
    }

    if (next === text) return { changed: false, focusKey };
    const backupPath = backupFile(filePath, backupDir);
    fs.writeFileSync(filePath, next, "utf8");
    log(
      `${payload.op} ${path.basename(filePath)} ${JSON.stringify(payload.indexPath)} backup=${path.basename(backupPath)}`,
    );

    let undoToken: string | undefined;
    if (payload.op === "delete") {
      undoToken = crypto.randomBytes(8).toString("hex");
      undoStore.set(undoToken, { file: filePath, before: text, after: next, expires: Date.now() + UNDO_TTL_MS });
    }
    return { changed: true, focusKey, undoToken };
  };

  const applyUndo = (undoToken: string): void => {
    const entry = undoStore.get(undoToken);
    if (!entry || entry.expires < Date.now()) throw new HttpError(410, "撤销已过期");
    const current = fs.readFileSync(entry.file, "utf8");
    if (current !== entry.after) throw new HttpError(409, "文件在删除后又被修改，无法自动撤销");
    backupFile(entry.file, backupDir);
    fs.writeFileSync(entry.file, entry.before, "utf8");
    undoStore.delete(undoToken);
    log(`undo ${path.basename(entry.file)}`);
  };

  const server = http.createServer(async (req, res) => {
    touch();
    const url = new URL(req.url ?? "/", `http://${host}`);
    try {
      if (!hasToken(req, url)) {
        if (url.pathname === "/" || url.pathname === "/prompt-map.html") {
          sendHtml(
            res,
            403,
            '<!doctype html><meta charset="utf-8"><title>Prompt Map</title><body style="font-family:-apple-system,sans-serif;padding:40px;color:#333"><h2>链接已失效</h2><p>请在 Raycast 的 Prompt Lab 中重新打开 Prompt Map。</p></body>',
          );
          return;
        }
        throw new HttpError(403, "Missing or invalid token");
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/prompt-map.html")) {
        const template = fs.readFileSync(options.templatePath, "utf8");
        sendHtml(res, 200, renderPromptMapPage(buildModel(), template));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/ping") {
        sendJson(res, 200, {
          ok: true,
          pid: process.pid,
          sources: options.sources,
          editableRoots: options.editableRoots,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/model") {
        sendJson(res, 200, buildModel());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/edit") {
        const payload = JSON.parse(await readBody(req)) as EditPayload;
        const result = applyEdit(payload);
        const model = buildModel();
        const focus = result.focusKey ? findPromptMapNode(model, result.focusKey) : undefined;
        sendJson(res, 200, {
          ok: true,
          changed: result.changed,
          focusKey: focus?.key,
          undoToken: result.undoToken,
          model,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/undo") {
        const payload = JSON.parse(await readBody(req)) as { token?: string };
        applyUndo(String(payload.token ?? ""));
        sendJson(res, 200, { ok: true, model: buildModel() });
        return;
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      const message = error instanceof Error ? error.message : String(error);
      if (status >= 500 || status === 400) log(`error ${status}: ${message}`);
      sendJson(res, status, { ok: false, error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  touch();

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : Number(options.port ?? 0);
  return {
    port,
    token,
    url: `http://${host}:${port}/?t=${token}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (idleTimer) clearTimeout(idleTimer);
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function readServerState(stateDir: string): PromptMapServerState | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(stateDir, SERVER_STATE_FILE), "utf8")) as PromptMapServerState;
    if (!parsed || typeof parsed.port !== "number" || typeof parsed.token !== "string") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return args;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stateDir = args.state || path.join(process.cwd(), "prompt-map-state");
  const sources = parseList(args.sources);
  const editableRoots = parseList(args["editable-roots"]);
  if (sources.length === 0) {
    console.error("Usage: server.js --sources '[...]' --editable-roots '[...]' --state <dir> [--port n] [--idle ms]");
    process.exit(2);
  }
  fs.mkdirSync(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, SERVER_STATE_FILE);
  const removeState = (): void => {
    try {
      const current = readServerState(stateDir);
      if (current && current.pid === process.pid) fs.rmSync(stateFile, { force: true });
    } catch {
      // ignore
    }
  };

  const running = await startPromptMapServer({
    sources,
    editableRoots,
    stateDir,
    templatePath: args.template || path.join(__dirname, "index.html"),
    port: args.port ? Number(args.port) : 0,
    idleTimeoutMs: args.idle ? Number(args.idle) : DEFAULT_IDLE_TIMEOUT_MS,
    log: (message) => console.log(`${new Date().toISOString()} ${message}`),
    onIdle: () => {
      console.log("idle timeout reached, exiting");
      removeState();
      process.exit(0);
    },
  });

  const state: PromptMapServerState = {
    port: running.port,
    token: running.token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    sources,
    editableRoots,
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
  console.log(`Prompt Map server listening on ${running.url}`);

  const shutdown = (): void => {
    removeState();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", removeState);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
