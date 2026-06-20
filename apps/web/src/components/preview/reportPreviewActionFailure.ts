export interface PreviewActionFailureContext {
  readonly operation: string;
  readonly threadKey?: string;
  readonly tabId?: string;
  readonly urlHostname?: string;
  readonly urlLength?: number;
  readonly urlProtocol?: string;
  readonly artifactPath?: string;
  readonly annotationId?: string;
  readonly trigger?: string;
}

export function previewUrlFailureContext(url: string) {
  let urlHostname: string | undefined;
  let urlProtocol: string | undefined;
  try {
    const parsed = new URL(url);
    urlHostname = parsed.hostname || undefined;
    urlProtocol = parsed.protocol || undefined;
  } catch {
    // Invalid targets still retain a nonsecret input length for diagnostics.
  }
  return {
    urlLength: url.length,
    ...(urlHostname === undefined ? {} : { urlHostname }),
    ...(urlProtocol === undefined ? {} : { urlProtocol }),
  };
}

export function reportPreviewActionFailure(
  context: PreviewActionFailureContext,
  cause: unknown,
): void {
  console.error("[preview] action failed", context, cause);
}
