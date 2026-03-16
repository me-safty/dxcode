const DB_NAME = "t3code-notification-sounds";
const DB_VERSION = 1;
const STORE_NAME = "custom-sounds";

interface StoredNotificationSoundRecord {
  blob: Blob;
  name: string;
  savedAt: string;
}

let databasePromise: Promise<IDBDatabase> | null = null;
let cachedResolvedSound: { id: string; url: string } | null = null;

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function createStorageUnavailableError(): Error {
  return new Error("Custom sound storage is unavailable in this environment.");
}

function createSoundId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `sound-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(createStorageUnavailableError());
  }

  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.addEventListener("close", () => {
        databasePromise = null;
      });
      resolve(database);
    };

    request.addEventListener("error", () => {
      databasePromise = null;
      reject(request.error ?? new Error("Unable to open custom sound storage."));
    });

    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("Custom sound storage is blocked by another open tab or window."));
    };
  });

  return databasePromise;
}

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed.")),
    );
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted.")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
    );
  });
}

function revokeCachedResolvedSound(id?: string): void {
  if (!cachedResolvedSound) {
    return;
  }

  if (id && cachedResolvedSound.id !== id) {
    return;
  }

  URL.revokeObjectURL(cachedResolvedSound.url);
  cachedResolvedSound = null;
}

export async function saveCustomNotificationSound(input: {
  file: Blob;
  name: string;
  previousId?: string | null;
}): Promise<{ id: string; name: string }> {
  const database = await openDatabase();
  const id = createSoundId();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completion = waitForTransaction(transaction);
  const store = transaction.objectStore(STORE_NAME);

  store.put(
    {
      blob: input.file,
      name: input.name,
      savedAt: new Date().toISOString(),
    } satisfies StoredNotificationSoundRecord,
    id,
  );

  if (input.previousId && input.previousId !== id) {
    store.delete(input.previousId);
  }

  await completion;
  revokeCachedResolvedSound(input.previousId ?? undefined);

  return { id, name: input.name };
}

export async function deleteCustomNotificationSound(id: string | null | undefined): Promise<void> {
  if (!id) {
    return;
  }

  revokeCachedResolvedSound(id);
  if (!isIndexedDbAvailable()) {
    return;
  }

  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completion = waitForTransaction(transaction);
  transaction.objectStore(STORE_NAME).delete(id);
  await completion;
}

export async function resolveCustomNotificationSoundSrc(id: string): Promise<string | null> {
  if (!id || !isIndexedDbAvailable()) {
    return null;
  }

  if (cachedResolvedSound?.id === id) {
    return cachedResolvedSound.url;
  }

  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const completion = waitForTransaction(transaction);
  const record = await waitForRequest<StoredNotificationSoundRecord | undefined>(
    transaction.objectStore(STORE_NAME).get(id),
  );
  await completion;

  if (!record) {
    revokeCachedResolvedSound();
    return null;
  }

  revokeCachedResolvedSound();
  cachedResolvedSound = {
    id,
    url: URL.createObjectURL(record.blob),
  };

  return cachedResolvedSound.url;
}

export function clearResolvedCustomNotificationSoundCache(): void {
  revokeCachedResolvedSound();
}
