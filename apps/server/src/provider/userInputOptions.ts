import type { UserInputQuestionOption } from "@t3tools/contracts";

export const CUSTOM_USER_INPUT_OPTION: UserInputQuestionOption = {
  label: "Other",
  description: "Type your own answer",
};

export function withCustomUserInputOption(
  options: ReadonlyArray<UserInputQuestionOption>,
): ReadonlyArray<UserInputQuestionOption> {
  const presetOptions = options.filter((option) => option.label.trim().toLowerCase() !== "other");
  const customOption =
    options.find((option) => option.label.trim().toLowerCase() === "other") ??
    CUSTOM_USER_INPUT_OPTION;

  return [...presetOptions, customOption];
}
