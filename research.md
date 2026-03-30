# Research: How T3 Code Chat and Zed ACP/Droid Fit Together

## Executive Summary

There are two distinct but composable layers here:

1. **T3 Code's internal chat orchestration layer**: a web app and server that own thread state, provider/model selection, tool/event normalization, and provider lifecycle management.
2. **Zed ACP + Droid external agent interface layer**: a host/editor chat surface that launches an agent process over ACP, while separately wiring MCP context servers as callable tools.

The key architectural insight is that these layers solve different problems.

- **T3 Code** is an opinionated agent runtime host. It owns provider routing, sessions, approvals, thread projections, and the UI for observing long-running coding work.
- **Zed ACP** is an editor-to-agent transport contract. It lets Zed host a chat UI and delegate agent execution to a process like `droid exec --output-format acp`.
- **Droid** sits naturally at the boundary: it can speak ACP upward to Zed while using MCP/tooling/provider infrastructure downward.

In short: **ACP is the outer editor/agent protocol; T3 Code-style orchestration is the inner runtime/provider protocol.**

## Part 1: How chat works in this repo

### High-level architecture

The chat path in T3 Code is:

1. User selects provider/model in the web UI.
2. UI dispatches orchestration commands over WebSocket.
3. Server decider turns commands into orchestration events.
4. Provider command reactor ensures a provider session exists and sends the turn.
5. Provider service routes to a concrete provider adapter.
6. Adapter talks to Codex or Claude.
7. Provider runtime events are normalized into a shared canonical event surface.
8. Orchestration projections update thread/session state.
9. Web UI subscribes to pushed domain events and rerenders.

### UI layer: provider and model selection

The main picker is in `apps/web/src/components/chat/ProviderModelPicker.tsx`.

What it does:

- lets the user choose a **provider first** and then a **model** under that provider,
- disables providers dynamically based on live server provider snapshots,
- supports a locked-provider mode once a thread is already bound to a provider.

Relevant behavior:

- available providers are driven from `PROVIDER_OPTIONS`,
- the picker uses `getProviderSnapshot()` to detect readiness/installation/enablement,
- once a provider is locked, only model changes inside that provider are allowed from the picker.

Supporting model/provider resolution lives in:

- `apps/web/src/modelSelection.ts`
- `apps/web/src/providerModels.ts`

These files provide the fallback logic:

- normalize model slugs,
- merge built-in and custom models,
- resolve a default server model,
- fall back to another enabled provider if the selected one is unavailable.

### ChatView is the composition root

`apps/web/src/components/ChatView.tsx` is the main UI runtime composition point.

It is responsible for:

- deriving the active thread state,
- deciding selected provider/model/runtime mode,
- formatting outgoing prompts,
- dispatching orchestration commands,
- rendering the timeline, approvals, plan UI, and provider-specific controls.

This is where the UI bridges from "chat composer state" to the orchestration backend.

### WebSocket tooling surface exposed by the app

The app-facing RPC surface is defined by:

- `apps/web/src/wsNativeApi.ts`
- `packages/contracts/src/ws.ts`

This includes method families for:

- `orchestration.*`
- `git.*`
- `terminal.*`
- `projects.*`
- `shell.*`
- `server.*`

This is important because T3 Code's "chat" is not only an LLM stream. It is a workspace control surface with built-in transports for:

- terminal sessions,
- git workflows,
- file/project operations,
- settings/provider refresh,
- orchestration snapshots and replay.

That is one of the strongest signals that the product is an **agent workbench**, not just a text chatbot.

### Orchestration layer

The turn-start path begins with `thread.turn.start`.

Relevant files:

- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

The decider takes a user command and emits domain events such as:

- `thread.message-sent`
- `thread.turn-start-requested`

Then `ProviderCommandReactor` reacts to provider-intent events like:

- `thread.turn-start-requested`
- `thread.turn-interrupt-requested`
- approval/user-input response events
- session stop events

Its job is to:

- validate provider binding,
- ensure a provider session exists,
- decide whether a restart is needed,
- send the turn to the provider service,
- reflect provider session state back into orchestration state.

This is the key boundary between **thread state** and **provider runtime state**.

### Provider service and adapter routing

The cross-provider routing layer is:

- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`

`ProviderService` does three key things:

1. validates transport inputs,
2. routes calls to the right adapter,
3. merges all provider runtime events into a unified event stream.

`ProviderAdapterRegistry` currently binds:

- `codex` -> `CodexAdapter`
- `claudeAgent` -> `ClaudeAdapter`

This is where provider polymorphism is formalized.

### Canonical runtime event surface

The normalized runtime schema is in `packages/contracts/src/providerRuntime.ts`.

This file is central because it defines the provider-independent vocabulary:

- session/thread/turn lifecycle events,
- item lifecycle events,
- content streaming events,
- request and user-input events,
- task/tool/hook progress events,
- warnings/errors,
- model rerouting.

Notable tool-lifecycle item types include:

- `command_execution`
- `file_change`
- `mcp_tool_call`
- `dynamic_tool_call`
- `collab_agent_tool_call`
- `web_search`
- `image_view`

This means the system already treats provider-specific activity as a common agent event log. That is exactly the kind of layer that can sit beneath multiple chat surfaces.

## Part 2: How Codex and Claude integrate

### Codex integration

Primary files:

- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/codexAppServerManager.ts`

Codex is integrated through a **managed app-server process**.

Characteristics:

- process/protocol-oriented,
- session manager heavy,
- events come from app-server notifications/requests and Codex event messages,
- adapter maps raw Codex activity into canonical runtime events.

Implication:

Codex is treated as an external runtime that T3 Code manages and normalizes.

### Claude integration

Primary files:

- `apps/server/src/provider/Layers/ClaudeAdapter.ts`

Claude is integrated via `@anthropic-ai/claude-agent-sdk` using `query(...)`.

Characteristics:

- SDK/stream-oriented rather than external managed app-server,
- adapter owns prompt queue, streamed SDK messages, approvals, user-input handling, and turn-state reconstruction,
- model behavior includes Claude-specific concepts like `thinking`, `effort`, and `contextWindow`.

Implication:

Claude is integrated more like an embedded runtime client than a standalone app-server.

### Important architectural difference

Both providers end up behind the same `ProviderService` and emit the same canonical event types, but they differ internally:

- **Codex**: external runtime process managed by the server.
- **Claude**: SDK query stream managed directly in-process.

This tells us the system is intentionally designed around an **adapter-normalization pattern**, not around one provider's native protocol.

## Part 3: What Factory's Zed integration says

Source: `https://docs.factory.ai/integrations/zed`

### Zed integration model

Factory's Zed integration configures Droid as a custom Zed agent via `~/.config/zed/settings.json` under `agent_servers`.

The documented shape is:

```json
"agent_servers": {
  "Factory Droid": {
    "type": "custom",
    "command": "*path/to/droid/cli*",
    "args": ["exec", "--output-format", "acp"]
  }
}
```

Optional API-key-based env wiring is done with:

```json
"env": {
  "FACTORY_API_KEY": "$FACTORY_API_KEY"
}
```

Meaning:

- Zed is the chat host.
- Droid is launched as an external process.
- The wire protocol between them is ACP.

### Context/tool integration in Zed

The same doc says Zed uses `context_servers` for MCP servers.

Example from the docs:

```json
"context_servers": {
  "chrome-devtools": {
    "command": "npx",
    "args": ["-y", "chrome-devtools@latest"]
  }
}
```

The important statement in the doc is that **when you chat with Factory Droid in Zed, it can call any of these MCP servers as tools**.

This yields a clean split:

- `agent_servers`: who the agent is,
- `context_servers`: what tools/context that agent can access.

### Constraints documented by Factory

The integration doc also notes:

- Zed chats are effectively fresh sessions; it does not currently restore past Factory Droid sessions from the Agent Panel.
- Model selection and autonomy follow the same rules as the Droid CLI.
- Zed supports `@`-tagging files and `Shift+Tab` autonomy switching.
- Troubleshooting starts with verifying `droid exec --output-format acp` works outside Zed.

This is a strong hint that the Zed integration is intentionally thin: Zed hosts the panel, while Droid remains the actual agent brain.

## Part 4: What ACP is doing conceptually

Sources:

- `https://zed.dev/acp`
- `https://agentclientprotocol.com/overview/introduction` (linked from Zed ACP page)

The Zed ACP page frames ACP as:

- a way to **bring your own agent to Zed**,
- a protocol that lets any ACP-speaking agent plug into Zed's IDE-native interface.

Even without the full protocol text inline, the page is explicit about the division of labor:

- Zed provides the editor-native chat/interface surface.
- ACP standardizes how an agent process connects to that surface.

So ACP should be understood as the **host/agent session protocol**, not as the provider-runtime abstraction.

That matters because ACP is operating one layer above the Codex/Claude adapters seen in T3 Code.

## Part 5: The two-layer model

### Layer A: chat host / client protocol layer

This is where Zed ACP lives.

Responsibilities:

- launch/select agent process,
- establish a chat session with that process,
- provide editor-native UX,
- pass workspace context and user input,
- display agent responses and action state.

Examples:

- Zed Agent Panel
- ACP transport
- `agent_servers` config

### Layer B: agent runtime / provider orchestration layer

This is where T3 Code's internal architecture lives.

Responsibilities:

- choose provider and model,
- manage provider sessions,
- normalize runtime events,
- route approvals and user input,
- expose tools like terminal/git/project actions,
- reconcile thread state with provider state.

Examples:

- `ProviderCommandReactor`
- `ProviderService`
- `CodexAdapter`
- `ClaudeAdapter`
- canonical runtime event schemas

### Why this split is correct

Because these layers answer different questions:

- **ACP layer**: how does an editor talk to an agent?
- **orchestration layer**: how does an agent talk to models, tools, approvals, sessions, and runtime adapters?

ACP does not replace provider orchestration.
Provider orchestration does not replace ACP.
They compose.

## Part 6: Proposed integration model for T3 Code + Droid + ACP

### Recommended framing

Treat T3 Code's architecture as the **inner engine**, and ACP as the **outer shell contract**.

That suggests the following stack:

```text
Zed Agent Panel
  -> ACP
    -> Droid process
      -> orchestration/runtime layer
        -> provider adapters (Codex, Claude, ...)
        -> tool backends / MCP / terminal / git / files
```

### Option 1: Droid as ACP facade over an orchestration core

In this model:

- Droid speaks ACP to Zed.
- Internally, Droid either embeds or calls an orchestration engine similar to T3 Code's server/provider layers.
- Codex and Claude remain provider adapters behind the orchestration boundary.
- MCP tools are surfaced into the runtime as canonical tool events.

Benefits:

- clean separation of editor protocol from provider integration,
- same core agent engine can power CLI, app, and editor integrations,
- provider-specific complexity stays out of ACP handlers,
- easiest way to preserve consistent autonomy/model/tool behavior across surfaces.

This is the most scalable architecture.

### Option 2: ACP client directly owns provider logic

In this model:

- the ACP-facing process itself directly implements Codex/Claude logic and tool handling without a strong orchestration core.

Benefits:

- fewer layers at small scale.

Costs:

- harder to share behavior across CLI/app/editor,
- provider-specific branching leaks into chat host integration,
- weaker event normalization and observability,
- harder to preserve consistent approval/session semantics.

This is less attractive given the repo's current structure.

## Part 7: Concrete design implications

### 1. Provider/model selection belongs below ACP

Provider selection and model selection should remain a responsibility of the agent runtime/orchestration layer, not the ACP transport itself.

Reason:

- those choices depend on provider availability, provider capabilities, runtime mode, and session restart semantics,
- T3 Code already has logic for fallback and model capability resolution.

ACP can expose controls for these settings, but the canonical truth should live in the runtime core.

### 2. Tooling should be normalized independently of chat host

T3 Code's `providerRuntime.ts` is the right kind of abstraction.

Whether the top-level UX is:

- T3 Code web chat,
- Droid CLI,
- Zed Agent Panel,

…the runtime should emit the same conceptual events:

- turn started/completed,
- tool started/completed,
- approval requested/resolved,
- content delta,
- warnings/errors.

That is how you keep one agent behavior across many shells.

### 3. MCP should plug into the runtime tool surface, not bypass it

Zed's `context_servers` make MCP servers available in the editor integration, but the agent runtime should still normalize those calls as first-class tool events.

T3 Code already has `mcp_tool_call` in its canonical item taxonomy.

That suggests the right conceptual mapping is:

- Zed discovers and launches MCP servers,
- Droid/runtime invokes them,
- runtime emits canonical `mcp_tool_call` activity,
- chat host renders it.

### 4. Session durability differs by outer shell

Factory's Zed doc explicitly says Zed currently does not restore previous Droid sessions in the Agent Panel.

So the runtime must tolerate multiple outer-shell session models:

- long-lived/recoverable sessions in T3 Code web app,
- ephemeral editor sessions in Zed,
- terminal-native sessions in CLI.

This means session persistence should be a runtime capability, while shell integrations may expose only a subset.

## Part 8: Best proposal

### Proposed architecture statement

Use a **three-part composition**:

1. **Shell/UI layer**: T3 Code web app, Droid CLI UX, Zed Agent Panel.
2. **Session protocol layer**: WebSocket app API for T3 Code, ACP for Zed, CLI stdin/stdout contract for terminal UX.
3. **Core runtime layer**: orchestration engine, provider adapters, tool adapters, canonical event model.

### Proposed principle

> ACP should be treated as a transport and host-integration contract, while provider/model/tool orchestration should remain in a runtime core that is independent of any single chat surface.

### Why this matches the current repo

Because the repo already shows the right internal decomposition:

- provider-independent command/event schemas,
- provider adapter registry,
- normalized runtime event vocabulary,
- UI separated from orchestration,
- provider-specific logic isolated in adapters.

That is exactly the kind of architecture that can be repackaged behind Droid for ACP-facing integrations.

## Part 9: Suggested future direction

If the goal is to make the layers work together cleanly, the strongest direction is:

- keep T3 Code's orchestration model as the canonical runtime core,
- make Droid an outer interface that can host that core in CLI/editor settings,
- speak ACP outward to Zed,
- preserve a canonical internal event/tool/session model inward.

Put differently:

- **ACP is how Zed talks to Droid.**
- **The orchestration core is how Droid talks to Codex, Claude, MCP tools, terminal/git/file systems, and session state.**

That separation is what keeps the system portable, observable, and provider-agnostic.

## Evidence / file references

Repo files:

- `apps/web/src/components/chat/ProviderModelPicker.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/modelSelection.ts`
- `apps/web/src/providerModels.ts`
- `apps/web/src/wsNativeApi.ts`
- `packages/contracts/src/ws.ts`
- `packages/contracts/src/providerRuntime.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `apps/server/src/codexAppServerManager.ts`

External docs:

- `https://docs.factory.ai/integrations/zed`
- `https://zed.dev/acp`
- `https://agentclientprotocol.com/overview/introduction`
