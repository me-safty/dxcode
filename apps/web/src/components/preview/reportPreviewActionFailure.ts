export interface PreviewActionFailureContext {
  readonly operation: string;
  readonly threadKey?: string;
  readonly tabId?: string;
  readonly url?: string;
  readonly artifactPath?: string;
  readonly annotationId?: string;
  readonly trigger?: string;
}

export function reportPreviewActionFailure(
  context: PreviewActionFailureContext,
  cause: unknown,
): void {
  console.error("[preview] action failed", context, cause);
}
