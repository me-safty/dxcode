import {
  Message,
  type Lock,
  type QueueEntry,
  type SerializedMessage,
  type StateAdapter,
} from "chat";

export interface ConvexChatSdkStateOps {
  readonly subscribe: (threadId: string) => Promise<void>;
  readonly unsubscribe: (threadId: string) => Promise<void>;
  readonly isSubscribed: (threadId: string) => Promise<boolean>;
  readonly acquireLock: (input: {
    readonly threadId: string;
    readonly ttlMs: number;
  }) => Promise<Lock | null>;
  readonly releaseLock: (lock: Lock) => Promise<void>;
  readonly forceReleaseLock: (threadId: string) => Promise<void>;
  readonly extendLock: (input: { readonly lock: Lock; readonly ttlMs: number }) => Promise<boolean>;
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (input: {
    readonly key: string;
    readonly valueJson: string;
    readonly ttlMs?: number;
  }) => Promise<void>;
  readonly setIfNotExists: (input: {
    readonly key: string;
    readonly valueJson: string;
    readonly ttlMs?: number;
  }) => Promise<boolean>;
  readonly delete: (key: string) => Promise<void>;
  readonly appendToList: (input: {
    readonly key: string;
    readonly valueJson: string;
    readonly maxLength?: number;
    readonly ttlMs?: number;
  }) => Promise<void>;
  readonly getList: (key: string) => Promise<string[]>;
  readonly enqueue: (input: {
    readonly threadId: string;
    readonly entryJson: string;
    readonly maxSize: number;
  }) => Promise<number>;
  readonly dequeue: (threadId: string) => Promise<string | null>;
  readonly queueDepth: (threadId: string) => Promise<number>;
}

export type TaskIntakeChatSdkStateOps = ConvexChatSdkStateOps;

function stringifyValue(value: unknown) {
  return JSON.stringify(value);
}

function parseValue<T>(valueJson: string) {
  return JSON.parse(valueJson) as T;
}

function serializeQueueEntry(entry: QueueEntry) {
  return JSON.stringify({
    enqueuedAt: entry.enqueuedAt,
    expiresAt: entry.expiresAt,
    message: entry.message.toJSON(),
  });
}

function deserializeQueueEntry(entryJson: string): QueueEntry {
  const entry = JSON.parse(entryJson) as {
    readonly enqueuedAt: number;
    readonly expiresAt: number;
    readonly message: SerializedMessage;
  };
  return {
    enqueuedAt: entry.enqueuedAt,
    expiresAt: entry.expiresAt,
    message: Message.fromJSON(entry.message),
  };
}

export function createTaskIntakeChatSdkState(ops: TaskIntakeChatSdkStateOps): StateAdapter {
  return {
    async connect() {},
    async disconnect() {},
    subscribe: ops.subscribe,
    unsubscribe: ops.unsubscribe,
    isSubscribed: ops.isSubscribed,
    acquireLock(threadId, ttlMs) {
      return ops.acquireLock({ threadId, ttlMs });
    },
    releaseLock: ops.releaseLock,
    forceReleaseLock: ops.forceReleaseLock,
    extendLock(lock, ttlMs) {
      return ops.extendLock({ lock, ttlMs });
    },
    async get<T = unknown>(key: string) {
      const valueJson = await ops.get(key);
      return valueJson === null ? null : parseValue<T>(valueJson);
    },
    set<T = unknown>(key: string, value: T, ttlMs?: number) {
      return ops.set({
        key,
        valueJson: stringifyValue(value),
        ...(ttlMs !== undefined ? { ttlMs } : {}),
      });
    },
    setIfNotExists(key, value, ttlMs) {
      return ops.setIfNotExists({
        key,
        valueJson: stringifyValue(value),
        ...(ttlMs !== undefined ? { ttlMs } : {}),
      });
    },
    delete: ops.delete,
    appendToList(key, value, options) {
      return ops.appendToList({
        key,
        valueJson: stringifyValue(value),
        ...(options?.maxLength !== undefined ? { maxLength: options.maxLength } : {}),
        ...(options?.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
      });
    },
    async getList<T = unknown>(key: string) {
      const valuesJson = await ops.getList(key);
      return valuesJson.map((valueJson) => parseValue<T>(valueJson));
    },
    enqueue(threadId, entry, maxSize) {
      return ops.enqueue({ threadId, entryJson: serializeQueueEntry(entry), maxSize });
    },
    async dequeue(threadId) {
      const entryJson = await ops.dequeue(threadId);
      return entryJson === null ? null : deserializeQueueEntry(entryJson);
    },
    queueDepth: ops.queueDepth,
  };
}

export const createConvexChatSdkState = createTaskIntakeChatSdkState;
