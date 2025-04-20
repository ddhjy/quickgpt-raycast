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
 * Retrieves a list of all available AppleScript files from the user-configured scripts directory.
 * Handles cases where the directory is not configured or is inaccessible.
 *
 * @param scriptsDirectory The path to the user's custom scripts directory, as configured in preferences.
 * @returns An array of ScriptInfo objects for all discovered scripts. Returns an empty array if the directory is not set or an error occurs.
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