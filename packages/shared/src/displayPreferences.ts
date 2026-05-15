export const THREAD_CONVERSATION_MIN_WIDTH_PX = 320;
export const THREAD_CONVERSATION_MAX_WIDTH_PX = 4096;

export function normalizeThreadConversationMaxWidth(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(
    Math.min(THREAD_CONVERSATION_MAX_WIDTH_PX, Math.max(THREAD_CONVERSATION_MIN_WIDTH_PX, value)),
  );
}
