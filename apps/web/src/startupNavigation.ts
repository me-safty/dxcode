import type { ThreadId } from "@t3tools/contracts";

export function shouldNavigateToStartupBootstrapThread(input: {
  readonly pathname: string;
  readonly bootstrapThreadId: ThreadId;
  readonly handledBootstrapThreadId: string | null;
  readonly isStandalonePwa: boolean;
}): boolean {
  if (input.isStandalonePwa) {
    return false;
  }

  if (input.pathname !== "/") {
    return false;
  }

  return input.handledBootstrapThreadId !== input.bootstrapThreadId;
}
