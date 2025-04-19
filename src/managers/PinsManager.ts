import { Cache } from "@raycast/api";

class PinsManager {
  private cache: Cache;
  private key: string;

  constructor(cache: Cache, key = "pinnedIdentifiers") {
    this.cache = cache;
    this.key = key;
  }

  /**
   * Adds an identifier to the pinned list.
   * @param identifier The identifier to pin.
   */
  pin(identifier: string): void {
    const pinned = this.pinnedIdentifiers();
    pinned.add(identifier);
    this.cache.set(this.key, JSON.stringify(Array.from(pinned)));
  }

  /**
   * Removes an identifier from the pinned list.
   * @param identifier The identifier to unpin.
   */
  unpin(identifier: string): void {
    const pinned = this.pinnedIdentifiers();
    pinned.delete(identifier);
    this.cache.set(this.key, JSON.stringify(Array.from(pinned)));
  }

  /**
   * Gets all pinned identifiers.
   * @returns A Set of pinned identifiers.
   */
  pinnedIdentifiers(): Set<string> {
    const pinned = this.cache.get(this.key);
    return new Set(pinned ? JSON.parse(pinned) : []);
  }
}

const cache = new Cache();
const pinsManager = new PinsManager(cache);

export default pinsManager;