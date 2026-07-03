import { createContext, useContext } from "react";

/**
 * What the renderer reports when a *final* (non-streaming) artifact fails to
 * compile or validate. The diagnostics are the compiler's structured output,
 * already formatted for a model to act on.
 */
export interface MosaicInvalidReport {
  /** The fence id (` ```mosaic v=1 id=… `), when the model provided one. */
  artifactId: string | null;
  /** The raw mosaic-jsx source that failed. */
  source: string;
  /** One diagnostic per line, e.g. `14:5 INVALID_DIRECTIVE: if:show takes a string`. */
  diagnostics: string;
}

/**
 * The correction sink. The provider decides what "auto-correct" means - the
 * default is nothing (broken artifacts just show their source), and ChatView
 * overrides it with a sender that hands the diagnostics back to the agent as
 * a follow-up turn so it can re-emit a fixed artifact.
 */
export type MosaicAutocorrect = (report: MosaicInvalidReport) => void;

const MosaicAutocorrectContext = createContext<MosaicAutocorrect | null>(null);

export const MosaicAutocorrectProvider = MosaicAutocorrectContext.Provider;

export function useMosaicAutocorrect(): MosaicAutocorrect | null {
  return useContext(MosaicAutocorrectContext);
}

/**
 * The follow-up turn a correction sender submits. Kept here so the message
 * wording lives next to the contract; the model sees its own diagnostics and
 * the instruction to re-emit under the same id (so the app can treat the new
 * artifact as the replacement).
 */
export function formatCorrectionPrompt(report: MosaicInvalidReport): string {
  const identity = report.artifactId !== null ? ` (id=${report.artifactId})` : "";
  return [
    `Your Mosaic artifact${identity} failed to compile. Diagnostics:`,
    "",
    report.diagnostics,
    "",
    `Re-emit the corrected artifact in a \`\`\`mosaic fence${
      report.artifactId !== null ? ` with the same id=${report.artifactId}` : ""
    }. Fix only what the diagnostics call out; keep the content unchanged.`,
  ].join("\n");
}
