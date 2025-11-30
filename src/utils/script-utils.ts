import fs from "fs";
import path from "path";

export interface ScriptInfo {
  path: string;
  name: string;
}

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

export function getAvailableScripts(scriptsDirectories: (string | undefined)[]): ScriptInfo[] {
  const scripts: ScriptInfo[] = [];
  const scriptNames = new Set<string>();

  for (const scriptsDirectory of scriptsDirectories) {
    if (scriptsDirectory) {
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
  }

  return scripts;
}
