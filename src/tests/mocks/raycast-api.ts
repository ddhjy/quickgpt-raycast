const localStorageState = new Map<string, string | number | boolean>();
const cacheState = new Map<string, string>();

export const getPreferenceValues = jest.fn(() => ({}));

export const LocalStorage = {
  getItem: jest.fn(async (key: string) => localStorageState.get(key)),
  setItem: jest.fn(async (key: string, value: string | number | boolean) => {
    localStorageState.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    localStorageState.delete(key);
  }),
  clear: jest.fn(async () => {
    localStorageState.clear();
  }),
  allItems: jest.fn(async () => Object.fromEntries(localStorageState.entries())),
};

export class Cache {
  get(key: string): string | undefined {
    return cacheState.get(key);
  }

  set(key: string, value: string): void {
    cacheState.set(key, value);
  }

  remove(key: string): void {
    cacheState.delete(key);
  }

  clear(): void {
    cacheState.clear();
  }
}
