import { useNavigation } from "@react-navigation/native";
import { useCallback } from "react";
import { Alert } from "react-native";

import { removeThreadOutboxMessage } from "../../state/thread-outbox";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { setEditingQueuedMessageId } from "../../state/use-thread-outbox";

export function usePendingTaskListActions(): {
  readonly openPendingTask: (pendingTask: PendingNewTask) => void;
  readonly confirmDeletePendingTask: (pendingTask: PendingNewTask) => void;
} {
  const navigation = useNavigation();

  const openPendingTask = useCallback(
    (pendingTask: PendingNewTask) => {
      navigation.navigate("NewTaskSheet", {
        screen: "NewTaskDraft",
        params: {
          environmentId: String(pendingTask.message.environmentId),
          projectId: String(pendingTask.creation.projectId),
          pendingTaskId: String(pendingTask.message.messageId),
        },
      });
    },
    [navigation],
  );

  const confirmDeletePendingTask = useCallback((pendingTask: PendingNewTask) => {
    Alert.alert(
      "Delete pending task?",
      `“${pendingTask.title}” has not been sent yet and will be removed from the outbox.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setEditingQueuedMessageId(null);
            void removeThreadOutboxMessage(pendingTask.message).catch((error) => {
              Alert.alert(
                "Could not delete pending task",
                error instanceof Error ? error.message : "The pending task could not be removed.",
              );
            });
          },
        },
      ],
    );
  }, []);

  return { openPendingTask, confirmDeletePendingTask };
}
