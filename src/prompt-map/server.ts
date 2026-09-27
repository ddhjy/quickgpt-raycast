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
import {
  addChild,
  deletePrompts,
  movePrompts,
  resolvePrompt,
  updateFields,
  valueOf,
  type DropPosition,
  type PromptShadow,
} from "../utils/hjson-edit";
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

interface Expectation {
  title?: string;
  content?: string;
}

interface EditItem {
  file: string;
  indexPath: number[];
  expect?: Expectation;
}

interface EditPayload {
  op: "update" | "add" | "delete" | "move";
  file: string;
  indexPath: number[];
  title?: string;
  content?: string;
  expect?: Expectation;
  /** `delete` and `move`: the prompts to act on (falls back to file + indexPath). */
  items?: EditItem[];
  /** `move`: the prompt to drop next to or into. */
  target?: { file: string; indexPath: number[]; where: DropPosition };
}

interface UndoEntry {
  files: { file: string; before: string; after: string }[];
  expires: number;
}

const DROP_POSITIONS: readonly DropPosition[] = ["before", "after", "inside-first", "inside-last"];

/** Title as the extension sees it: an untitled prompt takes its first content line. */
function effectiveTitle(node: PromptShadow): string {
  const title = valueOf(node, "title");
  if (title) return title;
  return (valueOf(node, "content") ?? "").trim().split("\n")[0].trim();
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

  const isIndexPath = (value: unknown): value is number[] =>
    Array.isArray(value) && value.length > 0 && value.every((i) => Number.isInteger(i) && i >= 0);

  // Optimistic concurrency: refuse to overwrite a prompt that changed on disk.
  const checkExpect = (text: string, indexPath: number[], expect: Expectation | undefined): void => {
    if (!expect) return;
    const node = resolvePrompt(text, indexPath);
    for (const key of ["title", "content"] as const) {
      const expected = expect[key];
      if (typeof expected !== "string") continue;
      const actual = key === "title" ? effectiveTitle(node) : (valueOf(node, key) ?? "");
      if (actual !== expected) {
        throw new HttpError(409, `「${expected.split("\n")[0].slice(0, 30)}」已在磁盘上被修改，请刷新页面后再操作`);
      }
    }
  };

  /** Backs up and writes several files, registering one undo entry for all of them. */
  const writeFiles = (op: string, changes: { file: string; before: string; after: string }[]): string | undefined => {
    const real = changes.filter((change) => change.after !== change.before);
    if (!real.length) return undefined;
    for (const change of real) {
      const backupPath = backupFile(change.file, backupDir);
      fs.writeFileSync(change.file, change.after, "utf8");
      log(`${op} ${path.basename(change.file)} backup=${path.basename(backupPath)}`);
    }
    const undoToken = crypto.randomBytes(8).toString("hex");
    undoStore.set(undoToken, { files: real, expires: Date.now() + UNDO_TTL_MS });
    return undoToken;
  };

  const editItems = (payload: EditPayload): EditItem[] => {
    const items = Array.isArray(payload.items)
      ? payload.items
      : [{ file: payload.file, indexPath: payload.indexPath, expect: payload.expect }];
    if (!items.length) throw new HttpError(400, "Nothing to edit");
    return items.map((item) => {
      if (!item || !isIndexPath(item.indexPath)) throw new HttpError(400, "Bad index path");
      return { file: assertEditable(String(item.file ?? "")), indexPath: item.indexPath, expect: item.expect };
    });
  };

  const readAll = (files: Iterable<string>): Record<string, string> => {
    const texts: Record<string, string> = {};
    for (const file of files) texts[file] = fs.readFileSync(file, "utf8");
    return texts;
  };

  const applyStructural = (payload: EditPayload): { changed: boolean; focusKeys: string[]; undoToken?: string } => {
    const items = editItems(payload);
    if (payload.op === "delete") {
      const texts = readAll(new Set(items.map((item) => item.file)));
      const changes = Object.entries(texts).map(([file, before]) => {
        const own = items.filter((item) => item.file === file);
        own.forEach((item) => checkExpect(before, item.indexPath, item.expect));
        return {
          file,
          before,
          after: deletePrompts(
            before,
            own.map((item) => item.indexPath),
          ),
        };
      });
      const undoToken = writeFiles("delete", changes);
      return { changed: Boolean(undoToken), focusKeys: [], undoToken };
    }

    const target = payload.target;
    if (!target || !isIndexPath(target.indexPath) || !DROP_POSITIONS.includes(target.where)) {
      throw new HttpError(400, "Bad move target");
    }
    const targetFile = assertEditable(String(target.file ?? ""));
    const texts = readAll(new Set([...items.map((item) => item.file), targetFile]));
    items.forEach((item) => checkExpect(texts[item.file], item.indexPath, item.expect));
    const result = movePrompts(texts, items, { file: targetFile, indexPath: target.indexPath, where: target.where });
    const undoToken = writeFiles(
      "move",
      Object.entries(result.texts).map(([file, after]) => ({ file, before: texts[file], after })),
    );
    return {
      changed: Boolean(undoToken),
      focusKeys: result.moved.map((location) => `${location.file}#${location.indexPath.join(".")}`),
      undoToken,
    };
  };

  const applyEdit = (payload: EditPayload): { changed: boolean; focusKeys: string[]; undoToken?: string } => {
    if (!payload || typeof payload !== "object") throw new HttpError(400, "Bad payload");
    if (payload.op === "delete" || payload.op === "move") return applyStructural(payload);
    if (!Array.isArray(payload.indexPath) || !payload.indexPath.every((i) => Number.isInteger(i) && i >= 0)) {
      throw new HttpError(400, "Bad index path");
    }
    const filePath = assertEditable(String(payload.file ?? ""));
    const text = fs.readFileSync(filePath, "utf8");
    if (payload.op === "update") checkExpect(text, payload.indexPath, payload.expect);

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
    } else {
      throw new HttpError(400, `Unknown op ${String(payload.op)}`);
    }

    const focusKeys = focusKey ? [focusKey] : [];
    if (next === text) return { changed: false, focusKeys };
    const backupPath = backupFile(filePath, backupDir);
    fs.writeFileSync(filePath, next, "utf8");
    log(
      `${payload.op} ${path.basename(filePath)} ${JSON.stringify(payload.indexPath)} backup=${path.basename(backupPath)}`,
    );
    return { changed: true, focusKeys };
  };

  const applyUndo = (undoToken: string): void => {
    const entry = undoStore.get(undoToken);
    if (!entry || entry.expires < Date.now()) throw new HttpError(410, "撤销已过期");
    for (const change of entry.files) {
      if (fs.readFileSync(change.file, "utf8") !== change.after) {
        throw new HttpError(409, `${path.basename(change.file)} 之后又被修改过，无法自动撤销`);
      }
    }
    for (const change of entry.files) {
      backupFile(change.file, backupDir);
      fs.writeFileSync(change.file, change.before, "utf8");
      log(`undo ${path.basename(change.file)}`);
    }
    undoStore.delete(undoToken);
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
        const focusKeys = result.focusKeys.filter((key) => findPromptMapNode(model, key));
        sendJson(res, 200, {
          ok: true,
          changed: result.changed,
          focusKey: focusKeys[0],
          focusKeys,
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
