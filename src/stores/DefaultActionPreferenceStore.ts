import { Cache } from "@raycast/api";

class DefaultActionPreferenceStore {
    private cache: Cache;
    private key: string;

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