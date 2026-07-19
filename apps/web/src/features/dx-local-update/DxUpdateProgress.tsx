import type { DxLocalUpdateState } from "@t3tools/contracts";
import { LoaderIcon } from "lucide-react";

export function DxUpdateProgress({ state }: { readonly state: DxLocalUpdateState }) {
  if (state.status !== "publishing" && state.status !== "building") return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/25 p-3 text-xs">
      <LoaderIcon className="size-4 animate-spin" />
      <span className="capitalize">{state.phase.replaceAll("-", " ")}</span>
    </div>
  );
}
