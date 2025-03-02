import fs from "fs";
import path from "path";

/**
 * 脚本信息接口
 */
export interface ScriptInfo {
    path: string;
    name: string;
}

/**
 * 递归扫描目录，获取所有脚本文件
 * @param dir 要扫描的目录
 * @param relativePath 相对路径（内部使用）;
 * @param result 结果数组（内部使用）
 */
export function scanScriptsDirectory(dir: string, relativePath = '', result: ScriptInfo[] = []): ScriptInfo[] {
    try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
            // 忽略以 # 开头的文件和目录
            if (item.startsWith('#')) continue;

            const itemPath = path.join(dir, item);
            const itemStat = fs.statSync(itemPath);

            if (itemStat.isDirectory()) {
                // 递归扫描子目录
                scanScriptsDirectory(itemPath, path.join(relativePath, item), result);
            } else if (item.endsWith(".applescript") || item.endsWith(".scpt")) {
                // 只使用文件名作为显示名称，不包含路径
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
 * 获取所有可用脚本（包括内置脚本和用户自定义脚本）
 * @param scriptsDirectory 用户自定义脚本目录
 * @param assetsDir 内置脚本所在目录
 * @returns 所有可用脚本的数组
 */
export function getAvailableScripts(scriptsDirectory: string | undefined): ScriptInfo[] {
    const scripts: ScriptInfo[] = [];



    // 获取用户自定义脚本
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