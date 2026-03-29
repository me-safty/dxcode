import { memo } from "react";
import { useSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";

export function hasNonZeroStat(stat: { additions: number; deletions: number }): boolean {
  return stat.additions > 0 || stat.deletions > 0;
}

// GitHub Primer colorblind palette (protanopia/deuteranopia).
const CB_STYLES = {
  light: {
    addition: { color: "#0969da" },
    deletion: { color: "#bc4c00" },
  },
  dark: {
    addition: { color: "#388bfd" },
    deletion: { color: "#db6d28" },
  },
} as const;

export const DiffStatLabel = memo(function DiffStatLabel(props: {
  additions: number;
  deletions: number;
  showParentheses?: boolean;
}) {
  const { additions, deletions, showParentheses = false } = props;
  const { colorblindMode } = useSettings();
  const { resolvedTheme } = useTheme();
  const cb = colorblindMode ? CB_STYLES[resolvedTheme] : null;

  return (
    <>
      {showParentheses && <span className="text-muted-foreground/70">(</span>}
      {cb ? (
        <span style={cb.addition}>+{additions}</span>
      ) : (
        <span className="text-success">+{additions}</span>
      )}
      <span className="mx-0.5 text-muted-foreground/70">/</span>
      {cb ? (
        <span style={cb.deletion}>-{deletions}</span>
      ) : (
        <span className="text-destructive">-{deletions}</span>
      )}
      {showParentheses && <span className="text-muted-foreground/70">)</span>}
    </>
  );
});
