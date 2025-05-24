import { Cache, showToast, Toast } from "@raycast/api";

const CACHE_KEY = "temporaryPromptDirectories";
const EXPIRY_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

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

  const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const remainingHours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

  let remainingText = "";
  if (remainingDays >= 1) {
    remainingText = `${remainingDays}d ${remainingHours}h`;
  } else if (remainingHours >= 1) {
    remainingText = `${remainingHours}h ${remainingMinutes}m`;
  } else {
    remainingText = `${remainingMinutes}m`;
  }
  if (remainingMs === 0) {
    remainingText = 'expired';
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
  if (isPathInTemporaryDirectories(dirPath)) {
    showToast(Toast.Style.Failure, "Directory already added as temporary directory");
    return;
  }

  const now = Date.now();
  const newInfo: TemporaryDirectoryInfo = { path: dirPath, addedAt: now, lastUsedAt: now };

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

export function updateAnyTemporaryDirectoryUsage(): void {
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

export function getActiveTemporaryDirectory(): TemporaryDirectoryInfo | null {
  const dirs = getActiveTemporaryDirectories();
  return dirs.length > 0 ? dirs[0] : null;
}

export function setTemporaryDirectory(dirPath: string): void {
  removeAllTemporaryDirectories();
  addTemporaryDirectory(dirPath);
}
