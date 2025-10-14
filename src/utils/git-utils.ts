import * as fs from "fs/promises";
import * as path from "path";
import { exec as callbackExec } from "child_process";
import { promisify } from "util";

const exec = promisify(callbackExec);

/**
 * Convert git remote url (https/ssh) to browsable web url
 * @param gitUrl - e.g., 'git@github.com:user/repo.git' or 'https://github.com/user/repo.git'
 * @returns - e.g., 'https://github.com/user/repo'
 */
function convertGitUrlToWebUrl(gitUrl: string): string | null {
  try {
    // HTTPS format: https://github.com/user/repo.git
    if (gitUrl.startsWith("https://")) {
      const url = new URL(gitUrl);
      return `${url.protocol}//${url.hostname}${url.pathname.replace(/\.git$/, "")}`;
    }
    // SSH format: git@github.com:user/repo.git
    if (gitUrl.startsWith("git@")) {
      const match = gitUrl.match(/git@([^:]+):(.*)/);
      if (match) {
        const host = match[1];
        const repoPath = match[2].replace(/\.git$/, "");
        return `https://${host}/${repoPath}`;
      }
    }
  } catch (error) {
    console.error("Failed to parse git URL:", error);
  }
  return null;
}

/**
 * Search upwards for .git directory to determine repository root
 * @param startPath - The path to start searching from
 * @returns Repository root path or null
 */
export async function findRepoRoot(startPath: string): Promise<string | null> {
  let currentPath = startPath;
  let iterations = 0;

  while (currentPath !== path.dirname(currentPath) && iterations < 20) {
    iterations++;
    const gitPath = path.join(currentPath, ".git");

    try {
      const stats = await fs.stat(gitPath);
      if (stats.isDirectory()) {
        return currentPath;
      }
    } catch {
      // .git not found, continue searching parent directories
    }

    currentPath = path.dirname(currentPath);
  }

  return null;
}

/**
 * Asynchronously generate Git repository link for specified file
 * @param filePath - Absolute path of the file
 * @returns Git link for the file or null
 */
export async function generateGitLink(filePath: string): Promise<string | null> {
  try {
    const fileDir = path.dirname(filePath);
    const repoRoot = await findRepoRoot(fileDir);

    if (!repoRoot) return null;

    // Read config and HEAD files in parallel
    const [gitConfigContent, headContent] = await Promise.all([
      fs.readFile(path.join(repoRoot, ".git", "config"), "utf-8"),
      fs.readFile(path.join(repoRoot, ".git", "HEAD"), "utf-8"),
    ]);

    // Parse remote 'origin' URL
    const remoteUrlMatch = gitConfigContent.match(/\[remote "origin"\]\s*url = (.+)/);
    if (!remoteUrlMatch) return null;

    const webUrl = convertGitUrlToWebUrl(remoteUrlMatch[1]);
    if (!webUrl) return null;

    // Parse current branch
    const branchMatch = headContent.match(/ref: refs\/heads\/(.+)/);
    if (!branchMatch) return null;
    const branch = branchMatch[1].trim();

    // Calculate file path relative to repository root
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, "/");

    return `${webUrl}/blob/${branch}/${encodeURI(relativePath)}`;
  } catch (error) {
    console.error("Error generating git link:", error);
    return null;
  }
}

/**
 * Get all diffs including:
 * 1. Uncommitted changes (working directory)
 * 2. Staged changes
 * 3. Committed changes between current branch and target branch (master/main)
 * @param filePath - Any file path in the repository, used to locate repository root
 * @returns Diff content string, or empty string/error message if failed
 */
export async function getGitDiff(filePath: string): Promise<string> {
  const repoRoot = await findRepoRoot(filePath);
  if (!repoRoot) {
    return ""; // Not a Git repository, fail silently
  }

  try {
    const diffSections: string[] = [];

    // 1. Get unstaged changes (working directory changes)
    try {
      const { stdout: unstagedDiff } = await exec("git diff", { cwd: repoRoot });
      if (unstagedDiff.trim()) {
        diffSections.push("=== Unstaged Changes (Working Directory) ===\n\n" + unstagedDiff);
      }
    } catch {
      // Ignore if command fails
    }

    // 2. Get staged changes (changes added to index)
    try {
      const { stdout: stagedDiff } = await exec("git diff --cached", { cwd: repoRoot });
      if (stagedDiff.trim()) {
        diffSections.push("=== Staged Changes (Index) ===\n\n" + stagedDiff);
      }
    } catch {
      // Ignore if command fails
    }

    // 3. Get committed changes between current branch and target branch
    let targetBranch = "";
    try {
      await exec("git show-ref --verify --quiet refs/heads/master", { cwd: repoRoot });
      targetBranch = "master";
    } catch {
      try {
        await exec("git show-ref --verify --quiet refs/heads/main", { cwd: repoRoot });
        targetBranch = "main";
      } catch {
        // If no master/main branch, skip branch comparison
        targetBranch = "";
      }
    }

    if (targetBranch) {
      try {
        const { stdout: currentBranch } = await exec("git branch --show-current", { cwd: repoRoot });
        if (currentBranch.trim() && currentBranch.trim() !== targetBranch) {
          const { stdout: branchDiff } = await exec(`git diff ${targetBranch}...${currentBranch.trim()}`, {
            cwd: repoRoot,
          });
          if (branchDiff.trim()) {
            diffSections.push(
              `=== Committed Changes (${currentBranch.trim()} vs ${targetBranch}) ===\n\n` + branchDiff,
            );
          }
        }
      } catch {
        // Ignore if branch comparison fails
      }
    }

    // Combine all diff sections
    if (diffSections.length === 0) {
      return ""; // No changes found
    }

    return diffSections.join("\n\n");
  } catch (error) {
    if (error instanceof Error) {
      return `[Git command failed: ${error.message}]`;
    }
    return "[An unknown error occurred while running git diff]";
  }
}
