import ignore, { Ignore } from "ignore";
import fs from "fs";
import path from "path";

/**
 * 管理文件忽略规则的单例类
 * 支持 .gitignore 文件和自定义忽略规则
 */
class IgnoreManager {
    private static instance: IgnoreManager;
    private ignoreCache: Map<string, Ignore> = new Map();

    // 默认忽略规则
    private defaultIgnorePatterns = [
        "node_modules/",
        ".git/",
        ".DS_Store",
        "*.log",
        "dist/",
        "build/",
        "coverage/",
        "tmp/",
        "logs/",
        ".env",
        ".env.local",
        ".cache/",
        ".vscode/",
        ".idea/",
        "__pycache__/",
        "*.pyc",
        "bower_components/",
        "jspm_packages/",
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        ".npmrc",
        ".yarnrc",
        "*.xcodeproj/",
        "*.xcworkspace/",
        "# *", // 忽略以 # 开头的文件/目录
        ".#*", // 忽略临时文件
    ];

    // 二进制和媒体文件扩展名
    private binaryExtensions = new Set([
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp", ".ico", ".svg",
        ".mp3", ".wav", ".flac", ".mp4", ".avi", ".mkv", ".mov", ".wmv",
        ".exe", ".dll", ".bin", ".iso", ".dmg", ".pkg",
        ".zip", ".rar", ".tar", ".gz", ".7z", ".bz2",
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".tiktoken", ".db", ".sqlite",
    ]);

    private constructor() { }

    static getInstance(): IgnoreManager {
        if (!IgnoreManager.instance) {
            IgnoreManager.instance = new IgnoreManager();
        }
        return IgnoreManager.instance;
    }

    /**
     * 获取目录的 ignore 实例（带缓存）
     */
    getIgnoreForDirectory(dirPath: string): Ignore {
        // 检查缓存
        const cached = this.ignoreCache.get(dirPath);
        if (cached) {
            return cached;
        }

        // 创建新的 ignore 实例
        const ig = ignore();

        // 添加默认忽略规则
        ig.add(this.defaultIgnorePatterns);

        // 递归查找所有父目录的 .gitignore 文件
        const gitignoreFiles = this.findGitignoreFiles(dirPath);

        // 按从根到子的顺序加载 .gitignore 文件
        for (const gitignorePath of gitignoreFiles) {
            try {
                const content = fs.readFileSync(gitignorePath, "utf-8");
                ig.add(content);
            } catch (error) {
                console.debug(`Failed to read .gitignore at ${gitignorePath}:`, error);
            }
        }

        // 缓存结果
        this.ignoreCache.set(dirPath, ig);
        return ig;
    }

    /**
     * 查找从根目录到指定目录的所有 .gitignore 文件
     */
    private findGitignoreFiles(dirPath: string): string[] {
        const gitignoreFiles: string[] = [];
        let currentDir = dirPath;

        while (currentDir && currentDir !== path.dirname(currentDir)) {
            const gitignorePath = path.join(currentDir, ".gitignore");
            if (fs.existsSync(gitignorePath)) {
                gitignoreFiles.unshift(gitignorePath); // 添加到开头，保证从根到子的顺序
            }
            currentDir = path.dirname(currentDir);
        }

        return gitignoreFiles;
    }

    /**
     * 检查文件是否应该被忽略
     */
    shouldIgnore(filePath: string, basePath: string): boolean {
        const ig = this.getIgnoreForDirectory(basePath);
        const relativePath = path.relative(basePath, filePath);

        // 检查是否被 .gitignore 规则忽略
        if (ig.ignores(relativePath)) {
            return true;
        }

        // 检查是否是二进制文件
        if (this.isBinaryFile(filePath)) {
            return true;
        }

        return false;
    }

    /**
     * 检查是否为二进制文件
     */
    isBinaryFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.binaryExtensions.has(ext);
    }

    /**
     * 清除缓存（在需要时调用）
     */
    clearCache(): void {
        this.ignoreCache.clear();
    }

    /**
     * 添加自定义忽略规则
     */
    addCustomIgnorePatterns(patterns: string[]): void {
        this.defaultIgnorePatterns.push(...patterns);
        this.clearCache(); // 清除缓存以应用新规则
    }
}

export default IgnoreManager.getInstance(); 