import { type ExecutionRunCreateRequest, type ModelSelection } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { getAutoBootstrapDefaultModelSelection } from "../serverRuntimeStartup.ts";

export function resolveExecutionBridgeModelSelection(
  request: Pick<ExecutionRunCreateRequest, "modelSelection">,
  existingProjectDefault: ModelSelection | null,
) {
  const hasProcessDefault =
    process.env.T3_DEFAULT_PROVIDER_INSTANCE_ID?.trim() || process.env.T3_DEFAULT_MODEL?.trim();
  const processDefault = hasProcessDefault ? getAutoBootstrapDefaultModelSelection() : null;
  return (
    request.modelSelection ??
    processDefault ??
    existingProjectDefault ??
    getAutoBootstrapDefaultModelSelection()
  );
}

export function modelSelectionFromOptionalProject(
  request: Pick<ExecutionRunCreateRequest, "modelSelection">,
  existingProject: Option.Option<{ readonly defaultModelSelection: ModelSelection | null }>,
) {
  return resolveExecutionBridgeModelSelection(
    request,
    Option.isSome(existingProject) ? existingProject.value.defaultModelSelection : null,
  );
}
