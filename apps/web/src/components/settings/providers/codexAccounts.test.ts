import { describe, expect, it } from "vite-plus/test";

import { buildCodexAccountSwitchConfig } from "../../../lib/codexAccounts.ts";
import { compactCodexUsage } from "../../../lib/codexUsage.ts";
import { codexProfileLabel, importedCodexAccounts } from "./codexAccounts.ts";

describe("codexAccounts", () => {
  it("prepares imported Codex Desktop profiles as managed auth overlays", () => {
    expect(
      importedCodexAccounts(
        ["/Users/test/Library/Application Support/Codex Accounts/account-2/codex-home"],
        42,
      ),
    ).toEqual([
      {
        id: "acct_42_0",
        label: "account-2",
        shadowHomePath: "~/.t3/codex/accounts/acct_42_0",
        authSourceHomePath:
          "/Users/test/Library/Application Support/Codex Accounts/account-2/codex-home",
        enabled: true,
      },
    ]);
  });

  it("uses the account directory as the imported profile label", () => {
    expect(codexProfileLabel("C:\\Codex Accounts\\account-6\\codex-home", 0)).toBe("account-6");
  });

  it("formats remaining primary and weekly usage", () => {
    expect(
      compactCodexUsage({
        primary: { usedPercent: 5 },
        secondary: { usedPercent: 11 },
      }),
    ).toBe("95% 5h · 89% weekly");
  });

  it("switches to an imported backup and keeps the previous active account as backup", () => {
    expect(
      buildCodexAccountSwitchConfig({
        config: {
          activeAccountId: "acct_a",
          activeAccountLabel: "Personal",
          shadowHomePath: "~/.t3/codex/accounts/acct_a",
          authSourceHomePath: "/Users/test/Codex Accounts/account-a/codex-home",
          secondaryAccounts: [
            {
              id: "acct_b",
              label: "Work",
              shadowHomePath: "/Users/test/Codex Accounts/account-b",
              enabled: true,
            },
          ],
        },
        accountId: "acct_b",
        resolvedHomePath: "/Users/test/Codex Accounts/account-b/codex-home",
      }),
    ).toEqual({
      activeAccountId: "acct_b",
      activeAccountLabel: "Work",
      shadowHomePath: "~/.t3/codex/accounts/acct_b",
      authSourceHomePath: "/Users/test/Codex Accounts/account-b/codex-home",
      secondaryAccounts: [
        {
          id: "acct_a",
          label: "Personal",
          shadowHomePath: "~/.t3/codex/accounts/acct_a",
          authSourceHomePath: "/Users/test/Codex Accounts/account-a/codex-home",
          enabled: true,
        },
      ],
    });
  });
});
