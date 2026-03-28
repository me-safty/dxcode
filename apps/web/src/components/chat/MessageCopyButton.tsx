import { memo } from "react";
import { CopyIcon, CheckIcon } from "lucide-react";
import { Button } from "../ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

export const MessageCopyButton = memo(function MessageCopyButton({
  text,
  label = "Copy message",
}: {
  text: string | (() => string);
  label?: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      onClick={() => copyToClipboard(typeof text === "function" ? text() : text)}
      title={isCopied ? label.replace(/^Copy\s+/i, "Copied ") : label}
      aria-label={isCopied ? label.replace(/^Copy\s+/i, "Copied ") : label}
    >
      {isCopied ? <CheckIcon className="size-3 text-success" /> : <CopyIcon className="size-3" />}
    </Button>
  );
});
