import { DiffWorkerPoolProvider } from "../../components/DiffWorkerPoolProvider";
import { useWorkspaceActions } from "../../components/workspace/WorkspaceProvider";
import DiffPanel from "../../components/DiffPanel";
import type { DiffSurface } from "./diffSurface";
import { useCallback } from "react";

export default function RegisteredDiffSurface(props: {
  surface: DiffSurface;
  renderMode: "sidebar" | "sheet";
}) {
  const { updateSurface } = useWorkspaceActions();
  const onFocusChange = useCallback(
    (focus: DiffSurface["input"]["focus"], options?: { replace?: boolean }) => {
      updateSurface(
        "secondary",
        "diff",
        {
          threadRef: props.surface.input.threadRef,
          focus,
        },
        { replace: options?.replace ?? false },
      );
    },
    [props.surface.input.threadRef, updateSurface],
  );

  return (
    <DiffWorkerPoolProvider>
      <DiffPanel
        threadRef={props.surface.input.threadRef}
        focus={props.surface.input.focus}
        mode={props.renderMode}
        onFocusChange={onFocusChange}
      />
    </DiffWorkerPoolProvider>
  );
}
