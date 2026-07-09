import type { VcsStatusResult } from "@t3tools/contracts";

export type ThreadPr = NonNullable<VcsStatusResult["pr"]>;

export interface ThreadPrPresentation {
  readonly number: number;
  readonly state: ThreadPr["state"];
  readonly url: string;
  /** Compact desktop-style label, e.g. "#3774". */
  readonly label: string;
  readonly textClassName: string;
}

const PR_STATE_TEXT_CLASS: Record<ThreadPr["state"], string> = {
  open: "text-emerald-600 dark:text-emerald-400",
  merged: "text-violet-600 dark:text-violet-400",
  closed: "text-zinc-500 dark:text-zinc-400",
};

export function presentThreadPr(pr: ThreadPr): ThreadPrPresentation {
  return {
    number: pr.number,
    state: pr.state,
    url: pr.url,
    label: `#${pr.number}`,
    textClassName: PR_STATE_TEXT_CLASS[pr.state],
  };
}
