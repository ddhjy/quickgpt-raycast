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
        "# *",
        ".#*",
    ];

    /**
     * Generate complete ignore patterns for directories (including the directory itself and its contents)
     */
    private generateDirectoryIgnorePatterns(): string[] {
        const patterns: string[] = [];
        for (const dir of this.directoriesToIgnore) {
            patterns.push(dir);
            patterns.push(dir + "/");
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
        const cached = this.ignoreCache.get(dirPath);
        if (cached) {
            return cached;
        }

        const ig = ignore();
        ig.add(this.defaultIgnorePatterns);

        const gitignoreFiles = this.findGitignoreFiles(dirPath);

        for (const gitignorePath of gitignoreFiles) {
            try {
                const content = fs.readFileSync(gitignorePath, "utf-8");
                ig.add(content);
            } catch (error) {
                console.debug(`Failed to read .gitignore at ${gitignorePath}:`, error);
            }
        }

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
                gitignoreFiles.unshift(gitignorePath);
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

        if (ig.ignores(relativePath)) {
            return true;
        }

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
        this.clearCache();
    }

    /**
     * Add directories to ignore (automatically generates ignore rules for both directory and its contents)
     */
    addDirectoriesToIgnore(directories: string[]): void {
        this.directoriesToIgnore.push(...directories);
        this.clearCache();
    }
}

export default IgnoreManager.getInstance(); 