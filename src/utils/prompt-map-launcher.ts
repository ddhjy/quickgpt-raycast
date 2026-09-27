/**
 * Opens Prompt Map from the Raycast extension.
 *
 * Preferred path: make sure the local Prompt Map server is running (spawning
 * it detached from Raycast's Node runtime when needed) and open its URL in the
 * default browser, which gives the full editable page. Fallback: write a
 * read-only static snapshot next to the extension's support files and open
 * that instead.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { environment, open } from "@raycast/api";
import configurationManager from "../managers/configuration-manager";
import promptManager from "../managers/prompt-manager";
import { getActiveTemporaryDirectories } from "../stores/temporary-directory-store";
import { buildPromptMapModel } from "./prompt-map-model";
import { renderPromptMapPage } from "./prompt-map-page";
import { readServerState, SERVER_STATE_FILE, type PromptMapServerState } from "../prompt-map/server";

const SPAWN_WAIT_MS = 6000;
const POLL_INTERVAL_MS = 120;
const PING_TIMEOUT_MS = 800;

export interface OpenPromptMapResult {
  mode: "server" | "static";
  url: string;
}

export interface PromptMapPaths {
  stateDir: string;
  serverScript: string;
  templatePath: string;
}

export function getPromptMapPaths(): PromptMapPaths {
  return {
    stateDir: path.join(environment.supportPath, "prompt-map"),
    serverScript: path.join(environment.assetsPath, "prompt-map", "server.js"),
    templatePath: path.join(environment.assetsPath, "prompt-map", "index.html"),
  };
}

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds a Node binary able to run the server: the runtime executing this
 * extension when it is a plain Node, otherwise Raycast's bundled runtime, then
 * common install locations.
 */
export function resolveNodeBinary(): string | undefined {
  const candidates: string[] = [];
  if (/^node/i.test(path.basename(process.execPath))) candidates.push(process.execPath);

  const raycastRuntime = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "com.raycast.macos",
    "NodeJS",
    "runtime",
  );
  try {
    const versions = fs
      .readdirSync(raycastRuntime)
      .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) candidates.push(path.join(raycastRuntime, version, "bin", "node"));
  } catch {
    // Raycast runtime directory is missing; try the other candidates.
  }

  candidates.push("/opt/homebrew/bin/node", "/usr/local/bin/node");
  return candidates.find(isExecutable);
}

async function ping(state: PromptMapServerState): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/api/ping?t=${state.token}`, {
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** True when the server script was rebuilt after the running server started, so it runs stale code. */
function bundleNewerThan(serverScript: string, startedAt: string): boolean {
  try {
    return fs.statSync(serverScript).mtimeMs > Date.parse(startedAt);
  } catch {
    return false;
  }
}

function serverUrl(state: PromptMapServerState): string {
  return `http://127.0.0.1:${state.port}/?t=${state.token}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Directories the server may write to: configured prompt directories plus
 * active temporary directories. The bundled library stays read-only.
 */
export function getEditableRoots(): string[] {
  const configured = configurationManager.getDirectories("prompts");
  const temporary = getActiveTemporaryDirectories().map((directory) => directory.path);
  return Array.from(new Set([...configured, ...temporary])).filter((directory) => {
    try {
      return fs.statSync(directory).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Returns the URL of a running server for the current library, starting one
 * when needed. Throws when no server could be started.
 */
export async function ensurePromptMapServer(paths: PromptMapPaths = getPromptMapPaths()): Promise<string> {
  const sources = promptManager.getLibrarySourcePaths();
  const editableRoots = getEditableRoots();
  fs.mkdirSync(paths.stateDir, { recursive: true });

  const existing = readServerState(paths.stateDir);
  if (existing && isProcessAlive(existing.pid) && (await ping(existing))) {
    if (
      sameList(existing.sources, sources) &&
      sameList(existing.editableRoots, editableRoots) &&
      !bundleNewerThan(paths.serverScript, existing.startedAt)
    ) {
      return serverUrl(existing);
    }
    // The library configuration or the server bundle changed: retire the old server.
    try {
      process.kill(existing.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
    fs.rmSync(path.join(paths.stateDir, SERVER_STATE_FILE), { force: true });
  }

  if (!fs.existsSync(paths.serverScript)) throw new Error(`Prompt Map server bundle is missing: ${paths.serverScript}`);
  const node = resolveNodeBinary();
  if (!node) throw new Error("No Node.js runtime found to run the Prompt Map server");

  const startedAfter = Date.now();
  const child = spawn(
    node,
    [
      paths.serverScript,
      "--sources",
      JSON.stringify(sources),
      "--editable-roots",
      JSON.stringify(editableRoots),
      "--state",
      paths.stateDir,
      "--template",
      paths.templatePath,
    ],
    { detached: true, stdio: "ignore", cwd: paths.stateDir, env: { ...process.env } },
  );
  child.unref();

  const deadline = startedAfter + SPAWN_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const state = readServerState(paths.stateDir);
    if (state && state.pid === child.pid && (await ping(state))) {
      return serverUrl(state);
    }
    if (child.exitCode !== null) break;
  }
  throw new Error("Prompt Map server did not start in time");
}

/**
 * Writes a read-only snapshot of the library and returns its path.
 */
export function writeStaticPromptMap(paths: PromptMapPaths = getPromptMapPaths()): string {
  const systemPromptsPath = path.join(environment.assetsPath, "system_prompts.hjson");
  const roots = promptManager.getRootPrompts().filter((prompt) => prompt.filePath !== systemPromptsPath);
  const model = buildPromptMapModel(roots, {
    sourceDirs: promptManager.getLibrarySourcePaths(),
    editableRoots: [],
    editable: false,
  });
  const template = fs.readFileSync(paths.templatePath, "utf8");
  fs.mkdirSync(paths.stateDir, { recursive: true });
  const target = path.join(paths.stateDir, "prompt-map.html");
  fs.writeFileSync(target, renderPromptMapPage(model, template), "utf8");
  return target;
}

/**
 * Opens Prompt Map in the browser, preferring the editable server and falling
 * back to a static snapshot when the server cannot be started.
 */
export async function openPromptMap(paths: PromptMapPaths = getPromptMapPaths()): Promise<OpenPromptMapResult> {
  try {
    const url = await ensurePromptMapServer(paths);
    await open(url);
    return { mode: "server", url };
  } catch (error) {
    console.warn("Prompt Map server unavailable, opening a static snapshot instead:", error);
    const file = writeStaticPromptMap(paths);
    await open(file);
    return { mode: "static", url: file };
  }
}
