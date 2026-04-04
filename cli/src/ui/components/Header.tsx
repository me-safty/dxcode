import React from "react";
import { Box, Text } from "ink";

const T3_ASCII = `
████████╗██████╗
╚══██╔══╝╚════██╗
   ██║    █████╔╝
   ██║    ╚═══██╗
   ██║   ██████╔╝
   ╚═╝   ╚═════╝`.trimStart();

interface Props {
  workingDir: string;
  fileCount: number;
}

export const Header: React.FC<Props> = ({ workingDir, fileCount }) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">
        {T3_ASCII}
      </Text>
      <Box marginTop={1} flexDirection="row" gap={2}>
        <Box>
          <Text dimColor>dir </Text>
          <Text color="white">{workingDir}</Text>
        </Box>
        <Box>
          <Text dimColor>files </Text>
          <Text color="white">{fileCount}</Text>
        </Box>
      </Box>
      <Text dimColor>{"─".repeat(40)}</Text>
    </Box>
  );
};
