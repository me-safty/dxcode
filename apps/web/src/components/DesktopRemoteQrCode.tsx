import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { LoaderIcon } from "lucide-react";
import { buildRemoteAppConnectionUrl } from "@t3tools/shared/remote";
import { cn } from "../lib/utils";

export function DesktopRemoteQrCode(props: {
  readonly endpointUrl: string;
  readonly label: string;
  readonly token: string;
  readonly className?: string;
  readonly size?: number;
  readonly useExpoDevScheme?: boolean;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const size = props.size ?? 96;

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setHasError(false);

    const deepLink = buildRemoteAppConnectionUrl({
      serverUrl: props.endpointUrl,
      authToken: props.token,
      ...(props.useExpoDevScheme !== undefined ? { useExpoDevScheme: props.useExpoDevScheme } : {}),
    });

    void QRCode.toDataURL(deepLink, {
      color: {
        dark: "#111827",
        light: "#FFFFFFFF",
      },
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6,
      width: size,
    })
      .then((nextDataUrl: string) => {
        if (cancelled) {
          return;
        }
        setDataUrl(nextDataUrl);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setHasError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [props.endpointUrl, props.token, props.useExpoDevScheme, size]);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border border-border/70 bg-white p-2 shadow-xs/5",
        props.className,
      )}
      style={{ width: size + 16, height: size + 16 }}
    >
      {dataUrl ? (
        <img
          alt={`${props.label} QR code`}
          className="rounded-[0.4rem] object-contain"
          height={size}
          src={dataUrl}
          width={size}
        />
      ) : hasError ? (
        <span className="px-1 text-center text-[10px] leading-tight text-muted-foreground">
          QR unavailable
        </span>
      ) : (
        <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
