import { Cache, showToast, Toast } from "@raycast/api";

const CACHE_KEY = "temporaryPromptDirectories";
const EXPIRY_DURATION = 24 * 60 * 60 * 1000; // 1 day in milliseconds

export interface TemporaryDirectoryInfo {
  path: string;
  addedAt: number;
  lastUsedAt: number;
}

export interface TemporaryDirectoryWithExpiry extends TemporaryDirectoryInfo {
  remainingMs: number;
  remainingText: string;
}

const cache = new Cache();

// Calculate remaining time for directory
export function calculateRemainingTime(dirInfo: TemporaryDirectoryInfo): TemporaryDirectoryWithExpiry {
  const now = Date.now();
  const elapsedMs = now - dirInfo.lastUsedAt;
  const remainingMs = Math.max(0, EXPIRY_DURATION - elapsedMs);

  // Calculate remaining hours
  const remainingHours = remainingMs / (60 * 60 * 1000);

  // Format remaining time text
  let remainingText = "";
  if (remainingHours >= 1) {
    // For times over 1 hour, show with 1 decimal place
    remainingText = `${remainingHours.toFixed(1)}h`;
  } else {
    // For less than 1 hour, show as decimal hour with one decimal place
    remainingText = `${remainingHours.toFixed(1)}h`;
  }

  return {
    ...dirInfo,
    remainingMs,
    remainingText,
  };
}

// Get list of all active temporary directories with expiration information
export function getActiveTemporaryDirectoriesWithExpiry(): TemporaryDirectoryWithExpiry[] {
  const dirInfos = getActiveTemporaryDirectories();
  return dirInfos.map(calculateRemainingTime);
}

// Get list of all active temporary directories
export function getActiveTemporaryDirectories(): TemporaryDirectoryInfo[] {
  const cachedData = cache.get(CACHE_KEY);
  if (!cachedData) return [];

  try {
    const dirInfos: TemporaryDirectoryInfo[] = JSON.parse(cachedData);
    const now = Date.now();

    // Filter out unexpired directories
    const validDirs = dirInfos.filter((info) => now - info.lastUsedAt <= EXPIRY_DURATION);

    // If directories have expired, update the cache
    if (validDirs.length !== dirInfos.length) {
      console.log(`${dirInfos.length - validDirs.length} temporary directories expired. Removing.`);
      cache.set(CACHE_KEY, JSON.stringify(validDirs));
    }

    return validDirs;
  } catch (error) {
    console.error("Failed to parse temporary directories cache:", error);
    cache.remove(CACHE_KEY);
    return [];
  }
}

// Check if the specified path is already added as a temporary directory
export function isPathInTemporaryDirectories(dirPath: string): boolean {
  const dirs = getActiveTemporaryDirectories();
  return dirs.some((dir) => dir.path === dirPath);
}

// Add a new temporary directory
export function addTemporaryDirectory(dirPath: string): void {
  // First check if directory already exists
  if (isPathInTemporaryDirectories(dirPath)) {
    showToast(Toast.Style.Failure, "Directory already added as temporary directory");
    return;
  }

  const now = Date.now();
  const newInfo: TemporaryDirectoryInfo = { path: dirPath, addedAt: now, lastUsedAt: now };

  // Get existing directories and add new directory
  const dirInfos = getActiveTemporaryDirectories();
  dirInfos.push(newInfo);

  cache.set(CACHE_KEY, JSON.stringify(dirInfos));
  showToast(Toast.Style.Success, "Temporary directory added", dirPath);
  console.log(`Temporary directory added: ${dirPath}`);
}

// Update usage time for specific temporary directory
export function updateTemporaryDirectoryUsage(path: string): void {
  const dirInfos = getActiveTemporaryDirectories();
  const index = dirInfos.findIndex((dir) => dir.path === path);

  if (index !== -1) {
    dirInfos[index].lastUsedAt = Date.now();
    cache.set(CACHE_KEY, JSON.stringify(dirInfos));
  }
}

// Update usage time for any prompt from temporary directories
export function updateAnyTemporaryDirectoryUsage(): void {
  // This method is used when uncertain which temporary directory a prompt comes from, updates all directories
  const dirInfos = getActiveTemporaryDirectories();

  if (dirInfos.length > 0) {
    const now = Date.now();
    dirInfos.forEach((dir) => (dir.lastUsedAt = now));
    cache.set(CACHE_KEY, JSON.stringify(dirInfos));
  }
}

// Remove specific temporary directory by path
export function removeTemporaryDirectory(dirPath: string): void {
  const dirInfos = getActiveTemporaryDirectories();
  const filteredDirs = dirInfos.filter((dir) => dir.path !== dirPath);

  if (filteredDirs.length !== dirInfos.length) {
    cache.set(CACHE_KEY, JSON.stringify(filteredDirs));
    showToast(Toast.Style.Success, "Temporary directory removed", dirPath);
    console.log(`Temporary directory removed: ${dirPath}`);
  }
}

// Remove all temporary directories
export function removeAllTemporaryDirectories(): void {
  const dirInfos = getActiveTemporaryDirectories();

  if (dirInfos.length > 0) {
    cache.remove(CACHE_KEY);
    showToast(Toast.Style.Success, `Removed all ${dirInfos.length} temporary directories`);
    console.log("All temporary directories removed");
  }
}

// Function for backward compatibility
// Only for backward compatibility, should not be used
export function getActiveTemporaryDirectory(): TemporaryDirectoryInfo | null {
  const dirs = getActiveTemporaryDirectories();
  return dirs.length > 0 ? dirs[0] : null;
}

export function setTemporaryDirectory(dirPath: string): void {
  removeAllTemporaryDirectories();
  addTemporaryDirectory(dirPath);
}
