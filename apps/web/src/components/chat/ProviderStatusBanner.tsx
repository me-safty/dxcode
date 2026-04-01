import { PROVIDER_DISPLAY_NAMES, type ServerProvider } from "@t3tools/contracts";
import { memo } from "react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon } from "lucide-react";
import { PROVIDER_OPTIONS } from "~/session-logic";
import { ensureSentenceEnds } from "~/lib/utils";

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  status,
}: {
  status: ServerProvider | null;
}) {
  if (!status || status.status === "ready" || status.status === "disabled") {
    return null;
  }

  const providerLabel = PROVIDER_DISPLAY_NAMES[status.provider] ?? status.provider;
  const defaultMessage =
    status.status === "error"
      ? `${providerLabel} provider is unavailable.`
      : `${providerLabel} provider has limited availability.`;
  const title = `${providerLabel} provider status`;

  const opts = PROVIDER_OPTIONS.find((opt) => opt.value === status.provider);

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={status.status === "error" ? "error" : "warning"}>
        <CircleAlertIcon />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={status.message ?? defaultMessage}>
          {ensureSentenceEnds(status.message ?? defaultMessage)}
          {opts?.docsUrl ? (
            <>
              {" "}
              <a
                className="underline underline-offset-4 text-foreground hover:text-primary"
                href={opts.docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Installation Guide
              </a>
            </>
          ) : null}
        </AlertDescription>
      </Alert>
    </div>
  );
});
