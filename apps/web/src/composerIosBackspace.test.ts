import {
  $applyNodeReplacement,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  DELETE_CHARACTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  createEditor,
  type LexicalEditor,
} from "lexical";
import { describe, expect, it } from "vitest";

import {
  $shouldUseNativeComposerBackspace,
  registerComposerIosBackspaceCommand,
} from "./composerIosBackspace";

class TestDecoratorNode extends DecoratorNode<null> {
  static override getType(): string {
    return "test-decorator";
  }

  static override clone(node: TestDecoratorNode): TestDecoratorNode {
    return new TestDecoratorNode(node.__key);
  }

  override createDOM(): HTMLElement {
    return typeof document === "undefined" ? ({} as HTMLElement) : document.createElement("span");
  }

  override updateDOM(): false {
    return false;
  }

  override isInline(): true {
    return true;
  }

  override decorate(): null {
    return null;
  }
}

function $createTestDecoratorNode(): TestDecoratorNode {
  return $applyNodeReplacement(new TestDecoratorNode());
}

function createTestEditor(): LexicalEditor {
  return createEditor({
    namespace: "composer-ios-backspace-test",
    nodes: [TestDecoratorNode],
    onError: (error) => {
      throw error;
    },
  });
}

function readBackspaceDecision(setup: () => void): boolean {
  const editor = createTestEditor();
  let result = false;

  editor.update(
    () => {
      setup();
      result = $shouldUseNativeComposerBackspace($getSelection());
    },
    { discrete: true },
  );

  return result;
}

function createKeyboardEventLike(): KeyboardEvent & { defaultPrevented: boolean } {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  } as KeyboardEvent & { defaultPrevented: boolean };
}

describe("$shouldUseNativeComposerBackspace", () => {
  it("allows native Backspace for collapsed plain text", () => {
    const result = readBackspaceDecision(() => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const text = $createTextNode("hello");
      root.append(paragraph);
      paragraph.append(text);
      text.select(5, 5);
    });

    expect(result).toBe(true);
  });

  it("allows native Backspace for expanded plain-text selection", () => {
    const result = readBackspaceDecision(() => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const text = $createTextNode("hello");
      root.append(paragraph);
      paragraph.append(text);
      text.select(1, 4);
    });

    expect(result).toBe(true);
  });

  it("allows native Backspace when a decorator precedes a mid-text caret", () => {
    const result = readBackspaceDecision(() => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const decorator = $createTestDecoratorNode();
      const text = $createTextNode("hello");
      root.append(paragraph);
      paragraph.append(decorator, text);
      text.select(3, 3);
    });

    expect(result).toBe(true);
  });

  it("uses Lexical deletion when Backspace would hit an adjacent decorator", () => {
    const result = readBackspaceDecision(() => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const decorator = $createTestDecoratorNode();
      const text = $createTextNode("hello");
      root.append(paragraph);
      paragraph.append(decorator, text);
      text.select(0, 0);
    });

    expect(result).toBe(false);
  });

  it("uses Lexical deletion when selection contains a decorator", () => {
    const result = readBackspaceDecision(() => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const before = $createTextNode("before");
      const decorator = $createTestDecoratorNode();
      const after = $createTextNode("after");
      root.append(paragraph);
      paragraph.append(before, decorator, after);

      const selection = $createRangeSelection();
      selection.anchor.set(before.getKey(), 0, "text");
      selection.focus.set(after.getKey(), 5, "text");
      $setSelection(selection);
    });

    expect(result).toBe(false);
  });

  it("uses Lexical deletion at start of paragraph after a previous paragraph ending in a decorator", () => {
    const result = readBackspaceDecision(() => {
      const root = $getRoot();
      const previousParagraph = $createParagraphNode();
      const currentParagraph = $createParagraphNode();
      const decorator = $createTestDecoratorNode();
      const text = $createTextNode("hello");
      root.append(previousParagraph, currentParagraph);
      previousParagraph.append(decorator);
      currentParagraph.append(text);
      text.select(0, 0);
    });

    expect(result).toBe(false);
  });

  it("uses Lexical deletion for element-anchor offset 0 after a decorator paragraph", () => {
    const result = readBackspaceDecision(() => {
      const root = $getRoot();
      const previousParagraph = $createParagraphNode();
      const currentParagraph = $createParagraphNode();
      const decorator = $createTestDecoratorNode();
      root.append(previousParagraph, currentParagraph);
      previousParagraph.append(decorator);
      currentParagraph.selectStart();
    });

    expect(result).toBe(false);
  });

  it("uses Lexical deletion for element-anchor offset greater than 0 next to a decorator child", () => {
    const result = readBackspaceDecision(() => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const decorator = $createTestDecoratorNode();
      const text = $createTextNode("hello");
      root.append(paragraph);
      paragraph.append(decorator, text);
      paragraph.select(1, 1);
    });

    expect(result).toBe(false);
  });
});

describe("registerComposerIosBackspaceCommand", () => {
  it("falls through when native Backspace is disabled", () => {
    const editor = createTestEditor();
    let deleteCharacterDispatched = false;

    registerComposerIosBackspaceCommand(editor, false);
    editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      () => {
        deleteCharacterDispatched = true;
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const event = createKeyboardEventLike();

    expect(editor.dispatchCommand(KEY_BACKSPACE_COMMAND, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(deleteCharacterDispatched).toBe(false);
  });

  it("handles native-safe Backspace without preventing default or dispatching delete", () => {
    const editor = createTestEditor();
    let deleteCharacterDispatched = false;

    registerComposerIosBackspaceCommand(editor, true);
    editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      () => {
        deleteCharacterDispatched = true;
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    editor.update(
      () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const text = $createTextNode("hello");
        root.append(paragraph);
        paragraph.append(text);
        text.select(5, 5);
      },
      { discrete: true },
    );

    const event = createKeyboardEventLike();

    expect(editor.dispatchCommand(KEY_BACKSPACE_COMMAND, event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(deleteCharacterDispatched).toBe(false);
  });

  it("prevents default and dispatches delete when Backspace would hit a decorator", () => {
    const editor = createTestEditor();
    let deleteCharacterDirection: boolean | undefined;

    registerComposerIosBackspaceCommand(editor, true);
    editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      (isBackward) => {
        deleteCharacterDirection = isBackward;
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    editor.update(
      () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const decorator = $createTestDecoratorNode();
        const text = $createTextNode("hello");
        root.append(paragraph);
        paragraph.append(decorator, text);
        text.select(0, 0);
      },
      { discrete: true },
    );

    const event = createKeyboardEventLike();

    expect(editor.dispatchCommand(KEY_BACKSPACE_COMMAND, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(deleteCharacterDirection).toBe(true);
  });
});
