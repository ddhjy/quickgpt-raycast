import path from "path";
import fsPromises from "fs/promises";
import fs from "fs";

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
 * 检查文件是否为二进制或媒体文件
 * @param fileName 文件名
 * @returns 是否为二进制或媒体文件
 */
export const isBinaryOrMediaFile = (fileName: string): boolean => {
    const ext = path.extname(fileName).toLowerCase();
    return BINARY_MEDIA_EXTENSIONS.has(ext);
};

/**
 * 检查项目是否应被忽略
 * @param itemName 项目名称
 * @returns 是否应被忽略
 */
export const isIgnoredItem = (itemName: string): boolean => {
    return IGNORED_PATTERNS.some(pattern => pattern.test(itemName));
};

/**
 * 递归读取目录内容
 * @param dirPath 目录路径
 * @param basePath 基础路径（用于构建相对路径）
 * @returns 目录内容的字符串表示
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
 * @param dirPath The path to the directory.
 * @param basePath The base path for constructing relative paths (internal use).
 * @returns The string representation of the directory contents.
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