import type { Meta, StoryObj } from "@storybook/react";
import { App } from "~/t3work/t3work-App";

const meta = {
  title: "Archived/App",
  component: App,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
