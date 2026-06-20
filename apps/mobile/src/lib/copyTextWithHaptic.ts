import * as Schema from "effect/Schema";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

export class CopyTextClipboardWriteError extends Schema.TaggedErrorClass<CopyTextClipboardWriteError>()(
  "CopyTextClipboardWriteError",
  {
    operation: Schema.Literal("write-clipboard"),
    target: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to copy ${this.target} to the clipboard.`;
  }
}

export class CopyTextHapticFeedbackError extends Schema.TaggedErrorClass<CopyTextHapticFeedbackError>()(
  "CopyTextHapticFeedbackError",
  {
    operation: Schema.Literal("trigger-haptic-feedback"),
    target: Schema.String,
    feedback: Schema.Literals(["light-impact", "selection"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to trigger ${this.feedback} haptic feedback after copying ${this.target}.`;
  }
}

export function copyTextWithHaptic(
  value: string,
  options: {
    readonly target?: string;
    readonly feedback?: "light-impact" | "selection";
  } = {},
): void {
  const target = options.target ?? "text";
  const feedback = options.feedback ?? "light-impact";

  void (async () => {
    try {
      await Clipboard.setStringAsync(value);
    } catch (cause) {
      console.error(
        new CopyTextClipboardWriteError({
          operation: "write-clipboard",
          target,
          cause,
        }),
      );
    }
  })();

  void (async () => {
    try {
      if (feedback === "selection") {
        await Haptics.selectionAsync();
      } else {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (cause) {
      console.error(
        new CopyTextHapticFeedbackError({
          operation: "trigger-haptic-feedback",
          target,
          feedback,
          cause,
        }),
      );
    }
  })();
}
