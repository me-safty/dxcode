import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId } from "@t3tools/contracts";

import {
  buildStartChildModelSelection,
  readStartChildArgs,
} from "./t3work-toolBrokerStartChildArgs.ts";

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

describe("readStartChildArgs", () => {
  it("accepts a repo-scoped child request with a base ref", () => {
    expect(
      readStartChildArgs({
        name: "Review repo child",
        repo_full_name: "pingdotgg/t3code",
        repo_ref: "release/7.0",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Review repo child",
        repoFullName: "pingdotgg/t3code",
        repoRef: "release/7.0",
      },
    });
  });

  it("rejects repo_ref without repo_full_name", () => {
    expect(
      readStartChildArgs({
        name: "Detached child",
        repo_ref: "abc1234",
      }),
    ).toEqual({
      ok: false,
      message:
        "t3work.thread.start_child 'repo_ref' requires 'repo_full_name' so the child can be scoped to a linked repository.",
    });
  });
});
