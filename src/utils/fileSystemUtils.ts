import path from "path";
import fsPromises from "fs/promises";
import fs from "fs";

/**
 * This file provides utility functions for interacting with the file system,
 * including checking for binary/media files, ignored items (like node_modules),
 * and reading directory contents recursively (both sync and async).
 */

export const BINARY_MEDIA_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff',
    '.mp3', '.wav', '.flac', '.mp4', '.avi', '.mkv',
    '.exe', '.dll', '.bin', '.iso', '.zip', '.rar',
    '.xcodeproj', '.xcworkspace', '.tiktoken'
]);

export const IGNORED_PATTERNS = [
    /^(node_modules|dist|build|coverage|tmp|logs|public|assets|vendor)$/,
    /^\..+/,
    /^(package-lock\.json|yarn\.lock)$/,
    /^\.vscode$/,
    /^\.idea$/,
    /^\.env(\.local)?$/,
    /^\.cache$/,
    /^(bower_components|jspm_packages)$/,
    /^\.DS_Store$/
];

/**
 * Checks if a file extension indicates a binary or media file type.
 * Compares the lowercased file extension against a predefined set.
 *
 * @param fileName The full name or path of the file.
 * @returns True if the extension is in the predefined set, false otherwise.
 */
export const isBinaryOrMediaFile = (fileName: string): boolean => {
    const ext = path.extname(fileName).toLowerCase();
    return BINARY_MEDIA_EXTENSIONS.has(ext);
};

/**
 * Checks if a file or directory name matches common ignore patterns.
 * Used to skip items like `node_modules`, `.git`, etc.
 *
 * @param itemName The name of the file or directory.
 * @returns True if the name matches any of the ignore patterns, false otherwise.
 */
export const isIgnoredItem = (itemName: string): boolean => {
    return IGNORED_PATTERNS.some(pattern => pattern.test(itemName));
};

/**
 * Asynchronously and recursively reads the contents of a directory.
 * Constructs a string representation including file paths and their content.
 * Skips ignored items and binary/media files (indicating they were ignored).
 * Handles read errors for individual files.
 *
 * @param dirPath The absolute path to the directory to read.
 * @param basePath The base path used for constructing relative paths in the output string. Initially empty.
 * @returns A promise resolving to a string containing the formatted directory contents.
 */
export const readDirectoryContents = async (dirPath: string, basePath: string = ''): Promise<string> => {
    let content = "";
    const items = await fsPromises.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
        const itemName = item.name;
        const itemPath = path.join(dirPath, itemName);
        const relativePath = path.join(basePath, itemName);

        if (isIgnoredItem(itemName) || isBinaryOrMediaFile(itemName)) {
            content += `File: ${relativePath} (content ignored)\n\n`;
        } else if (item.isDirectory()) {
            content += await readDirectoryContents(itemPath, relativePath);
        } else {
            try {
                const fileContent = await fsPromises.readFile(itemPath, 'utf-8');
                content += `File: ${relativePath}\n${fileContent}\n\n`;
            } catch {
                content += `File: ${relativePath} (read failed)\n\n`;
            }
        }
    }

    return content;
};

/**
 * Synchronously and recursively reads the contents of a directory.
 * Constructs a string representation including file paths and their content.
 * Skips ignored items and indicates when binary/media files are encountered.
 * Logs warnings for read errors but continues processing.
 *
 * @param dirPath The absolute path to the directory to read.
 * @param basePath The base path used for constructing relative paths in the output string. Initially empty.
 * @returns A string containing the formatted directory contents.
 */
export const readDirectoryContentsSync = (dirPath: string, basePath: string = ''): string => {
    let content = "";
    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const item of items) {
            const itemName = item.name;
            const itemPath = path.join(dirPath, itemName);
            const relativePath = path.join(basePath, itemName);

            if (isIgnoredItem(itemName)) {
                continue; // Skip ignored items
            }

            try {
                if (item.isDirectory()) {
                    content += `Directory: ${relativePath}${path.sep}\n`;
                    content += readDirectoryContentsSync(itemPath, relativePath); // Recursive call
                } else if (item.isFile()) {
                    if (isBinaryOrMediaFile(itemName)) {
                        content += `File: ${relativePath} (binary/media, content ignored)\n\n`;
                    } else {
                        const fileContent = fs.readFileSync(itemPath, 'utf-8');
                        content += `File: ${relativePath}\n${fileContent}\n\n`;
                    }
                }
            } catch (readError) {
                console.warn(`Warning: Could not read item ${itemPath}:`, readError);
                content += `Item: ${relativePath} (read failed)\n\n`;
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dirPath}:`, error);
        content += `Error reading directory: ${basePath || dirPath}\n\n`;
    }

    return content;
}; 