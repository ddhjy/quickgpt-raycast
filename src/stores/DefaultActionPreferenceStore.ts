import { Cache } from "@raycast/api";

/**
 * Manages the user's preferred default action (e.g., Copy, Paste, specific script)
 * using Raycast's Cache for persistence.
 */
class DefaultActionPreferenceStore {
    private cache: Cache;
    private key: string;

    /**
     * Initializes a new instance of the DefaultActionPreferenceStore.
     *
     * @param cache The Raycast Cache instance to use for storage.
     * @param key The cache key under which to store the preference. Defaults to "lastSelectedAction".
     */
    constructor(cache: Cache, key = "lastSelectedAction") {
        this.cache = cache;
        this.key = key;
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
}

const cache = new Cache();
const defaultActionPreferenceStore = new DefaultActionPreferenceStore(cache);

export default defaultActionPreferenceStore; 