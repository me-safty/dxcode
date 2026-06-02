import {
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  DELETE_CHARACTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  type BaseSelection,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
} from "lexical";

export function canUseBeforeInput(): boolean {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof window.InputEvent === "undefined"
  ) {
    return false;
  }

  const documentMode = "documentMode" in document ? document.documentMode : null;
  return !documentMode && "getTargetRanges" in new window.InputEvent("input");
}

export function $containsDecoratorNode(node: LexicalNode | null): boolean {
  if (!node) return false;
  if ($isDecoratorNode(node)) return true;
  if (!$isElementNode(node)) return false;
  return node.getChildren().some($containsDecoratorNode);
}

export function $backspaceHitsDecoratorNode(selection: RangeSelection): boolean {
  const { anchor } = selection;
  if (anchor.type === "element") {
    const node = anchor.getNode();
    if (anchor.offset === 0) {
      const topBlock = node.getTopLevelElement() ?? node;
      return $containsDecoratorNode(topBlock.getPreviousSibling());
    }
    return $containsDecoratorNode(node.getChildAtIndex(anchor.offset - 1));
  }

  if (anchor.offset !== 0) return false;
  const textNode = anchor.getNode();
  if ($containsDecoratorNode(textNode.getPreviousSibling())) return true;

  const topBlock = textNode.getTopLevelElement();
  if (topBlock?.getFirstDescendant() !== textNode) return false;
  return $containsDecoratorNode(topBlock.getPreviousSibling());
}

export function $shouldUseNativeComposerBackspace(selection: BaseSelection | null): boolean {
  if (!$isRangeSelection(selection)) return false;
  if (selection.getNodes().some($containsDecoratorNode)) return false;
  return !selection.isCollapsed() || !$backspaceHitsDecoratorNode(selection);
}

export function registerComposerIosBackspaceCommand(
  editor: LexicalEditor,
  useNativeBackspace: boolean,
): () => void {
  return editor.registerCommand(
    KEY_BACKSPACE_COMMAND,
    (event) => {
      if (!useNativeBackspace) return false;

      const selection = $getSelection();
      if ($shouldUseNativeComposerBackspace(selection)) return true;
      if (!$isRangeSelection(selection)) return false;

      event?.preventDefault();
      return editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true);
    },
    COMMAND_PRIORITY_HIGH,
  );
}
