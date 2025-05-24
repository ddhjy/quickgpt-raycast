import { Cache } from "@raycast/api";

/**
 * Manages the persistence of pinned prompt identifiers using Raycast's Cache.
 * Allows pinning and unpinning prompts by their unique identifier, maintaining pin order.
 */
class PinsManager {
  private cache: Cache;
  private key: string;

  /**
   * Initializes a new instance of the PinsManager.
   *
   * @param cache The Raycast Cache instance to use for storage.
   * @param key The cache key under which to store the pinned identifiers. Defaults to "pinnedIdentifiers".
   */
  constructor(cache: Cache, key = "pinnedIdentifiers") {
    this.cache = cache;
    this.key = key;
  }

  /**
   * Adds an identifier to the beginning of the pinned list, ensuring uniqueness.
   * @param identifier The identifier to pin.
   */
  pin(identifier: string): void {
    let pinned = this.pinnedIdentifiers(); // Get the current ordered array
    // Remove the identifier if it already exists to move it to the front
    pinned = pinned.filter((id) => id !== identifier);
    // Add the new identifier to the beginning of the array
    pinned.unshift(identifier);
    this.cache.set(this.key, JSON.stringify(pinned));
  }

  /**
   * Removes an identifier from the pinned list.
   * @param identifier The identifier to unpin.
   */
  unpin(identifier: string): void {
    let pinned = this.pinnedIdentifiers();
    // Filter out the identifier to remove it
    pinned = pinned.filter((id) => id !== identifier);
    this.cache.set(this.key, JSON.stringify(pinned));
  }

  /**
   * Gets all pinned identifiers in the order they were pinned (most recent first).
   * @returns An array of pinned identifiers.
   */
  pinnedIdentifiers(): string[] {
    const pinnedJson = this.cache.get(this.key);
    // Parse the JSON string or return an empty array if it doesn't exist
    try {
      // Ensure it's always an array, even if cache is corrupted with non-array JSON
      const parsed = pinnedJson ? JSON.parse(pinnedJson) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Failed to parse pinned identifiers from cache:", e);
      return []; // Return empty array on error
    }
  }
}

const cache = new Cache();
const pinsManager = new PinsManager(cache);

export default pinsManager;
