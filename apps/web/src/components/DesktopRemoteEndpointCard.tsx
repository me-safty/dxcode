import { type DesktopRemoteAddress } from "@t3tools/contracts";
import { QrCodeIcon } from "lucide-react";
import { useState } from "react";
import { CopyValueButton } from "./CopyValueButton";
import { DesktopRemoteQrCode } from "./DesktopRemoteQrCode";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";

export function DesktopRemoteEndpointCard(props: {
  readonly endpoint: DesktopRemoteAddress;
  readonly token: string;
  readonly useExpoDevScheme?: boolean;
}) {
  const [isQrOpen, setIsQrOpen] = useState(false);

  return (
    <Collapsible open={isQrOpen} onOpenChange={setIsQrOpen}>
      <div className="rounded-xl border border-border/70 bg-background/70 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="text-xs font-medium text-foreground">{props.endpoint.label}</div>
            <code className="block break-all text-[11px] text-muted-foreground">
              {props.endpoint.url}
            </code>
            <p className="text-[11px] text-muted-foreground">
              Tap the QR icon to reveal a scannable code with the current auth token.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            <Button
              size="icon-xs"
              variant={isQrOpen ? "secondary" : "outline"}
              aria-expanded={isQrOpen}
              aria-label={`${isQrOpen ? "Hide" : "Show"} ${props.endpoint.label} QR code`}
              onClick={() => setIsQrOpen((current) => !current)}
            >
              <QrCodeIcon className="size-3.5" />
            </Button>
            <CopyValueButton label={`${props.endpoint.label} URL`} value={props.endpoint.url} />
          </div>
        </div>

        <CollapsibleContent>
          <div className="pt-3">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 text-center transition-[opacity,transform] duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
              <DesktopRemoteQrCode
                endpointUrl={props.endpoint.url}
                label={props.endpoint.label}
                token={props.token}
                size={208}
                {...(props.useExpoDevScheme !== undefined
                  ? { useExpoDevScheme: props.useExpoDevScheme }
                  : {})}
              />
              <p className="max-w-xs text-xs text-muted-foreground">
                Scan with the mobile app camera or QR scanner while on the same LAN or Tailnet.
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
