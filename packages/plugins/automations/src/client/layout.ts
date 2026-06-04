import type { Css } from "./types.ts";

export const filterGridStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(12rem, 18rem) minmax(9rem, 12rem)",
  gap: 8,
} satisfies Css;

export const twoColumnStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
  gap: 12,
} satisfies Css;
