import "../index.css";

import { useState } from "react";
import { page } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { pluginUiComponents } from "../plugins/pluginUiComponents";

const PluginSelect = pluginUiComponents.Select;

const PROJECT_OPTIONS = [
  { value: "first", label: "First project" },
  { value: "second", label: "Second project" },
] as const;

function PluginSelectHarness({ onChange }: { readonly onChange: (value: string) => void }) {
  const [value, setValue] = useState("first");

  return (
    <PluginSelect
      options={PROJECT_OPTIONS}
      placeholder="Project"
      value={value}
      onValueChange={(nextValue) => {
        setValue(nextValue);
        onChange(nextValue);
      }}
    />
  );
}

describe("pluginUiComponents", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens plugin select dropdowns", async () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<PluginSelectHarness onChange={onChange} />, { container: host });

    const trigger = document.querySelector<HTMLElement>("[data-slot='select-trigger']");
    expect(trigger).not.toBeNull();
    trigger?.click();

    await expect.element(page.getByText("Second project", { exact: true })).toBeVisible();
    await page.getByText("Second project", { exact: true }).click();
    expect(onChange).toHaveBeenCalledWith("second");

    await screen.unmount();
  });
});
