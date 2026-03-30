import * as React from "react";

function fallbackCopyText(value: string): boolean {
  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.focus();
  textArea.select();

  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } finally {
    textArea.remove();
    activeElement?.focus();
  }
}

export function useCopyToClipboard<TContext = void>({
  timeout = 2000,
  onCopy,
  onError,
}: {
  timeout?: number;
  onCopy?: (ctx: TContext) => void;
  onError?: (error: Error, ctx: TContext) => void;
} = {}): { copyToClipboard: (value: string, ctx: TContext) => void; isCopied: boolean } {
  const [isCopied, setIsCopied] = React.useState(false);
  const timeoutIdRef = React.useRef<NodeJS.Timeout | null>(null);
  const onCopyRef = React.useRef(onCopy);
  const onErrorRef = React.useRef(onError);
  const timeoutRef = React.useRef(timeout);

  onCopyRef.current = onCopy;
  onErrorRef.current = onError;
  timeoutRef.current = timeout;

  const copyToClipboard = React.useCallback((value: string, ctx: TContext): void => {
    if (!value) return;

    const handleCopySuccess = (): void => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }
      setIsCopied(true);

      onCopyRef.current?.(ctx);

      if (timeoutRef.current !== 0) {
        timeoutIdRef.current = setTimeout(() => {
          setIsCopied(false);
          timeoutIdRef.current = null;
        }, timeoutRef.current);
      }
    };

    const handleCopyError = (error: Error): void => {
      if (onErrorRef.current) {
        onErrorRef.current(error, ctx);
      } else {
        console.error(error);
      }
    };

    if (typeof window === "undefined") {
      handleCopyError(new Error("Clipboard API unavailable."));
      return;
    }

    if (!navigator.clipboard?.writeText) {
      if (fallbackCopyText(value)) {
        handleCopySuccess();
        return;
      }
      handleCopyError(new Error("Clipboard API unavailable."));
      return;
    }

    navigator.clipboard.writeText(value).then(handleCopySuccess, (error) => {
      if (fallbackCopyText(value)) {
        handleCopySuccess();
        return;
      }
      handleCopyError(error instanceof Error ? error : new Error(String(error)));
    });
  }, []);

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return (): void => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }
    };
  }, []);

  return { copyToClipboard, isCopied };
}
