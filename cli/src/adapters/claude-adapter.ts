/**
 * ClaudeAdapter - Wraps the Anthropic SDK for CLI use.
 *
 * Handles the full tool-use agentic loop internally:
 *   stream → tool calls → execute → send results → stream → … → end_turn
 *
 * The caller provides a `handleTool` callback so tool execution stays in
 * MainApp (where pending file changes are tracked), while the API loop stays
 * here.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Message, ToolUse } from "../types.ts";

export type ToolHandler = (toolUse: ToolUse) => Promise<string>;

export type ClaudeStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolUse: ToolUse }
  | { type: "done" };

export class ClaudeAdapter {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Run the full agentic turn, looping over tool calls until Claude reaches
   * end_turn. Yields text chunks and tool_use events as they happen.
   */
  async *streamCodeGeneration(
    messages: Message[],
    workingDir: string,
    model: string,
    tools: Anthropic.Tool[],
    handleTool: ToolHandler,
  ): AsyncGenerator<ClaudeStreamEvent> {
    const systemPrompt = buildSystemPrompt(workingDir);

    // Build the Anthropic API message history from our Message type.
    // This grows as tool results are appended during the loop.
    const apiMessages: Anthropic.MessageParam[] = messages.map(toApiMessage);

    while (true) {
      const stream = this.client.messages.stream({
        model,
        max_tokens: 8096,
        system: systemPrompt,
        tools,
        messages: apiMessages,
      });

      // Stream text deltas to the caller in real time
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text", text: event.delta.text };
        }
      }

      const response = await stream.finalMessage();

      // Emit tool_use events so the UI can display what Claude is doing
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (response.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
        yield { type: "done" };
        return;
      }

      // Append Claude's assistant turn (including tool_use blocks) to history
      apiMessages.push({ role: "assistant", content: response.content });

      // Execute each tool and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const toolUse: ToolUse = {
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
        yield { type: "tool_use", toolUse };
        const result = await handleTool(toolUse);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }

      // Append tool results as a user turn and loop
      apiMessages.push({ role: "user", content: toolResults });
    }
  }
}

function buildSystemPrompt(workingDir: string): string {
  return [
    "You are an expert software engineer helping the user with their codebase.",
    `The working directory is: ${workingDir}`,
    "",
    "When modifying files:",
    "- Use the write_file tool to queue changes for user review",
    "- Always read a file before modifying it",
    "- Make minimal, focused changes",
    "- Explain your reasoning briefly before making changes",
    "",
    "When running commands:",
    "- Always print the full raw output of the command in your response",
    "- Do not summarise or paraphrase command output — show it verbatim in a code block",
  ].join("\n");
}

function toApiMessage(msg: Message): Anthropic.MessageParam {
  return {
    role: msg.role === "user" ? "user" : "assistant",
    content: msg.content,
  };
}
