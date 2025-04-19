import fs from "fs";
import path from "path";

/**
 * Interface for script information.
 */
export interface ScriptInfo {
    path: string;
    name: string;
}

/**
 * Recursively scans a directory to get all script files.
 * @param dir The directory to scan.
 * @param relativePath Relative path (for internal use).
 * @param result Result array (for internal use).
 * @returns An array of ScriptInfo objects.
 */
export function scanScriptsDirectory(dir: string, relativePath = '', result: ScriptInfo[] = []): ScriptInfo[] {
    try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
            // Ignore files and directories starting with #
            if (item.startsWith('#')) continue;

            const itemPath = path.join(dir, item);
            const itemStat = fs.statSync(itemPath);

            if (itemStat.isDirectory()) {
                // Recursively scan subdirectories
                scanScriptsDirectory(itemPath, path.join(relativePath, item), result);
            } else if (item.endsWith(".applescript") || item.endsWith(".scpt")) {
                // Use only the filename as display name, without the path
                const displayName = path.basename(item, path.extname(item));

                result.push({
                    path: itemPath,
                    name: displayName
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
 * Gets all available scripts (user-defined scripts).
 * @param scriptsDirectory User-defined scripts directory.
 * @returns Array of all available scripts.
 */
export function getAvailableScripts(scriptsDirectory: string | undefined): ScriptInfo[] {
    const scripts: ScriptInfo[] = [];

    // Get user-defined scripts
    if (scriptsDirectory) {
        try {
            const userScripts = scanScriptsDirectory(scriptsDirectory);
            scripts.push(...userScripts);
        } catch (error) {
            console.error("Failed to read scripts directory:", error);
        }
    }

    return scripts;
} 