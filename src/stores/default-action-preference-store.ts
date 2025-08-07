import { Cache } from "@raycast/api";

/**
 * Manages the user's preferred default action (e.g., Copy, Paste, specific script)
 * using Raycast's Cache for persistence.
 */
class DefaultActionPreferenceStore {
  private cache: Cache;
  private key: string;
  private lastExecutedKey: string;
  private historyKey: string;
  private historySize: number;

  /**
   * Initializes a new instance of the DefaultActionPreferenceStore.
   *
   * @param cache The Raycast Cache instance to use for storage.
   * @param key The cache key under which to store the preference. Defaults to "lastSelectedAction".
   * @param lastExecutedKey The cache key under which to store the last executed action. Defaults to "lastExecutedAction".
   * @param historyKey The cache key under which to store the execution history. Defaults to "actionExecutionHistory".
   * @param historySize The maximum size of the execution history. Defaults to 20.
   */
  constructor(
    cache: Cache,
    key = "lastSelectedAction",
    lastExecutedKey = "lastExecutedAction",
    historyKey = "actionExecutionHistory",
    historySize = 20,
  ) {
    this.cache = cache;
    this.key = key;
    this.lastExecutedKey = lastExecutedKey;
    this.historyKey = historyKey;
    this.historySize = historySize;
  }

  /**
   * Saves the user's default action preference.
   * @param action The action name.
   */
  saveDefaultActionPreference(action: string): void {
    this.cache.set(this.key, action);
  }

  /**
   * Gets the user's default action preference.
   * @returns The action name or undefined.
   */
  getDefaultActionPreference(): string | undefined {
    return this.cache.get(this.key);
  }

  /**
   * Saves the last executed action to history.
   * @param action The action name that was actually executed.
   */
  saveLastExecutedAction(action: string): void {
    if (action !== "lastUsed") {
      // Save to execution history
      let history = this.getExecutionHistory();
      history.unshift(action);

      // Limit the size of execution history
      if (history.length > this.historySize) {
        history = history.slice(0, this.historySize);
      }

      this.cache.set(this.historyKey, JSON.stringify(history));

      // Still save the last executed action (for compatibility)
      this.cache.set(this.lastExecutedKey, action);
    }
  }

  /**
   * Gets the execution history.
   * @returns Array of recently executed actions.
   */
  private getExecutionHistory(): string[] {
    const historyJson = this.cache.get(this.historyKey);
    try {
      const parsed = historyJson ? JSON.parse(historyJson) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Failed to parse action history from cache:", e);
      return [];
    }
  }

  /**
   * Gets the most frequently used action from recent history.
   * @param lookbackCount Number of recent actions to consider (default: 5)
   * @returns The most frequently used action or undefined.
   */
  getMostFrequentlyUsedAction(lookbackCount: number = 5): string | undefined {
    const history = this.getExecutionHistory();
    if (history.length === 0) return undefined;

    // Only consider recent lookbackCount uses
    const recentHistory = history.slice(0, Math.min(lookbackCount, history.length));

    // Count frequencies
    const frequencyMap = new Map<string, number>();
    recentHistory.forEach((action) => {
      frequencyMap.set(action, (frequencyMap.get(action) || 0) + 1);
    });

    // Find the action with highest frequency
    let mostFrequentAction: string | undefined;
    let maxFrequency = 0;

    frequencyMap.forEach((frequency, action) => {
      if (frequency > maxFrequency) {
        maxFrequency = frequency;
        mostFrequentAction = action;
      }
    });

    return mostFrequentAction;
  }

  /**
   * Gets the last executed action.
   * Now returns the most frequently used action from recent history.
   * @returns The most frequently used action or undefined.
   */
  getLastExecutedAction(): string | undefined {
    // Use the most frequently used action from recent 10 uses
    return this.getMostFrequentlyUsedAction(5);
  }

  /**
   * Gets the full execution history (for debugging or advanced features).
   * @returns Array of recently executed actions.
   */
  getExecutionHistoryPublic(): string[] {
    return this.getExecutionHistory();
  }

  /**
   * Clears the execution history.
   */
  clearExecutionHistory(): void {
    this.cache.remove(this.historyKey);
  }
}

const cache = new Cache();
const defaultActionPreferenceStore = new DefaultActionPreferenceStore(cache);

export default defaultActionPreferenceStore;
