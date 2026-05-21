import { createRef, type RefObject } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { ServerProviderSkill } from "@t3tools/contracts";
import type { TerminalContextDraft } from "~/lib/terminalContext";
import { type ComposerPromptEditorHandle, ComposerPromptEditor } from "./ComposerPromptEditor";

const EMPTY_TERMINAL_CONTEXTS: TerminalContextDraft[] = [];
const EMPTY_SKILLS: ServerProviderSkill[] = [];

async function waitForLayout(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function renderComposer(input: {
  value: string;
  cursor: number;
  editorRef: RefObject<ComposerPromptEditorHandle | null>;
}) {
  return (
    <ComposerPromptEditor
      value={input.value}
      cursor={input.cursor}
      terminalContexts={EMPTY_TERMINAL_CONTEXTS}
      skills={EMPTY_SKILLS}
      disabled={false}
      placeholder="Ask anything"
      onRemoveTerminalContext={() => {}}
      onChange={() => {}}
      onPaste={() => {}}
      editorRef={input.editorRef}
    />
  );
}

describe("ComposerPromptEditor controlled selection sync", () => {
  it("does not replay focused cursor-only prop updates into the live editor selection", async () => {
    const editorRef = createRef<ComposerPromptEditorHandle>();
    const screen = await render(
      renderComposer({
        value: "hello",
        cursor: 0,
        editorRef,
      }),
    );

    try {
      await expect.poll(() => editorRef.current !== null).toBe(true);

      editorRef.current?.focusAt(2);
      await waitForLayout();
      expect(editorRef.current?.readSnapshot().cursor).toBe(2);

      await screen.rerender(
        renderComposer({
          value: "hello",
          cursor: 5,
          editorRef,
        }),
      );
      await waitForLayout();

      expect(editorRef.current?.readSnapshot().cursor).toBe(2);
    } finally {
      await screen.unmount();
    }
  });

  it("still applies focused controlled value updates", async () => {
    const editorRef = createRef<ComposerPromptEditorHandle>();
    const screen = await render(
      renderComposer({
        value: "hello",
        cursor: 0,
        editorRef,
      }),
    );

    try {
      await expect.poll(() => editorRef.current !== null).toBe(true);

      editorRef.current?.focusAt(2);
      await waitForLayout();

      await screen.rerender(
        renderComposer({
          value: "hello world",
          cursor: "hello world".length,
          editorRef,
        }),
      );
      await waitForLayout();

      expect(editorRef.current?.readSnapshot()).toMatchObject({
        value: "hello world",
        cursor: "hello world".length,
      });
    } finally {
      await screen.unmount();
    }
  });
});
