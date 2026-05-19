import { useEffect, useMemo, useState } from "react";

const ICON_RETRY_BACKOFF_MS = [15_000, 45_000, 120_000, 300_000] as const;

function readObjectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function readProjectAvatarUrl(raw: unknown): string | undefined {
  const record = readObjectRecord(raw);
  return (
    readOptionalString(record.avatarDataUrl) ??
    readOptionalString(record.avatarUrl) ??
    readOptionalString(record.iconUrl)
  );
}

export function ProjectAvatar({
  title,
  projectKey,
  raw,
  iconUrl,
  className,
}: {
  title: string;
  projectKey?: string | undefined;
  raw?: unknown;
  iconUrl?: string | undefined;
  className?: string | undefined;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const color = (readObjectRecord(raw).avatarColor as string | undefined) ?? "#1868db";
  const resolvedIconUrl = iconUrl ?? readProjectAvatarUrl(raw);
  const shouldRetry = Boolean(resolvedIconUrl) && !resolvedIconUrl?.startsWith("data:");
  const iconSrc = useMemo(() => {
    if (!resolvedIconUrl || retryAttempt === 0 || !shouldRetry) {
      return resolvedIconUrl;
    }
    return `${resolvedIconUrl}${resolvedIconUrl.includes("?") ? "&" : "?"}t3-icon-retry=${retryAttempt}`;
  }, [resolvedIconUrl, retryAttempt, shouldRetry]);
  const shortKey = (projectKey ?? title).slice(0, 2).toUpperCase();
  const defaultClassName = "size-6 shrink-0 rounded-md";
  const resolvedClassName = className ?? defaultClassName;
  const fallbackClassName = useMemo(
    () => `flex items-center justify-center ${resolvedClassName}`,
    [resolvedClassName],
  );

  useEffect(() => {
    setImageFailed(false);
    setRetryAttempt(0);
  }, [resolvedIconUrl]);

  useEffect(() => {
    if (!resolvedIconUrl || !imageFailed || !shouldRetry) {
      return;
    }
    const backoffIndex = Math.min(retryAttempt, ICON_RETRY_BACKOFF_MS.length - 1);
    const timeoutId = window.setTimeout(() => {
      setRetryAttempt((current) => current + 1);
      setImageFailed(false);
    }, ICON_RETRY_BACKOFF_MS[backoffIndex]);
    return () => window.clearTimeout(timeoutId);
  }, [imageFailed, resolvedIconUrl, retryAttempt, shouldRetry]);

  if (resolvedIconUrl && !imageFailed) {
    return (
      <img
        src={iconSrc}
        alt={`${title} icon`}
        className={`${resolvedClassName} object-cover`}
        loading="lazy"
        decoding="async"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div className={fallbackClassName} style={{ background: color }} aria-hidden="true">
      <span className="text-[10px] font-semibold text-white">{shortKey}</span>
    </div>
  );
}
