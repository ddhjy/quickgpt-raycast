import path from "path";
import fsPromises from "fs/promises";
import fs from "fs";
import ignoreManager from "./ignore-manager";

/**
 * This file provides utility functions for interacting with the file system,
 * including checking for binary/media files, ignored items (like node_modules),
 * and reading directory contents recursively (both sync and async).
 * Uses the unified IgnoreManager for consistent file handling.
 */

/**
 * Checks if a file extension indicates a binary or media file type.
 * Uses the unified IgnoreManager for consistent binary file detection.
 *
 * @param fileName The full name or path of the file.
 * @returns True if the extension is in the predefined set, false otherwise.
 */
export const isBinaryOrMediaFile = (fileName: string): boolean => {
  return ignoreManager.isBinaryFile(fileName);
};

/**
 * Checks if a file or directory path should be ignored.
 * Uses the unified IgnoreManager for consistent ignore pattern matching.
 *
 * @param itemPath The full path of the file or directory.
 * @param basePath The base path to calculate relative paths from.
 * @returns True if the item should be ignored, false otherwise.
 */
export const isIgnoredItem = (itemPath: string, basePath: string): boolean => {
  return ignoreManager.shouldIgnore(itemPath, basePath);
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
export const readDirectoryContents = async (dirPath: string, basePath: string = ""): Promise<string> => {
  let content = "";
  const items = await fsPromises.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    const itemName = item.name;
    const itemPath = path.join(dirPath, itemName);
    const relativePath = path.join(basePath, itemName);

    if (isIgnoredItem(itemPath, dirPath) || isBinaryOrMediaFile(itemName)) {
      content += `File: ${relativePath} (content ignored)\n\n`;
    } else if (item.isDirectory()) {
      content += await readDirectoryContents(itemPath, relativePath);
    } else {
      try {
        const fileContent = await fsPromises.readFile(itemPath, "utf-8");
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
 * Uses the unified IgnoreManager for consistent ignore pattern matching.
 * Logs warnings for read errors but continues processing.
 *
 * @param dirPath The absolute path to the directory to read.
 * @param basePath The base path used for constructing relative paths in the output string. Initially empty.
 * @returns A string containing the formatted directory contents.
 */
export const readDirectoryContentsSync = (dirPath: string, basePath: string = ""): string => {
  let content = "";

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
      const itemName = item.name;
      const itemPath = path.join(dirPath, itemName);
      const relativePath = path.join(basePath, itemName);

      if (ignoreManager.shouldIgnore(itemPath, dirPath)) {
        if (item.isDirectory()) {
          content += `Directory: ${relativePath} (ignored)\n\n`;
        } else if (item.isFile()) {
          content += `File: ${relativePath} (ignored)\n\n`;
        }
        continue;
      }

      try {
        if (item.isDirectory()) {
          content += `Directory: ${relativePath}${path.sep}\n`;
          content += readDirectoryContentsSync(itemPath, relativePath);
        } else if (item.isFile()) {
          if (ignoreManager.isBinaryFile(itemPath)) {
            content += `File: ${relativePath} (binary/media, content ignored)\n\n`;
          } else {
            const fileContent = fs.readFileSync(itemPath, "utf-8");
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
