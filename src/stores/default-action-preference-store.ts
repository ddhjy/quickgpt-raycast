import { Cache } from "@raycast/api";

/**
 * Manages the user's preferred default action (e.g., Copy, Paste, specific script)
 * using Raycast's Cache for persistence.
 */
class DefaultActionPreferenceStore {
  private cache: Cache;
  private key: string;
  private lastExecutedKey: string;

  /**
   * Initializes a new instance of the DefaultActionPreferenceStore.
   *
   * @param cache The Raycast Cache instance to use for storage.
   * @param key The cache key under which to store the preference. Defaults to "lastSelectedAction".
   * @param lastExecutedKey The cache key under which to store the last executed action. Defaults to "lastExecutedAction".
   */
  constructor(cache: Cache, key = "lastSelectedAction", lastExecutedKey = "lastExecutedAction") {
    this.cache = cache;
    this.key = key;
    this.lastExecutedKey = lastExecutedKey;
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
   * Saves the last executed action (not the preference itself).
   * @param action The action name that was actually executed.
   */
  saveLastExecutedAction(action: string): void {
    if (action !== "lastUsed") {
      this.cache.set(this.lastExecutedKey, action);
    }
  }

  /**
   * Gets the last executed action.
   * @returns The last executed action name or undefined.
   */
  getLastExecutedAction(): string | undefined {
    return this.cache.get(this.lastExecutedKey);
  }
}

const cache = new Cache();
const defaultActionPreferenceStore = new DefaultActionPreferenceStore(cache);

export default defaultActionPreferenceStore;
