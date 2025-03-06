import { Cache } from "@raycast/api";

class DefaultActionPreferenceStore {
    private cache: Cache;
    private key: string;

    constructor(cache: Cache, key = "lastSelectedAction") {
        this.cache = cache;
        this.key = key;
    }

    /**
     * 保存用户的默认操作偏好
     * @param action 操作名称
     */
    saveDefaultActionPreference(action: string): void {
        this.cache.set(this.key, action);
    }

    /**
     * 获取用户的默认操作偏好
     * @returns 操作名称或undefined
     */
    getDefaultActionPreference(): string | undefined {
        return this.cache.get(this.key);
    }
}

const cache = new Cache();
const defaultActionPreferenceStore = new DefaultActionPreferenceStore(cache);

export default defaultActionPreferenceStore; 