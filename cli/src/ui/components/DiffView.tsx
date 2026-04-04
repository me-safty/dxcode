import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { diffLines } from "diff";
import type { FileChange } from "../../types.ts";

interface Props {
  changes: FileChange[];
  onApprove: (approved: FileChange[]) => void;
  onReject: () => void;
}

export const DiffView: React.FC<Props> = ({ changes, onApprove, onReject }) => {
  const [index, setIndex] = useState(0);
  const [approved, setApproved] = useState<Set<number>>(new Set());

  const finalize = (finalApproved: Set<number>) => {
    const toApply = changes.filter((_, i) => finalApproved.has(i));
    if (toApply.length > 0) {
      onApprove(toApply);
    } else {
      onReject();
    }
  };

  useInput((input, key) => {
    if (input === "y") {
      const next = new Set([...approved, index]);
      setApproved(next);
      if (index < changes.length - 1) {
        setIndex(index + 1);
      } else {
        finalize(next);
      }
    } else if (input === "n") {
      if (index < changes.length - 1) {
        setIndex(index + 1);
      } else {
        finalize(approved);
      }
    } else if (input === "a") {
      const all = new Set(changes.map((_, i) => i));
      finalize(all);
    } else if (input === "r") {
      finalize(new Set());
    } else if ((key.downArrow || input === "j") && index < changes.length - 1) {
      setIndex(index + 1);
    } else if ((key.upArrow || input === "k") && index > 0) {
      setIndex(index - 1);
    }
  });

  const current = changes[index]!;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          Review Changes ({index + 1}/{changes.length})
        </Text>
      </Box>

      <FileDiff change={current} />

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color="green">[y]</Text>
          <Text> approve  </Text>
          <Text color="red">[n]</Text>
          <Text> skip  </Text>
          <Text color="green">[a]</Text>
          <Text> approve all  </Text>
          <Text color="red">[r]</Text>
          <Text> reject all  </Text>
          <Text dimColor>[j/k] navigate</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        {changes.map((_, i) => (
          <Text
            key={i}
            color={
              approved.has(i) ? "green" : i === index ? "cyan" : "gray"
            }
          >
            {approved.has(i) ? "✓ " : i === index ? "● " : "○ "}
          </Text>
        ))}
      </Box>
    </Box>
  );
};

const FileDiff: React.FC<{ change: FileChange }> = ({ change }) => {
  if (change.type === "delete") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red">
        <Box paddingX={1}>
          <Text bold color="red">
            ✕ DELETE  {change.path}
          </Text>
        </Box>
        {change.originalContent && (
          <Box flexDirection="column" paddingX={1} paddingY={1}>
            {change.originalContent
              .split("\n")
              .slice(0, 20)
              .map((line, i) => (
                <Text key={i} color="red">
                  - {line}
                </Text>
              ))}
          </Box>
        )}
      </Box>
    );
  }

  if (change.type === "move") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow">
        <Box paddingX={1}>
          <Text bold color="yellow">
            → MOVE  {change.path}  →  {change.destPath}
          </Text>
        </Box>
      </Box>
    );
  }

  const diff = diffLines(change.originalContent ?? "", change.newContent ?? "");

  // Cap displayed lines to avoid flooding the terminal
  const MAX_LINES = 40;
  let shown = 0;
  let truncated = false;
  const visibleParts: typeof diff = [];
  for (const part of diff) {
    const lines = part.value.split("\n").filter((l) => l !== "");
    if (shown + lines.length > MAX_LINES) {
      truncated = true;
      break;
    }
    shown += lines.length;
    visibleParts.push(part);
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Box paddingX={1}>
        <Text bold color="cyan">
          {change.type === "create" ? "+ " : "~ "}
          {change.path}
        </Text>
      </Box>


      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {visibleParts.map((part, i) => {
          const color = part.added ? "green" : part.removed ? "red" : "white";
          const prefix = part.added ? "+ " : part.removed ? "- " : "  ";
          const lines = part.value.split("\n").filter((l) => l !== "");
          return lines.map((line, j) => (
            <Text key={`${i}-${j}`} color={color}>
              {prefix}
              {line}
            </Text>
          ));
        })}
        {truncated && (
          <Text dimColor>... (truncated, file has more changes)</Text>
        )}
      </Box>
    </Box>
  );
};
