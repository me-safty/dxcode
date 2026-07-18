import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ProviderDriverKind } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import * as Equal from "effect/Equal";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance, resolveAppModelSelectionState } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { primaryServerProvidersAtom } from "~/state/server";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { TraitsPicker } from "~/components/chat/TraitsPicker";
import { Button } from "~/components/ui/button";
import { DraftInput } from "~/components/ui/draft-input";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "~/components/settings/settingsLayout";

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
type GenerationModelSetting = "textGenerationModelSelection" | "reviewStackModelSelection";

function GenerationModelSettingsRow(props: {
  setting: GenerationModelSetting;
  title: string;
  description: string;
}) {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const selection = resolveAppModelSelectionState(
    settings,
    serverProviders,
    settings[props.setting],
  );
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const entry = entries.find((candidate) => candidate.instanceId === selection.instanceId);
  const provider: ProviderDriverKind = entry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    selection.instanceId,
    selection.model,
  );
  const defaultSelection = DEFAULT_UNIFIED_SETTINGS[props.setting];
  const isDirty = !Equal.equals(settings[props.setting] ?? null, defaultSelection ?? null);
  const patch = (value: typeof selection) =>
    props.setting === "textGenerationModelSelection"
      ? { textGenerationModelSelection: value }
      : { reviewStackModelSelection: value };
  const saveSelection = (value: typeof selection) => {
    updateSettings({
      ...patch(resolveAppModelSelectionState(settings, serverProviders, value)),
    });
  };

  return (
    <SettingsRow
      title={props.title}
      description={props.description}
      resetAction={
        isDirty ? (
          <SettingResetButton
            label={props.title.toLowerCase()}
            onClick={() => updateSettings({ ...patch(defaultSelection) })}
          />
        ) : null
      }
      control={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <ProviderModelPicker
            activeInstanceId={selection.instanceId}
            model={selection.model}
            lockedProvider={null}
            instanceEntries={entries}
            modelOptionsByInstance={modelOptionsByInstance}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            onInstanceModelChange={(instanceId, model) =>
              saveSelection(createModelSelection(instanceId, model))
            }
          />
          <TraitsPicker
            provider={provider}
            models={entry?.models ?? []}
            model={selection.model}
            prompt=""
            onPromptChange={() => {}}
            modelOptions={selection.options}
            allowPromptInjectedEffort={false}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            onModelOptionsChange={(options) =>
              saveSelection(createModelSelection(selection.instanceId, selection.model, options))
            }
          />
        </div>
      }
    />
  );
}

export function GitSettingsSection() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const [commitInstructions, setCommitInstructions] = useState(settings.gitCommitInstructions);
  const [pullRequestInstructions, setPullRequestInstructions] = useState(
    settings.gitPullRequestInstructions,
  );
  const [reviewStackInstructions, setReviewStackInstructions] = useState(
    settings.reviewStackInstructions,
  );
  useEffect(() => {
    setCommitInstructions(settings.gitCommitInstructions);
  }, [settings.gitCommitInstructions]);
  useEffect(() => {
    setPullRequestInstructions(settings.gitPullRequestInstructions);
  }, [settings.gitPullRequestInstructions]);
  useEffect(() => {
    setReviewStackInstructions(settings.reviewStackInstructions);
  }, [settings.reviewStackInstructions]);

  return (
    <SettingsSection title="Git preferences">
      <GenerationModelSettingsRow
        setting="textGenerationModelSelection"
        title="Text generation model"
        description="Used for generated commit messages, pull request content, and branch names."
      />

      <GenerationModelSettingsRow
        setting="reviewStackModelSelection"
        title="Review stack model"
        description="Used only for generated review stack snapshots."
      />

      <SettingsRow
        title="Review stack instructions"
        description="Added to review stack generation prompts."
        className="pb-4"
      >
        <div className="space-y-2 pb-4">
          <Textarea
            value={reviewStackInstructions}
            onChange={(event) => setReviewStackInstructions(event.target.value)}
            placeholder="Example: Prioritize concurrency and failure recovery."
            aria-label="Review stack generation instructions"
            className="mt-3"
          />
          <div className="flex justify-end">
            <Button
              size="xs"
              disabled={reviewStackInstructions.trim() === settings.reviewStackInstructions}
              onClick={() => {
                const next = reviewStackInstructions.trim();
                setReviewStackInstructions(next);
                updateSettings({ reviewStackInstructions: next });
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </SettingsRow>

      <SettingsRow
        title="Commit instructions"
        description="Added to commit message generation prompts."
        className="pb-4"
      >
        <div className="space-y-2 pb-4">
          <Textarea
            value={commitInstructions}
            onChange={(event) => setCommitInstructions(event.target.value)}
            placeholder="Example: Use Conventional Commits."
            aria-label="Commit generation instructions"
            className="mt-3"
          />
          <div className="flex justify-end">
            <Button
              size="xs"
              disabled={commitInstructions.trim() === settings.gitCommitInstructions}
              onClick={() => {
                const next = commitInstructions.trim();
                setCommitInstructions(next);
                updateSettings({ gitCommitInstructions: next });
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </SettingsRow>

      <SettingsRow
        title="Pull request instructions"
        description="Added to pull request title and description generation prompts."
        className="pb-4"
      >
        <div className="space-y-2 pb-4">
          <Textarea
            value={pullRequestInstructions}
            onChange={(event) => setPullRequestInstructions(event.target.value)}
            placeholder="Example: Put only the PR title in the description."
            aria-label="Pull request generation instructions"
            className="mt-3"
          />
          <div className="flex justify-end">
            <Button
              size="xs"
              disabled={pullRequestInstructions.trim() === settings.gitPullRequestInstructions}
              onClick={() => {
                const next = pullRequestInstructions.trim();
                setPullRequestInstructions(next);
                updateSettings({ gitPullRequestInstructions: next });
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </SettingsRow>

      <SettingsRow
        title="Branch prefix"
        description="Optional prefix for generated branches, for example codex/branch-name. Leave empty for branch-name."
        resetAction={
          settings.gitBranchPrefix !== DEFAULT_UNIFIED_SETTINGS.gitBranchPrefix ? (
            <SettingResetButton
              label="branch prefix"
              onClick={() =>
                updateSettings({ gitBranchPrefix: DEFAULT_UNIFIED_SETTINGS.gitBranchPrefix })
              }
            />
          ) : null
        }
        control={
          <DraftInput
            value={settings.gitBranchPrefix}
            onCommit={(value) => {
              const next = value.trim().replaceAll("/", "");
              updateSettings({ gitBranchPrefix: next });
            }}
            className="w-full sm:w-48"
            placeholder="No prefix"
            aria-label="Generated branch prefix"
          />
        }
      />

      <SettingsRow
        title="Skip Git hooks"
        description="Always add --no-verify to commits and pushes created from Git actions."
        resetAction={
          settings.gitNoVerify !== DEFAULT_UNIFIED_SETTINGS.gitNoVerify ? (
            <SettingResetButton
              label="skip Git hooks"
              onClick={() => updateSettings({ gitNoVerify: DEFAULT_UNIFIED_SETTINGS.gitNoVerify })}
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.gitNoVerify}
            onCheckedChange={(checked) => updateSettings({ gitNoVerify: Boolean(checked) })}
            aria-label="Always skip Git hooks for commits and pushes"
          />
        }
      />
    </SettingsSection>
  );
}
