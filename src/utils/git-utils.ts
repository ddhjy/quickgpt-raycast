import * as fs from "fs/promises";
import * as path from "path";

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
async function findRepoRoot(startPath: string): Promise<string | null> {
  let currentPath = startPath;
  while (currentPath !== path.dirname(currentPath)) {
    const gitPath = path.join(currentPath, ".git");
    try {
      const stats = await fs.stat(gitPath);
      if (stats.isDirectory()) {
        return currentPath;
      }
    } catch {
      // ignore
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
