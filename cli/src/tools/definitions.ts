import type Anthropic from "@anthropic-ai/sdk";

export const CLI_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file from the workspace.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file, relative to the working directory.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write content to a file. The change is queued for user review before being applied.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file, relative to the working directory.",
        },
        content: {
          type: "string",
          description: "Full content to write to the file.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List the files and directories at the given path.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Directory path to list. Defaults to the working directory.",
        },
      },
      required: [],
    },
  },
  {
    name: "delete_file",
    description:
      "Delete a file. The deletion is queued for user review before being applied.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to delete, relative to the working directory.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "move_file",
    description:
      "Move or rename a file. Queued for user review before being applied.",
    input_schema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "Current file path, relative to the working directory.",
        },
        destination: {
          type: "string",
          description: "New file path, relative to the working directory.",
        },
      },
      required: ["source", "destination"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command in the working directory. Requires explicit user approval before execution. Use for build commands, tests, git operations, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute.",
        },
        description: {
          type: "string",
          description: "Brief explanation of what this command does and why.",
        },
      },
      required: ["command"],
    },
  },
];
