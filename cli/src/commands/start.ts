import React from "react";
import { render } from "ink";
import { MainApp } from "../ui/MainApp.tsx";
import { ClaudeAdapter } from "../adapters/claude-adapter.ts";
import { FileAdapter } from "../adapters/file-adapter.ts";
import { ConfigManager } from "../config/ConfigManager.ts";
import { SessionManager } from "../session/SessionManager.ts";
import type { CodeSession } from "../types.ts";

export async function startCodeSession(options: {
  directory: string;
  model?: string;
}): Promise<void> {
  const config = new ConfigManager();
  const apiKey = config.getApiKey() ?? process.env["ANTHROPIC_API_KEY"];

  if (!apiKey) {
    console.error("No API key found. Run: t3code config");
    process.exit(1);
  }

  const model = options.model ?? config.getModel();
  const fileAdapter = new FileAdapter(options.directory);
  const claudeAdapter = new ClaudeAdapter(apiKey);
  const sessionManager = new SessionManager(options.directory);
  const context = await fileAdapter.scan();

  const { waitUntilExit } = render(
    React.createElement(MainApp, {
      fileAdapter,
      claudeAdapter,
      sessionManager,
      context,
      model,
    }),
  );

  await waitUntilExit();
}

export async function startWithSession(
  session: CodeSession,
  modelOverride?: string,
): Promise<void> {
  const config = new ConfigManager();
  const apiKey = config.getApiKey() ?? process.env["ANTHROPIC_API_KEY"];

  if (!apiKey) {
    console.error("No API key found. Run: t3code config");
    process.exit(1);
  }

  const model = modelOverride ?? config.getModel();
  const fileAdapter = new FileAdapter(session.workingDirectory);
  const claudeAdapter = new ClaudeAdapter(apiKey);
  const sessionManager = new SessionManager(session.workingDirectory);
  const context = await fileAdapter.scan();

  const { waitUntilExit } = render(
    React.createElement(MainApp, {
      fileAdapter,
      claudeAdapter,
      sessionManager,
      context,
      model,
      initialSession: session,
    }),
  );

  await waitUntilExit();
}
