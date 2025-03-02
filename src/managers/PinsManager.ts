import { Cache } from "@raycast/api";

class PinsManager {
  private cache: Cache;
  private key: string;

  constructor(cache: Cache, key = "pinnedIdentifiers") {
    this.cache = cache;
    this.key = key;
  }

  /**
   * 添加标识符到固定列表
   * @param identifier 要固定的标识符
   */
  pin(identifier: string): void {
    const pinned = this.pinnedIdentifiers();
    pinned.add(identifier);
    this.cache.set(this.key, JSON.stringify(Array.from(pinned)));
  }

  /**
   * 从固定列表中移除标识符
   * @param identifier 要移除的标识符
   */
  unpin(identifier: string): void {
    const pinned = this.pinnedIdentifiers();
    pinned.delete(identifier);
    this.cache.set(this.key, JSON.stringify(Array.from(pinned)));
  }

  /**
   * 获取所有固定的标识符
   * @returns 固定标识符的Set集合
   */
  pinnedIdentifiers(): Set<string> {
    const pinned = this.cache.get(this.key);
    return new Set(pinned ? JSON.parse(pinned) : []);
  }
}

const cache = new Cache();
const pinsManager = new PinsManager(cache);

export default pinsManager;