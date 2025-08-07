import ignore from "ignore";
import type { Ignore } from "ignore";
import fs from "fs";
import path from "path";
import DEFAULT_IGNORE_RULES from "./default-ignore-rules";

/**
 * Singleton class for managing file ignore rules using standard gitignore mechanism
 * All rules are consolidated into gitignore syntax for consistency
 */
class IgnoreManager {
  private static instance: IgnoreManager;
  private ignoreCache: Map<string, Ignore> = new Map();

  /**
   * Default ignore rules in gitignore syntax
   * These rules are always applied as if they were in a .gitignore file at the root
   */
  private readonly defaultIgnoreRules = DEFAULT_IGNORE_RULES;

  private constructor() {}

  static getInstance(): IgnoreManager {
    if (!IgnoreManager.instance) {
      IgnoreManager.instance = new IgnoreManager();
    }
    return IgnoreManager.instance;
  }

  /**
   * Get ignore instance for directory (with caching)
   * Collects all relevant ignore files and combines them
   */
  getIgnoreForDirectory(dirPath: string): Ignore {
    const cached = this.ignoreCache.get(dirPath);
    if (cached) {
      return cached;
    }

    const ig = ignore();

    // Add default rules first
    ig.add(this.defaultIgnoreRules);

    // Find and add all ignore files from the directory hierarchy
    const ignoreFiles = this.findIgnoreFiles(dirPath);
    for (const ignorePath of ignoreFiles) {
      try {
        const content = fs.readFileSync(ignorePath, "utf-8");
        ig.add(content);
      } catch (error) {
        console.debug(`Failed to read ignore file at ${ignorePath}:`, error);
      }
    }

    this.ignoreCache.set(dirPath, ig);
    return ig;
  }

  /**
   * Get ignore instance for a specific file, considering all ignore files
   * from basePath to the file's directory
   */
  private getIgnoreForFile(filePath: string, basePath: string): Ignore {
    const fileDir = path.dirname(filePath);
    const cacheKey = `${basePath}:${fileDir}`;

    const cached = this.ignoreCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const ig = ignore();

    // Add default rules first
    ig.add(this.defaultIgnoreRules);

    // Find all ignore files from basePath to the file's directory
    const ignoreFiles = this.findIgnoreFilesForPath(basePath, fileDir);
    for (const ignorePath of ignoreFiles) {
      try {
        const content = fs.readFileSync(ignorePath, "utf-8");
        ig.add(content);
      } catch (error) {
        console.debug(`Failed to read ignore file at ${ignorePath}:`, error);
      }
    }

    this.ignoreCache.set(cacheKey, ig);
    return ig;
  }

  /**
   * Find all ignore files from basePath to targetPath
   * This includes ignore files in all directories from basePath to targetPath
   */
  private findIgnoreFilesForPath(basePath: string, targetPath: string): string[] {
    const ignoreFiles: string[] = [];

    // Get all directories from basePath to targetPath (inclusive)
    const dirsToCheck = this.getDirectoriesInPath(basePath, targetPath);

    // Check each directory for ignore files
    for (const dir of dirsToCheck) {
      // .quickgptignore has higher priority
      const quickgptIgnorePath = path.join(dir, ".quickgptignore");
      if (fs.existsSync(quickgptIgnorePath)) {
        ignoreFiles.push(quickgptIgnorePath);
      }

      // .gitignore as fallback
      const gitignorePath = path.join(dir, ".gitignore");
      if (fs.existsSync(gitignorePath)) {
        ignoreFiles.push(gitignorePath);
      }
    }

    return ignoreFiles;
  }

  /**
   * Get all directories from basePath to targetPath (inclusive)
   * Returns paths in order from basePath to targetPath
   */
  private getDirectoriesInPath(basePath: string, targetPath: string): string[] {
    let currentDir = path.resolve(targetPath);
    const resolvedBasePath = path.resolve(basePath);

    // Collect all directories from targetPath up to basePath
    const dirsToCheck: string[] = [];
    while (currentDir && currentDir.startsWith(resolvedBasePath)) {
      dirsToCheck.unshift(currentDir);
      if (currentDir === resolvedBasePath) {
        break;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }

    return dirsToCheck;
  }

  /**
   * Find all ignore files from current directory up to root
   * Returns paths in order from root to current directory
   */
  private findIgnoreFiles(dirPath: string): string[] {
    const ignoreFiles: string[] = [];
    let currentDir = dirPath;

    // Traverse from current directory to root to collect paths
    const dirsToCheck: string[] = [];
    while (currentDir && currentDir !== path.dirname(currentDir)) {
      dirsToCheck.unshift(currentDir);
      currentDir = path.dirname(currentDir);
    }

    // Check each directory from root to current
    for (const dir of dirsToCheck) {
      // .quickgptignore has higher priority
      const quickgptIgnorePath = path.join(dir, ".quickgptignore");
      if (fs.existsSync(quickgptIgnorePath)) {
        ignoreFiles.push(quickgptIgnorePath);
      }

      // .gitignore as fallback
      const gitignorePath = path.join(dir, ".gitignore");
      if (fs.existsSync(gitignorePath)) {
        ignoreFiles.push(gitignorePath);
      }
    }

    return ignoreFiles;
  }

  /**
   * Check if file should be ignored
   * Uses standard gitignore matching rules
   */
  shouldIgnore(filePath: string, basePath: string, isDirectory: boolean): boolean {
    // Get ignore instance that considers all ignore files from basePath to the file's directory
    const ig = this.getIgnoreForFile(filePath, basePath);

    // Calculate relative path from base
    const relativePath = path.relative(basePath, filePath);

    // Normalize path separators for cross-platform compatibility
    const normalizedPath = relativePath.replace(/\\/g, "/");

    // For directories, also test with trailing slash
    if (isDirectory) {
      return ig.ignores(normalizedPath) || ig.ignores(normalizedPath + "/");
    }

    return ig.ignores(normalizedPath);
  }

  /**
   * Check if file is binary based on extension
   * This is now handled by gitignore patterns in defaultIgnoreRules
   */
  isBinaryFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const ig = ignore();
    ig.add(this.getBinaryFilePatterns());
    return ig.ignores(fileName);
  }

  /**
   * Extract binary file patterns from default rules
   */
  private getBinaryFilePatterns(): string {
    const lines = this.defaultIgnoreRules.split("\n");
    const binarySection: string[] = [];
    let inBinarySection = false;

    for (const line of lines) {
      if (line.includes("# Binary and media files")) {
        inBinarySection = true;
        continue;
      }
      if (inBinarySection && line.startsWith("#") && !line.includes("Binary")) {
        break;
      }
      if (inBinarySection && line.trim()) {
        binarySection.push(line);
      }
    }

    return binarySection.join("\n");
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.ignoreCache.clear();
  }

  /**
   * Add custom ignore rules (in gitignore syntax)
   */
  addCustomIgnoreRules(rules: string): void {
    console.warn(`addCustomIgnoreRules is not implemented in the new architecture. Received rules: ${rules}`);
    this.clearCache();
  }
}

export default IgnoreManager.getInstance();
