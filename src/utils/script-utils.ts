import fs from "fs";
import path from "path";
import { createNamespacedCache } from "./extension-cache";

export interface ScriptInfo {
  path: string;
  name: string;
}

const CACHE_KEY_DIRECTORIES = "scripts_directories_v1";
const CACHE_KEY_DATA = "scripts_data_v1";
const scriptCache = createNamespacedCache("scripts-v1", [CACHE_KEY_DIRECTORIES, CACHE_KEY_DATA]);

function getDirectoryKey(scriptsDirectories: string[]): string {
  return JSON.stringify(scriptsDirectories);
}

/**
 * Collects `.applescript` / `.scpt` files under `dir` into `result`.
 * Returns false when part of the tree could not be read, so callers can tell
 * a complete scan from a partial one.
 */
async function scanScriptsDirectory(dir: string, result: ScriptInfo[]): Promise<boolean> {
  let complete = true;

  try {
    const items = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const item of items) {
      if (item.name.startsWith("#")) continue;

      const itemPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        complete = (await scanScriptsDirectory(itemPath, result)) && complete;
      } else if (item.isFile() && (item.name.endsWith(".applescript") || item.name.endsWith(".scpt"))) {
        result.push({ path: itemPath, name: path.basename(item.name, path.extname(item.name)) });
      }
    }

    return complete;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return complete;
    }
    console.error(`Failed to scan scripts directory ${dir}:`, error);
    return false;
  }
}

/**
 * Scripts stored by the last complete scan of these directories, or undefined
 * when nothing is cached for them.
 */
export function getCachedScripts(scriptsDirectories: string[]): ScriptInfo[] | undefined {
  if (scriptCache.get(CACHE_KEY_DIRECTORIES) !== getDirectoryKey(scriptsDirectories)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(scriptCache.get(CACHE_KEY_DATA) ?? "");
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed.filter(
      (script): script is ScriptInfo =>
        script && typeof script === "object" && typeof script.path === "string" && typeof script.name === "string",
    );
  } catch {
    return undefined;
  }
}

/**
 * Scans the script directories and caches the result. When a directory is
 * unreadable the cache is left untouched and the cached scripts win over the
 * partial scan, so a transient failure does not hide known scripts.
 */
export async function refreshScripts(scriptsDirectories: string[]): Promise<ScriptInfo[]> {
  const scripts: ScriptInfo[] = [];
  const scriptNames = new Set<string>();
  let scanComplete = true;

  for (const scriptsDirectory of scriptsDirectories) {
    const directoryScripts: ScriptInfo[] = [];
    scanComplete = (await scanScriptsDirectory(scriptsDirectory, directoryScripts)) && scanComplete;
    for (const script of directoryScripts) {
      if (!scriptNames.has(script.name)) {
        scripts.push(script);
        scriptNames.add(script.name);
      }
    }
  }

  if (!scanComplete) {
    return getCachedScripts(scriptsDirectories) ?? scripts;
  }

  scriptCache.set(CACHE_KEY_DIRECTORIES, getDirectoryKey(scriptsDirectories));
  scriptCache.set(CACHE_KEY_DATA, JSON.stringify(scripts));
  return scripts;
}
