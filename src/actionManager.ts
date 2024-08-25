import { Cache } from "@raycast/api";

class ActionManager {
  private cache: Cache;
  private key: string;

  constructor(cache: Cache, key = "lastSelectedAction") {
    this.cache = cache;
    this.key = key;
  }

  setLastSelectedAction(action: string) {
    this.cache.set(this.key, action);
  }

  getLastSelectedAction(): string | undefined {
    return this.cache.get(this.key);
  }
}

const cache = new Cache();
const actionManager = new ActionManager(cache);

export default actionManager;