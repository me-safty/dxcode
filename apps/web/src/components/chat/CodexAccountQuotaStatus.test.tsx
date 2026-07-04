import { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { CodexAccountQuotaStatus } from "./CodexAccountQuotaStatus";

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async () => ({ _tag: "Success" }),
}));

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: (_environmentId: unknown, selector?: (settings: unknown) => unknown) => {
    const settings = {
      providers: {
        codex: {
          enabled: true,
        },
      },
      providerInstances: {},
    };
    return selector ? selector(settings) : settings;
  },
  useUpdateEnvironmentSettings: () => () => undefined,
}));

const decodeProvider = Schema.decodeSync(ServerProvider);

describe("CodexAccountQuotaStatus", () => {
  it("shows the active account and remaining primary/weekly quota", () => {
    const provider = decodeProvider({
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "0.1.0",
      status: "ready",
      auth: { status: "authenticated", email: "codex@example.com" },
      accountUsage: {
        email: "codex@example.com",
        planType: "plus",
        primary: { usedPercent: 5, windowDurationMins: 300 },
        secondary: { usedPercent: 11, windowDurationMins: 10_080 },
      },
      checkedAt: "2026-07-04T12:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    });

    const markup = renderToStaticMarkup(
      <CodexAccountQuotaStatus
        compact={false}
        environmentId={EnvironmentId.make("primary")}
        provider={provider}
      />,
    );

    expect(markup).toContain("codex@example.com");
    expect(markup).toContain("5h 95%");
    expect(markup).toContain("7d 89%");
    expect(markup).toContain('data-codex-account-quota="true"');
  });
});
