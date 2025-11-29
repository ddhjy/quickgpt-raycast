import { Cache } from "@raycast/api";

class DefaultActionPreferenceStore {
  private cache: Cache;
  private key: string;
  private lastExecutedKey: string;
  private historyKey: string;
  private historySize: number;

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

  saveDefaultActionPreference(action: string): void {
    this.cache.set(this.key, action);
  }

  getDefaultActionPreference(): string | undefined {
    return this.cache.get(this.key);
  }

  saveLastExecutedAction(action: string): void {
    if (action !== "lastUsed") {
      let history = this.getExecutionHistory();
      history.unshift(action);

      if (history.length > this.historySize) {
        history = history.slice(0, this.historySize);
      }

      this.cache.set(this.historyKey, JSON.stringify(history));
      this.cache.set(this.lastExecutedKey, action);
    }
  }

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

  getMostFrequentlyUsedAction(lookbackCount: number = 5): string | undefined {
    const history = this.getExecutionHistory();
    if (history.length === 0) return undefined;

    const recentHistory = history.slice(0, Math.min(lookbackCount, history.length));
    const frequencyMap = new Map<string, number>();
    recentHistory.forEach((action) => {
      frequencyMap.set(action, (frequencyMap.get(action) || 0) + 1);
    });

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

  getLastExecutedAction(): string | undefined {
    return this.getMostFrequentlyUsedAction(5);
  }

  getExecutionHistoryPublic(): string[] {
    return this.getExecutionHistory();
  }

  clearExecutionHistory(): void {
    this.cache.remove(this.historyKey);
  }
}

const cache = new Cache();
const defaultActionPreferenceStore = new DefaultActionPreferenceStore(cache);

export default defaultActionPreferenceStore;
