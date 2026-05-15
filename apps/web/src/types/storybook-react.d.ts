declare module "@storybook/react" {
  export type Meta<T = unknown> = {
    title?: string;
    component?: T;
    args?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    decorators?: ReadonlyArray<unknown>;
  };

  export type StoryObj<T = unknown> = {
    args?: Record<string, unknown>;
    render?: (args: Record<string, unknown>) => unknown;
  };
}
