import fs from "fs";
import path from "path";

/**
 * This file provides utility functions for discovering and managing AppleScript files
 * that can be executed as actions within the QuickGPT extension.
 */

/**
 * Interface for script information.
 */
export interface ScriptInfo {
  path: string;
  name: string;
}

/**
 * Recursively scans a specified directory to find all AppleScript files
 * (files ending with `.applescript` or `.scpt`).
 * Ignores files and directories starting with `#`.
 *
 * @param dir The absolute path of the directory to scan.
 * @param relativePath The current relative path from the initial directory (used internally for recursion).
 * @param result An array to accumulate the found ScriptInfo objects (used internally for recursion).
 * @returns An array of ScriptInfo objects, each containing the full path and the display name (filename without extension) of a found script.
 */
export function scanScriptsDirectory(dir: string, relativePath = "", result: ScriptInfo[] = []): ScriptInfo[] {
  try {
    const items = fs.readdirSync(dir);

    for (const item of items) {
      if (item.startsWith("#")) continue;

      const itemPath = path.join(dir, item);
      const itemStat = fs.statSync(itemPath);

      if (itemStat.isDirectory()) {
        scanScriptsDirectory(itemPath, path.join(relativePath, item), result);
      } else if (item.endsWith(".applescript") || item.endsWith(".scpt")) {
        const displayName = path.basename(item, path.extname(item));

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

/**
 * Retrieves a list of all available AppleScript files from the user-configured scripts directories.
 * Handles cases where directories are not configured or are inaccessible.
 *
 * @param scriptsDirectories Array of paths to the user's custom scripts directories, as configured in preferences.
 * @returns An array of ScriptInfo objects for all discovered scripts. Returns an empty array if no directories are set or errors occur.
 */
export function getAvailableScripts(scriptsDirectories: (string | undefined)[]): ScriptInfo[] {
  const scripts: ScriptInfo[] = [];
  const scriptNames = new Set<string>(); // Used for deduplication

  for (const scriptsDirectory of scriptsDirectories) {
    if (scriptsDirectory) {
      try {
        const userScripts = scanScriptsDirectory(scriptsDirectory);
        // Avoid duplicate script names
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
  }

  return scripts;
}
