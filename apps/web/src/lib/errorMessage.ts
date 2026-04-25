export function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  if (typeof error === "object" && error !== null) {
    const messageCandidate = (error as { message?: unknown }).message;
    if (typeof messageCandidate === "string" && messageCandidate.trim().length > 0) {
      return messageCandidate;
    }

    const tagCandidate = (error as { _tag?: unknown })._tag;
    if (typeof tagCandidate === "string" && tagCandidate.length > 0) {
      const serialized = safeStringify(error);
      return serialized ? `${tagCandidate}: ${serialized}` : tagCandidate;
    }
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
