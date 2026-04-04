import React, { useEffect } from "react";
import { Box, Text } from "ink";

interface Props {
  onReady: () => void;
}

export const WelcomeScreen: React.FC<Props> = ({ onReady }) => {
  useEffect(() => {
    const timer = setTimeout(onReady, 800);
    return () => clearTimeout(timer);
  }, [onReady]);

  return (
    <Box>
      <Text dimColor>Indexing workspace...</Text>
    </Box>
  );
};
