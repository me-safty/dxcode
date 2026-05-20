import type { ChatAttachment } from "../../types";
import { cn } from "../../lib/utils";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";

interface MessageImageGridProps {
  images: ReadonlyArray<ChatAttachment>;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  className?: string | undefined;
}

export function MessageImageGrid({ images, onImageExpand, className }: MessageImageGridProps) {
  if (images.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "grid max-w-[420px] grid-cols-2 gap-2",
        images.length === 1 ? "grid-cols-1" : null,
        className,
      )}
    >
      {images.map((image) => (
        <div
          key={image.id}
          className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
        >
          {image.previewUrl ? (
            <button
              type="button"
              className="h-full w-full cursor-zoom-in"
              aria-label={`Preview ${image.name}`}
              onClick={() => {
                const preview = buildExpandedImagePreview(images, image.id);
                if (!preview) return;
                onImageExpand(preview);
              }}
            >
              <img
                src={image.previewUrl}
                alt={image.name}
                className="block h-auto max-h-[220px] w-full object-cover"
                loading="lazy"
              />
            </button>
          ) : (
            <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/70">
              {image.name}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
