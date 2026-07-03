import { memo, type ReactNode, useCallback } from "react";

import type { ValidationDiagnostic } from "@mosaicjs/core";
import { Mosaic } from "@mosaicjs/react";

import { useMosaicAutocorrect } from "./autocorrect";
import { mosaicComponents } from "./blocks";
import { useMosaicIntent } from "./intent";

/** Pulls the artifact id out of fence meta: ` ```mosaic v=1 id=seat-estimator `. */
export function extractMosaicArtifactId(meta: string | undefined): string | null {
  const match = meta === undefined ? null : /(?:^|\s)id=([A-Za-z0-9_-]+)/.exec(meta);
  return match?.[1] ?? null;
}

/**
 * The readable floor: the raw Mosaic source, shown quietly (no error line) while
 * an artifact is still streaming - a partial tree never parses - and for a final
 * artifact that does not parse at all.
 */
function MosaicSource({ source }: { source: string }): ReactNode {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <pre className="overflow-auto whitespace-pre-wrap font-mono text-muted-foreground text-xs leading-relaxed">
        {source}
      </pre>
    </div>
  );
}

/** Stable <Mosaic fallback> renderer for source that does not parse. */
const renderMosaicSource = (source: string): ReactNode => <MosaicSource source={source} />;

/** Formats one validation finding the way the correction channel expects. */
function formatDiagnostic(d: ValidationDiagnostic): string {
  return `${d.path} <${d.type}> ${d.code}${d.prop ? ` (${d.prop})` : ""}${
    d.fix ? ` - fix: ${d.fix}` : ""
  }`;
}

/** Each broken artifact asks the agent for a fix at most once per session. */
const reportedArtifacts = new Set<string>();

/**
 * Renders one `\`\`\`mosaic` artifact from an assistant reply as native,
 * interactive UI. The library {@link Mosaic} owns parsing, the reactive loop
 * (local `state.*`, derived `expr`, `if:show`), streaming completion, and the
 * per-node error boundaries; every block is drawn by t3code's own
 * {@link mosaicComponents}, so the artifact wears the app's look. Host intents
 * flow out through {@link useMosaicIntent}.
 *
 * Validation is advisory: a final artifact's diagnostics are reported once
 * through {@link useMosaicAutocorrect} for the agent to correct, never shown on
 * screen or used to blank the render. Only genuinely unparseable source (still
 * streaming, or truly malformed) falls back to showing its text.
 */
function MosaicArtifactImpl({
  source,
  artifactId = null,
  isStreaming = false,
}: {
  source: string;
  artifactId?: string | null;
  isStreaming?: boolean;
}): ReactNode {
  const onIntent = useMosaicIntent();
  const autocorrect = useMosaicAutocorrect();

  // Hand a final artifact's validation errors to the agent once. The library
  // fires this per distinct source; the streaming guard drops partial-prefix
  // diagnostics, and the set guards against a remount re-reporting the same one.
  const onDiagnostics = useCallback(
    (diagnostics: ValidationDiagnostic[]): void => {
      if (isStreaming || autocorrect === null || diagnostics.length === 0) return;
      const formatted = diagnostics.map(formatDiagnostic).join("\n");
      const key = `${artifactId ?? source} ${formatted}`;
      if (reportedArtifacts.has(key)) return;
      reportedArtifacts.add(key);
      autocorrect({ artifactId, source, diagnostics: formatted });
    },
    [artifactId, autocorrect, isStreaming, source],
  );

  return (
    <div className="chat-mosaic-artifact my-2 w-full min-w-0">
      <Mosaic
        source={source}
        components={mosaicComponents}
        isStreaming={isStreaming}
        onIntent={onIntent}
        onDiagnostics={onDiagnostics}
        fallback={renderMosaicSource}
      />
    </div>
  );
}

export const MosaicArtifact = memo(MosaicArtifactImpl);
