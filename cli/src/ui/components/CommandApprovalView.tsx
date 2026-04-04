import React from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  command: string;
  description: string;
  onApprove: () => void;
  onReject: () => void;
}

export const CommandApprovalView: React.FC<Props> = ({
  command,
  description,
  onApprove,
  onReject,
}) => {
  useInput((input) => {
    if (input === "y") onApprove();
    if (input === "n") onReject();
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="yellow">
        Run command?
      </Text>

      {description && (
        <Box marginTop={1}>
          <Text dimColor>{description}</Text>
        </Box>
      )}

      <Box
        marginTop={1}
        borderStyle="round"
        borderColor="yellow"
        paddingX={1}
      >
        <Text color="white">$ {command}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="green">[y]</Text>
        <Text> approve  </Text>
        <Text color="red">[n]</Text>
        <Text> reject</Text>
      </Box>
    </Box>
  );
};
