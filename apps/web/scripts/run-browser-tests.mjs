import { spawnSync } from "node:child_process";

const chunks = [
  {
    name: "chat view",
    files: ["src/components/ChatView.browser.tsx"],
  },
  {
    name: "chat markdown",
    files: ["src/components/ChatMarkdown.browser.tsx"],
  },
  {
    name: "component browser suite",
    files: [
      "src/components/GitActionsControl.browser.tsx",
      "src/components/KeybindingsToast.browser.tsx",
      "src/components/ThreadTerminalDrawer.browser.tsx",
      "src/components/chat/MessagesTimeline.browser.tsx",
      "src/components/chat/ProviderModelPicker.browser.tsx",
      "src/components/chat/CompactComposerControlsMenu.browser.tsx",
      "src/components/settings/SettingsPanels.browser.tsx",
    ],
  },
];

for (const chunk of chunks) {
  console.log(`\nRunning browser tests: ${chunk.name}`);
  const result = spawnSync(
    "vp",
    ["test", "run", "--config", "vitest.browser.config.ts", ...chunk.files],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        // Let the nested `vp test` command own its command-mode environment.
        VP_COMMAND: undefined,
      },
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
