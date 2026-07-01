import { memo } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { CircleAlertIcon, XIcon } from "lucide-react";

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="mx-auto w-full max-w-5xl px-3 pt-3 sm:px-5">
      <Alert variant="error" className="[&>div]:items-start">
        <CircleAlertIcon />
        <AlertTitle>Message failed</AlertTitle>
        <AlertDescription className="whitespace-pre-wrap leading-relaxed wrap-anywhere">
          {error}
        </AlertDescription>
        {onDismiss && (
          <AlertAction className="pt-0.5">
            <Button variant="ghost" size="icon-xs" aria-label="Dismiss error" onClick={onDismiss}>
              <XIcon className="text-destructive" />
            </Button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
});
