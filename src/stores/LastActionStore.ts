import { Cache } from "@raycast/api";

class LastActionStore {
  private cache: Cache;
  private key: string;

  constructor(cache: Cache, key = "lastSelectedAction") {
    this.cache = cache;
    this.key = key;
  }

  /**
   * 设置最后一个执行的操作
   * @param action 操作名称
   */
  setLastAction(action: string): void {
    this.cache.set(this.key, action);
  }

  /**
   * 获取最后一个执行的操作
   * @returns 操作名称或undefined
   */
  getLastAction(): string | undefined {
    return this.cache.get(this.key);
  }
}

const cache = new Cache();
const lastActionStore = new LastActionStore(cache);

export default lastActionStore;