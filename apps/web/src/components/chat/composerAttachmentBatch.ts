export function currentComposerImageCount(
  draft: { readonly images: ReadonlyArray<unknown> } | null,
  fallbackImages: ReadonlyArray<unknown>,
): number {
  return draft?.images.length ?? fallbackImages.length;
}
