import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { MarkdownText } from "./MarkdownText.tsx";

interface Props {
  step: string;
  streamedText?: string;
}

export const ExecutionView: React.FC<Props> = ({ step, streamedText }) => {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> {step}</Text>
      </Box>

      {streamedText && (
        <Box marginTop={1} flexDirection="column">
          <MarkdownText>{streamedText}</MarkdownText>
        </Box>
      )}
    </Box>
  );
};
