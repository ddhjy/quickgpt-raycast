import { LocalStorage } from "@raycast/api";
import { createNamespacedCache } from "../utils/extension-cache";

interface CacheAdapter {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

interface StorageAdapter {
  getItem<T extends string | number | boolean>(key: string): Promise<T | undefined>;
  setItem(key: string, value: string | number | boolean): Promise<void>;
}

const SELECTED_ACTION_KEY = "lastSelectedAction";
const HISTORY_KEY = "actionExecutionHistory";
const HISTORY_SIZE = 20;
const LAST_USED_LOOKBACK = 5;

/**
 * Remembers the preferred action and the recently executed script actions.
 *
 * The cache answers synchronously during render; LocalStorage is the durable
 * copy that `hydrate` restores into the cache after launch.
 */
export class DefaultActionPreferenceStore {
  private hydrationPromise?: Promise<void>;
  private writeCount = 0;

  constructor(
    private cache: CacheAdapter,
    private storage: StorageAdapter = LocalStorage,
  ) {}

  hydrate(): Promise<void> {
    this.hydrationPromise ??= this.hydrateFromStorage();
    return this.hydrationPromise;
  }

  getDefaultActionPreference(): string | undefined {
    return this.cache.get(SELECTED_ACTION_KEY);
  }

  async saveDefaultActionPreference(action: string): Promise<void> {
    await this.write(SELECTED_ACTION_KEY, action);
  }

  async saveLastExecutedAction(action: string): Promise<void> {
    const history = [action, ...this.getExecutionHistory()].slice(0, HISTORY_SIZE);
    await this.write(HISTORY_KEY, JSON.stringify(history));
  }

  /** The most frequent action among the latest executions, so one stray run does not flip "Last Used". */
  getLastExecutedAction(): string | undefined {
    const frequencies = new Map<string, number>();
    for (const action of this.getExecutionHistory().slice(0, LAST_USED_LOOKBACK)) {
      frequencies.set(action, (frequencies.get(action) || 0) + 1);
    }

    // On a tie the more recently executed action wins: the map keeps insertion order.
    let mostFrequentAction: string | undefined;
    let maxFrequency = 0;
    frequencies.forEach((frequency, action) => {
      if (frequency > maxFrequency) {
        maxFrequency = frequency;
        mostFrequentAction = action;
      }
    });

    return mostFrequentAction;
  }

  private getExecutionHistory(): string[] {
    try {
      const parsed = JSON.parse(this.cache.get(HISTORY_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((action): action is string => typeof action === "string") : [];
    } catch {
      return [];
    }
  }

  private async write(key: string, value: string): Promise<void> {
    this.writeCount += 1;
    this.cache.set(key, value);
    await this.storage.setItem(key, value).catch((error) => {
      console.error(`Failed to persist default action preference "${key}":`, error);
    });
  }

  private async hydrateFromStorage(): Promise<void> {
    const keys = [SELECTED_ACTION_KEY, HISTORY_KEY];
    const writeCountAtStart = this.writeCount;
    const storedValues = await Promise.all(
      keys.map((key) =>
        this.storage.getItem<string>(key).catch((error) => {
          console.error(`Failed to read default action preference "${key}":`, error);
          return undefined;
        }),
      ),
    );

    // A selection made while LocalStorage was loading is newer than what it returned.
    if (this.writeCount !== writeCountAtStart) {
      return;
    }

    keys.forEach((key, index) => {
      const storedValue = storedValues[index];
      if (typeof storedValue === "string") {
        this.cache.set(key, storedValue);
        return;
      }

      // Values written before LocalStorage persistence existed only live in the cache.
      const cachedValue = this.cache.get(key);
      if (cachedValue !== undefined) {
        void this.storage.setItem(key, cachedValue).catch(() => undefined);
      }
    });
  }
}

const cache = createNamespacedCache("action-preferences-v1", [
  "lastSelectedAction",
  "lastExecutedAction",
  "actionExecutionHistory",
]);
const defaultActionPreferenceStore = new DefaultActionPreferenceStore(cache);

export default defaultActionPreferenceStore;
