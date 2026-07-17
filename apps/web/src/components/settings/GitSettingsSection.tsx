import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { ProviderDriverKind } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import * as Equal from "effect/Equal";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");

export function GitSettingsSection() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const [commitInstructions, setCommitInstructions] = useState(settings.gitCommitInstructions);
  const [pullRequestInstructions, setPullRequestInstructions] = useState(
    settings.gitPullRequestInstructions,
  );
  useEffect(() => {
    setCommitInstructions(settings.gitCommitInstructions);
  }, [settings.gitCommitInstructions]);
  useEffect(() => {
    setPullRequestInstructions(settings.gitPullRequestInstructions);
  }, [settings.gitPullRequestInstructions]);
  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const gitModelInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const textGenInstanceEntry = gitModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const gitModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

  return (
    <SettingsSection title="Git preferences">
      <SettingsRow
        title="Text generation model"
        description="Used for generated commit messages, pull request content, and branch names."
        resetAction={
          isGitWritingModelDirty ? (
            <SettingResetButton
              label="text generation model"
              onClick={() =>
                updateSettings({
                  textGenerationModelSelection:
                    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                })
              }
            />
          ) : null
        }
        control={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              activeInstanceId={textGenInstanceId}
              model={textGenModel}
              lockedProvider={null}
              instanceEntries={gitModelInstanceEntries}
              modelOptionsByInstance={gitModelOptionsByInstance}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              onInstanceModelChange={(instanceId, model) => {
                updateSettings({
                  textGenerationModelSelection: resolveAppModelSelectionState(
                    {
                      ...settings,
                      textGenerationModelSelection: createModelSelection(instanceId, model),
                    },
                    serverProviders,
                  ),
                });
              }}
            />
            <TraitsPicker
              provider={textGenProvider}
              models={textGenInstanceEntry?.models ?? []}
              model={textGenModel}
              prompt=""
              onPromptChange={() => {}}
              modelOptions={textGenModelOptions}
              allowPromptInjectedEffort={false}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              onModelOptionsChange={(nextOptions) => {
                updateSettings({
                  textGenerationModelSelection: resolveAppModelSelectionState(
                    {
                      ...settings,
                      textGenerationModelSelection: createModelSelection(
                        textGenInstanceId,
                        textGenModel,
                        nextOptions,
                      ),
                    },
                    serverProviders,
                  ),
                });
              }}
            />
          </div>
        }
      />

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
