import fs from "fs";
import path from "path";
import { Cache } from "@raycast/api";
import md5 from "md5";
import { startupElapsedMs, startupLog, startupNowMs } from "./startup-profiler";

export interface ScriptInfo {
  path: string;
  name: string;
}

interface GetAvailableScriptsOptions {
  preferCache?: boolean;
  forceRefresh?: boolean;
}

const scriptCache = new Cache();
const CACHE_KEY_DIRECTORIES = "scripts_directories_v1";
const CACHE_KEY_DATA = "scripts_data_v1";
let memoryCache: { directoryKey: string; scripts: ScriptInfo[] } | undefined;

function normalizeScriptDirectories(scriptsDirectories: (string | undefined)[]): string[] {
  return scriptsDirectories.filter((dir): dir is string => typeof dir === "string" && dir.trim() !== "");
}

function getDirectoryKey(scriptsDirectories: string[]): string {
  return JSON.stringify(scriptsDirectories);
}

function readCachedScripts(directoryKey: string): ScriptInfo[] | undefined {
  if (memoryCache?.directoryKey === directoryKey) {
    startupLog("Scripts memory cache hit", { scriptCount: memoryCache.scripts.length });
    return memoryCache.scripts;
  }

  const cachedDirectoryKey = scriptCache.get(CACHE_KEY_DIRECTORIES);
  const cachedData = scriptCache.get(CACHE_KEY_DATA);

  if (cachedDirectoryKey !== directoryKey || !cachedData) {
    startupLog("Scripts persistent cache miss", {
      directoryKeyHash: md5(directoryKey),
      cachedDirectoryKeyHash: cachedDirectoryKey ? md5(cachedDirectoryKey) : "",
      hasCachedData: !!cachedData,
    });
    return undefined;
  }

  try {
    const parsed = JSON.parse(cachedData);
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const scripts = parsed.filter(
      (script): script is ScriptInfo =>
        script && typeof script === "object" && typeof script.path === "string" && typeof script.name === "string",
    );
    memoryCache = { directoryKey, scripts };
    startupLog("Scripts cache hydrated", { scriptCount: scripts.length });
    return scripts;
  } catch {
    scriptCache.remove(CACHE_KEY_DIRECTORIES);
    scriptCache.remove(CACHE_KEY_DATA);
    return undefined;
  }
}

function writeCachedScripts(directoryKey: string, scripts: ScriptInfo[]): void {
  memoryCache = { directoryKey, scripts };
  scriptCache.set(CACHE_KEY_DIRECTORIES, directoryKey);
  scriptCache.set(CACHE_KEY_DATA, JSON.stringify(scripts));
  startupLog("Scripts cache stored", {
    directoryKeyHash: md5(directoryKey),
    scriptCount: scripts.length,
  });
}

export function scanScriptsDirectory(dir: string, relativePath = "", result: ScriptInfo[] = []): ScriptInfo[] {
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      if (item.name.startsWith("#")) continue;

      const itemPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        scanScriptsDirectory(itemPath, path.join(relativePath, item.name), result);
      } else if (item.isFile() && (item.name.endsWith(".applescript") || item.name.endsWith(".scpt"))) {
        const displayName = path.basename(item.name, path.extname(item.name));

        result.push({
          path: itemPath,
          name: displayName,
        });
      }
    }

    return result;
  } catch (error) {
    console.error("Failed to scan scripts directory:", error);
    return result;
  }
}

export function getAvailableScripts(
  scriptsDirectories: (string | undefined)[],
  options: GetAvailableScriptsOptions = {},
): ScriptInfo[] {
  const started = startupNowMs();
  const directories = normalizeScriptDirectories(scriptsDirectories);
  const directoryKey = getDirectoryKey(directories);

  if (!options.forceRefresh) {
    const cachedScripts = readCachedScripts(directoryKey);
    if (cachedScripts) {
      startupLog("Scripts returned from cache", {
        durationMs: startupElapsedMs(started),
        directoryCount: directories.length,
        scriptCount: cachedScripts.length,
      });
      return cachedScripts;
    }

    if (options.preferCache) {
      startupLog("Scripts cache unavailable", {
        durationMs: startupElapsedMs(started),
        directoryCount: directories.length,
      });
      return [];
    }
  }

  const scripts: ScriptInfo[] = [];
  const scriptNames = new Set<string>();

  for (const scriptsDirectory of directories) {
    try {
      const userScripts = scanScriptsDirectory(scriptsDirectory);
      userScripts.forEach((script) => {
        if (!scriptNames.has(script.name)) {
          scripts.push(script);
          scriptNames.add(script.name);
        }
      });
    } catch (error) {
      console.error(`Failed to read scripts directory ${scriptsDirectory}:`, error);
    }
  }

  writeCachedScripts(directoryKey, scripts);

  startupLog("Scripts scanned", {
    durationMs: startupElapsedMs(started),
    directoryCount: directories.length,
    scriptCount: scripts.length,
    forced: options.forceRefresh === true,
  });

  return scripts;
}
