import type { Meta, StoryObj } from "@storybook/react";
import { ThreadChatView } from "~/t3work/chat/t3work-ThreadChatView";

const meta = {
  title: "Chat/ThreadChatView",
  component: ThreadChatView,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ThreadChatView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    threadId: "thread-1",
    projectId: "proj-einb",
    title: "Signature pad iOS fix",
    onBack: () => console.log("back"),
  },
};
