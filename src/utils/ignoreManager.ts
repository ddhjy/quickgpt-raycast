import ignore, { Ignore } from "ignore";
import fs from "fs";
import path from "path";

/**
 * Singleton class for managing file ignore rules
 * Supports .gitignore files and custom ignore rules
 */
class IgnoreManager {
    private static instance: IgnoreManager;
    private ignoreCache: Map<string, Ignore> = new Map();

    // Directory names that need to ignore both the directory itself and its contents
    private directoriesToIgnore = [
        "node_modules",
        ".git",
        "dist",
        "build",
        "coverage",
        "tmp",
        "logs",
        ".cache",
        ".vscode",
        ".idea",
        "__pycache__",
        "bower_components",
        "jspm_packages",
        "*.xcodeproj",
        "*.xcworkspace",
    ];

    // Other ignore rules (files and special patterns)
    private otherIgnorePatterns = [
        ".DS_Store",
        "*.log",
        ".env",
        ".env.local",
        "*.pyc",
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        ".npmrc",
        ".yarnrc",
        "# *", // Ignore files/directories starting with #
        ".#*", // Ignore temporary files
    ];

    /**
     * Generate complete ignore patterns for directories (including the directory itself and its contents)
     */
    private generateDirectoryIgnorePatterns(): string[] {
        const patterns: string[] = [];
        for (const dir of this.directoriesToIgnore) {
            patterns.push(dir);        // Match the directory itself
            patterns.push(dir + "/");  // Match directory contents
        }
        return patterns;
    }

    /**
     * Get all default ignore rules
     */
    private get defaultIgnorePatterns(): string[] {
        return [
            ...this.generateDirectoryIgnorePatterns(),
            ...this.otherIgnorePatterns
        ];
    }

    // Binary and media file extensions
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
     * Get ignore instance for directory (with caching)
     */
    getIgnoreForDirectory(dirPath: string): Ignore {
        // Check cache
        const cached = this.ignoreCache.get(dirPath);
        if (cached) {
            return cached;
        }

        // Create new ignore instance
        const ig = ignore();

        // Add default ignore rules
        ig.add(this.defaultIgnorePatterns);

        // Recursively find all .gitignore files in parent directories
        const gitignoreFiles = this.findGitignoreFiles(dirPath);

        // Load .gitignore files in order from root to child
        for (const gitignorePath of gitignoreFiles) {
            try {
                const content = fs.readFileSync(gitignorePath, "utf-8");
                ig.add(content);
            } catch (error) {
                console.debug(`Failed to read .gitignore at ${gitignorePath}:`, error);
            }
        }

        // Cache result
        this.ignoreCache.set(dirPath, ig);
        return ig;
    }

    /**
     * Find all .gitignore files from root directory to specified directory
     */
    private findGitignoreFiles(dirPath: string): string[] {
        const gitignoreFiles: string[] = [];
        let currentDir = dirPath;

        while (currentDir && currentDir !== path.dirname(currentDir)) {
            const gitignorePath = path.join(currentDir, ".gitignore");
            if (fs.existsSync(gitignorePath)) {
                gitignoreFiles.unshift(gitignorePath); // Add to beginning to ensure root-to-child order
            }
            currentDir = path.dirname(currentDir);
        }

        return gitignoreFiles;
    }

    /**
     * Check if file should be ignored
     */
    shouldIgnore(filePath: string, basePath: string): boolean {
        const ig = this.getIgnoreForDirectory(basePath);
        const relativePath = path.relative(basePath, filePath);

        // Check if ignored by .gitignore rules
        if (ig.ignores(relativePath)) {
            return true;
        }

        // Check if it's a binary file
        if (this.isBinaryFile(filePath)) {
            return true;
        }

        return false;
    }

    /**
     * Check if it's a binary file
     */
    isBinaryFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.binaryExtensions.has(ext);
    }

    /**
     * Clear cache (call when needed)
     */
    clearCache(): void {
        this.ignoreCache.clear();
    }

    /**
     * Add custom ignore patterns
     */
    addCustomIgnorePatterns(patterns: string[]): void {
        this.otherIgnorePatterns.push(...patterns);
        this.clearCache(); // 清除缓存以应用新规则
    }

    /**
     * 添加需要忽略的目录（自动生成目录本身和目录内容的忽略规则）
     */
    addDirectoriesToIgnore(directories: string[]): void {
        this.directoriesToIgnore.push(...directories);
        this.clearCache(); // 清除缓存以应用新规则
    }
}

export default IgnoreManager.getInstance(); 