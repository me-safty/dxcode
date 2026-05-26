import { describe, expect, it } from "vitest";
import { ProviderInstanceId } from "@t3tools/contracts";

import { buildStartChildModelSelection } from "./t3work-toolBrokerStartChildArgs.ts";

describe("buildStartChildModelSelection", () => {
  it("normalizes codex model aliases from start_child tool args", () => {
    const selection = buildStartChildModelSelection(
      {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
      {
        model: "gpt-5",
        reasoningEffort: "medium",
      },
    );

    expect(selection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "medium" }],
    });
  });
});
