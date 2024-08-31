import { Cache } from "@raycast/api";

class LastActionStore {
  private cache: Cache;
  private key: string;

  constructor(cache: Cache, key = "lastSelectedAction") {
    this.cache = cache;
    this.key = key;
  }

  setLastAction(action: string) {
    this.cache.set(this.key, action);
  }

  getLastAction(): string | undefined {
    return this.cache.get(this.key);
  }
}

const cache = new Cache();
const lastActionStore = new LastActionStore(cache);

export default lastActionStore;