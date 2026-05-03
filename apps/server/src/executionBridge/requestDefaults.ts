import { type ExecutionRunCreateRequest, type ModelSelection } from "@t3tools/contracts";
import { Option } from "effect";

import { getAutoBootstrapDefaultModelSelection } from "../serverRuntimeStartup.ts";

export function resolveExecutionBridgeModelSelection(
  request: Pick<ExecutionRunCreateRequest, "modelSelection">,
  existingProjectDefault: ModelSelection | null,
) {
  return (
    request.modelSelection ?? existingProjectDefault ?? getAutoBootstrapDefaultModelSelection()
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
