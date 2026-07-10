// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import type {
  ActivityPayloadAssetReference,
  OrchestrationEvent,
  OrchestrationThreadActivity,
  OrchestrationThreadV2StreamItem,
  ThreadHead,
  ThreadWindowMessage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import * as ServerConfig from "../config.ts";
import { inferImageExtension, parseBase64DataUrl } from "../imageMime.ts";

export const THREAD_SYNC_INLINE_BUDGET_BYTES = 512 * 1024;
export const THREAD_SYNC_CHUNK_MAX_BYTES = 256 * 1024;
const THREAD_SYNC_ACTIVITY_DATA_INLINE_BYTES = 32 * 1024;
const THREAD_SYNC_ACTIVITY_WIRE_MAX_BYTES = 128 * 1024;
const THREAD_SYNC_ACTIVITY_SUMMARY_MAX_BYTES = 16 * 1024;
const THREAD_SYNC_MESSAGE_TEXT_MAX_BYTES = 96 * 1024;
const THREAD_SYNC_CHUNK_TARGET_BYTES = THREAD_SYNC_CHUNK_MAX_BYTES - 4096;

const wireBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");
const encodeUnknownJson = Schema.encodeSync(Schema.UnknownFromJsonString);

function truncateUtf8(value: string, maxBytes: number, suffix: string): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const contentBudget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let end = Math.min(value.length, contentBudget);
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > contentBudget) {
    end = Math.floor(end * 0.9);
  }
  return `${value.slice(0, end)}${suffix}`;
}

function truncateUtf8Tail(value: string, maxBytes: number, prefix: string): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const contentBudget = Math.max(0, maxBytes - Buffer.byteLength(prefix, "utf8"));
  // Never let the slice begin on a low surrogate: splitting an astral pair
  // turns the head into a replacement character and inflates its byte count.
  const alignStart = (index: number): number =>
    index < value.length && (value.charCodeAt(index) & 0xfc00) === 0xdc00 ? index + 1 : index;
  let start = alignStart(Math.max(0, value.length - contentBudget));
  while (start < value.length && Buffer.byteLength(value.slice(start), "utf8") > contentBudget) {
    start = alignStart(start + Math.max(1, Math.ceil((value.length - start) * 0.1)));
  }
  return `${prefix}${value.slice(start)}`;
}

function payloadRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function externalizableData(payload: Record<string, unknown>): {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly extension: string;
} | null {
  const data = payload.data;
  if (typeof data === "string") {
    const parsed = parseBase64DataUrl(data);
    if (parsed !== null) {
      return {
        bytes: Buffer.from(parsed.base64, "base64"),
        mediaType: parsed.mimeType,
        extension: inferImageExtension({ mimeType: parsed.mimeType }),
      };
    }
    if (data.length >= THREAD_SYNC_ACTIVITY_DATA_INLINE_BYTES) {
      // Only decode as base64 when the payload SAYS it is binary (a mimeType
      // sibling) and the content round-trips: large plain text can match a
      // base64 character sweep and would be silently corrupted by decoding.
      const compact = data.replace(/\s+/gu, "");
      const declaredMediaType = typeof payload.mimeType === "string" ? payload.mimeType : null;
      const decoded =
        declaredMediaType !== null &&
        // A declared text payload is text, no matter how base64-ish it looks
        // ("test ".repeat(n) whitespace-compacts into round-tripping base64).
        !declaredMediaType.startsWith("text/") &&
        compact.length % 4 === 0 &&
        /^[A-Za-z0-9+/]+={0,2}$/u.test(compact)
          ? Buffer.from(compact, "base64")
          : null;
      if (
        decoded !== null &&
        declaredMediaType !== null &&
        decoded.toString("base64") === compact
      ) {
        return {
          bytes: decoded,
          mediaType: declaredMediaType,
          extension: declaredMediaType.startsWith("image/")
            ? inferImageExtension({ mimeType: declaredMediaType })
            : ".bin",
        };
      }
      // Oversized plain text: externalize the UTF-8 bytes verbatim — bounded
      // on the wire, impossible to corrupt.
      return {
        bytes: Buffer.from(data, "utf8"),
        mediaType: "text/plain; charset=utf-8",
        extension: ".txt",
      };
    }
  }

  if (data === undefined) return null;
  const encoded = JSON.stringify(data);
  if (Buffer.byteLength(encoded, "utf8") < THREAD_SYNC_ACTIVITY_DATA_INLINE_BYTES) return null;
  return {
    bytes: Buffer.from(encoded, "utf8"),
    mediaType: "application/json",
    extension: ".bin",
  };
}

const storeActivityAsset = Effect.fn("ThreadSyncWire.storeActivityAsset")(function* (input: {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly extension: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const sha256 = NodeCrypto.createHash("sha256").update(input.bytes).digest("hex");
  const attachmentId = `activity-${sha256}`;
  const assetPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${attachmentId}${input.extension}`,
  });
  if (assetPath === null) return null;
  if (!(yield* fileSystem.exists(assetPath))) {
    yield* fileSystem.makeDirectory(path.dirname(assetPath), { recursive: true });
    yield* fileSystem.writeFile(assetPath, input.bytes);
  }

  return {
    _tag: "activity-payload-asset",
    resource: { _tag: "attachment", attachmentId },
    mediaType: input.mediaType,
    byteLength: input.bytes.byteLength,
    sha256,
  } satisfies ActivityPayloadAssetReference;
});

export const externalizeActivityPayload = Effect.fn("ThreadSyncWire.externalizeActivityPayload")(
  function* (activity: OrchestrationThreadActivity) {
    const payload = payloadRecord(activity.payload);
    const summary = truncateUtf8(
      activity.summary,
      THREAD_SYNC_ACTIVITY_SUMMARY_MAX_BYTES,
      "\n\n[Summary omitted from the synced window.]",
    );
    if (payload === null) return { ...activity, summary };

    const external = externalizableData(payload);
    let next: OrchestrationThreadActivity = { ...activity, summary };
    if (external !== null && external.bytes.byteLength > 0) {
      const reference = yield* storeActivityAsset(external);
      if (reference !== null) next = { ...next, payload: { ...payload, data: reference } };
    }
    if (wireBytes(next) <= THREAD_SYNC_ACTIVITY_WIRE_MAX_BYTES) return next;

    const reference = yield* storeActivityAsset({
      bytes: Buffer.from(encodeUnknownJson(payload), "utf8"),
      mediaType: "application/json",
      extension: ".bin",
    });
    return reference === null ? next : { ...next, payload: { data: reference } };
  },
);

export const externalizeActivities = Effect.fn("ThreadSyncWire.externalizeActivities")(function* (
  activities: ReadonlyArray<OrchestrationThreadActivity>,
) {
  return yield* Effect.forEach(activities, externalizeActivityPayload, {
    concurrency: 4,
  });
});

export const externalizeThreadEvent = Effect.fn("ThreadSyncWire.externalizeThreadEvent")(function* (
  event: OrchestrationEvent,
) {
  if (event.type !== "thread.activity-appended") return event;
  return {
    ...event,
    payload: {
      ...event.payload,
      activity: yield* externalizeActivityPayload(event.payload.activity),
    },
  } satisfies OrchestrationEvent;
});

export function trimWindowMessage(message: ThreadWindowMessage): ThreadWindowMessage {
  const originalTextBytes = Buffer.byteLength(message.text, "utf8");
  if (originalTextBytes <= THREAD_SYNC_MESSAGE_TEXT_MAX_BYTES) return message;
  return {
    ...message,
    // A STREAMING message keeps its TAIL (marker leads): the client appends
    // subsequent deltas to the end, so head-truncation would strand the marker
    // mid-text — and completion events carry empty text, which cannot repair
    // it. Completed messages keep the head as before.
    text: message.streaming
      ? truncateUtf8Tail(
          message.text,
          THREAD_SYNC_MESSAGE_TEXT_MAX_BYTES,
          "[Older content omitted from the synced window.]\n\n",
        )
      : truncateUtf8(
          message.text,
          THREAD_SYNC_MESSAGE_TEXT_MAX_BYTES,
          "\n\n[Older content omitted from the synced window.]",
        ),
    textTruncated: true,
    originalTextBytes,
  };
}

export interface ThreadSnapshotChunks {
  readonly chunks: ReadonlyArray<
    Extract<OrchestrationThreadV2StreamItem, { kind: "snapshot-chunk" }>
  >;
  readonly inlineBytes: number;
  readonly messages: ReadonlyArray<ThreadWindowMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}

export function buildSnapshotChunks(input: {
  readonly snapshotId: string;
  readonly head: ThreadHead;
  readonly messages: ReadonlyArray<ThreadWindowMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}): ThreadSnapshotChunks {
  let head: ThreadHead = {
    ...input.head,
    title: truncateUtf8(input.head.title, 8 * 1024, "…"),
    session:
      input.head.session === null
        ? null
        : {
            ...input.head.session,
            lastError:
              input.head.session.lastError === null
                ? null
                : truncateUtf8(
                    input.head.session.lastError,
                    32 * 1024,
                    "\n\n[Error detail omitted from the synced window.]",
                  ),
          },
    activeProposedPlan:
      input.head.activeProposedPlan === null
        ? null
        : {
            ...input.head.activeProposedPlan,
            planMarkdown: truncateUtf8(
              input.head.activeProposedPlan.planMarkdown,
              64 * 1024,
              "\n\n[Plan content omitted from the synced window.]",
            ),
          },
  };
  if (wireBytes(head) > THREAD_SYNC_CHUNK_TARGET_BYTES) {
    head = { ...head, pendingRequests: [] };
  }
  if (wireBytes(head) > THREAD_SYNC_CHUNK_TARGET_BYTES) {
    throw new Error("Thread head exceeds the v2 snapshot chunk limit after compaction.");
  }
  const messages = input.messages.map(trimWindowMessage);
  const selectedMessages: ThreadWindowMessage[] = [];
  const selectedActivities: OrchestrationThreadActivity[] = [];
  const headBytes = wireBytes(head);
  const remainingBudget = THREAD_SYNC_INLINE_BUDGET_BYTES - headBytes;
  const messageBudget = Math.floor(remainingBudget / 2);
  const activityBudget = remainingBudget - messageBudget;
  let messageBytes = 0;
  let activityBytes = 0;

  for (const message of messages.toReversed()) {
    const bytes = wireBytes(message);
    if (messageBytes + bytes > messageBudget) break;
    selectedMessages.unshift(message);
    messageBytes += bytes;
  }
  for (const activity of input.activities.toReversed()) {
    const bytes = wireBytes(activity);
    if (activityBytes + bytes > activityBudget) break;
    selectedActivities.unshift(activity);
    activityBytes += bytes;
  }
  const inlineBytes = headBytes + messageBytes + activityBytes;

  const chunks: Array<Extract<OrchestrationThreadV2StreamItem, { kind: "snapshot-chunk" }>> = [];
  let current: Extract<OrchestrationThreadV2StreamItem, { kind: "snapshot-chunk" }> = {
    kind: "snapshot-chunk",
    snapshotId: input.snapshotId,
    index: 0,
    head,
    messages: [],
    activities: [],
  };
  const flush = () => {
    chunks.push(current);
    current = {
      kind: "snapshot-chunk",
      snapshotId: input.snapshotId,
      index: chunks.length,
      messages: [],
      activities: [],
    };
  };
  for (const message of selectedMessages) {
    const candidate = { ...current, messages: [...current.messages, message] };
    if (
      wireBytes(candidate) > THREAD_SYNC_CHUNK_TARGET_BYTES &&
      (current.head !== undefined || current.messages.length > 0)
    )
      flush();
    current = { ...current, messages: [...current.messages, message] };
  }
  for (const activity of selectedActivities) {
    const candidate = {
      ...current,
      activities: [...current.activities, activity],
    };
    if (
      wireBytes(candidate) > THREAD_SYNC_CHUNK_TARGET_BYTES &&
      (current.head !== undefined || current.messages.length > 0 || current.activities.length > 0)
    )
      flush();
    current = { ...current, activities: [...current.activities, activity] };
  }
  flush();
  return {
    chunks,
    inlineBytes,
    messages: selectedMessages,
    activities: selectedActivities,
  };
}
