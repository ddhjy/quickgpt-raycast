import { Cache } from "@raycast/api";

/**
 * Manages input history using Raycast's Cache
 * Stores previously entered input values for quick access
 */
class InputHistoryStore {
  private cache: Cache;
  private key: string;
  private maxHistorySize: number;

  constructor(cache: Cache, key = "inputHistory", maxSize = 50) {
    this.cache = cache;
    this.key = key;
    this.maxHistorySize = maxSize;
  }

  /**
   * Add new input to history (avoiding duplicates)
   */
  addToHistory(input: string): void {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    let history = this.getHistory();

    // Remove existing entry if present
    history = history.filter((item) => item !== trimmedInput);

    // Add to beginning
    history.unshift(trimmedInput);

    // Limit size
    if (history.length > this.maxHistorySize) {
      history = history.slice(0, this.maxHistorySize);
    }

    this.cache.set(this.key, JSON.stringify(history));
  }

  /**
   * Get all history items
   */
  getHistory(): string[] {
    const historyJson = this.cache.get(this.key);
    try {
      const parsed = historyJson ? JSON.parse(historyJson) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Failed to parse input history:", e);
      return [];
    }
  }

  /**
   * Clear all history
   */
  clearHistory(): void {
    this.cache.remove(this.key);
  }

  /**
   * Remove specific item from history
   */
  removeFromHistory(input: string): void {
    const history = this.getHistory();
    const filteredHistory = history.filter((item) => item !== input);
    this.cache.set(this.key, JSON.stringify(filteredHistory));
  }
}

const cache = new Cache();
const inputHistoryStore = new InputHistoryStore(cache);

export default inputHistoryStore;
