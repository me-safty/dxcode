import { textAttachmentPaths } from "./textAttachmentPaths";

export function isTextAttachmentReferenced(path: string, prompts: ReadonlyArray<string>): boolean {
  return prompts.some((prompt) => textAttachmentPaths(prompt).includes(path));
}

export class DeferredTextAttachmentCleanup {
  readonly #delayMs: number;
  readonly #pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(delayMs = 1_000) {
    this.#delayMs = delayMs;
  }

  schedule(
    path: string,
    options: {
      isReferenced: () => boolean;
      deletePath: () => void | Promise<void>;
    },
  ): void {
    this.cancel(path);
    const timeout = setTimeout(() => {
      this.#pending.delete(path);
      if (!options.isReferenced()) void options.deletePath();
    }, this.#delayMs);
    this.#pending.set(path, timeout);
  }

  cancel(path: string): void {
    const timeout = this.#pending.get(path);
    if (timeout === undefined) return;
    clearTimeout(timeout);
    this.#pending.delete(path);
  }
}
