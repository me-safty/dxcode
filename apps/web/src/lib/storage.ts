import { Debouncer } from "@tanstack/react-pacer";

export interface StateStorage<R = unknown> {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => R;
  removeItem: (name: string) => R;
}

export interface DebouncedStorage<R = unknown> extends StateStorage<R> {
  flush: () => void;
}

export function createMemoryStorage(): StateStorage {
  const store = new Map<string, string>();
  return {
    getItem: (name) => store.get(name) ?? null,
    setItem: (name, value) => {
      store.set(name, value);
    },
    removeItem: (name) => {
      store.delete(name);
    },
  };
}

export function isStateStorage(
  storage: Partial<StateStorage> | null | undefined,
): storage is StateStorage {
  return (
    storage !== null &&
    storage !== undefined &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  );
}

export function resolveStorage(storage: Partial<StateStorage> | null | undefined): StateStorage {
  return isStateStorage(storage) ? storage : createMemoryStorage();
}

/** Keep state usable in-memory when browser persistence rejects a write (for example, quota). */
export function createResilientStorage(
  primary: Partial<StateStorage> | null | undefined,
): StateStorage {
  const resolvedPrimary = resolveStorage(primary);
  const fallback = createMemoryStorage();
  const fallbackKeys = new Set<string>();

  return {
    getItem: (name) => {
      if (fallbackKeys.has(name)) return fallback.getItem(name);
      try {
        return resolvedPrimary.getItem(name);
      } catch {
        fallbackKeys.add(name);
        return fallback.getItem(name);
      }
    },
    setItem: (name, value) => {
      try {
        resolvedPrimary.setItem(name, value);
        fallbackKeys.delete(name);
        fallback.removeItem(name);
      } catch {
        fallbackKeys.add(name);
        fallback.setItem(name, value);
      }
    },
    removeItem: (name) => {
      fallbackKeys.delete(name);
      fallback.removeItem(name);
      try {
        resolvedPrimary.removeItem(name);
      } catch {
        // The in-memory state remains authoritative for this session.
      }
    },
  };
}

export function createDebouncedStorage(
  baseStorage: Partial<StateStorage> | null | undefined,
  debounceMs: number = 300,
): DebouncedStorage {
  const resolvedStorage = resolveStorage(baseStorage);
  const debouncedSetItem = new Debouncer(
    (name: string, value: string) => {
      resolvedStorage.setItem(name, value);
    },
    { wait: debounceMs },
  );

  return {
    getItem: (name) => resolvedStorage.getItem(name),
    setItem: (name, value) => {
      debouncedSetItem.maybeExecute(name, value);
    },
    removeItem: (name) => {
      debouncedSetItem.cancel();
      resolvedStorage.removeItem(name);
    },
    flush: () => {
      debouncedSetItem.flush();
    },
  };
}
