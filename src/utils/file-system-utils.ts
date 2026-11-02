import path from "path";
import fs from "fs";
import ignoreManager from "./ignore-manager";

export const readDirectoryContentsSync = (dirPath: string, basePath: string = "", rootPath: string = ""): string => {
  const actualRootPath = rootPath || dirPath;
  let content = "";

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
      const itemName = item.name;
      const itemPath = path.join(dirPath, itemName);
      const relativePath = path.join(basePath, itemName);

      if (ignoreManager.shouldIgnore(itemPath, actualRootPath, item.isDirectory())) {
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
          content += readDirectoryContentsSync(itemPath, relativePath, actualRootPath);
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
