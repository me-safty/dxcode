# DONE

Temporary notes for the UI nitpick and issue PR.

## Issues

### Open picker shortcut styling

- Issue spotted: The preferred editor shortcut in the Open picker dropdown rendered as muted text (`Ctrl+O`) instead of using the shared keybinding pill style used by Search (`Ctrl+K`).
- Applied fix: Updated `apps/web/src/components/chat/OpenInPicker.tsx` to render the shortcut with the shared `Kbd` component while preserving right-aligned menu layout spacing.

### Runtime Google Fonts dependency

- Issue spotted: The web app loaded DM Sans from Google Fonts at runtime, which adds an external network dependency and is less reliable for packaged desktop/offline usage.
- Applied fix: Added Fontsource packages for DM Sans and JetBrains Mono, imported the bundled font CSS from `apps/web/src/main.tsx`, removed the Google Fonts links from `apps/web/index.html`, updated the app and Tailwind sans stacks to use Fontsource's `DM Sans Variable` family before system fallbacks, added JetBrains Mono to the mono fallback stacks after SF Mono, and updated the Tailwind `--font-mono` token so `font-mono` UI uses the bundled fallback before Consolas.

### Dropdown chevron placement

- Issue spotted: Compact dropdown triggers placed chevrons slightly too far left from the rounded right edge, including the composer model picker and reasoning select controls.
- Applied fix: Added a small negative end margin to chevrons in the shared `SelectTrigger`/`SelectButton` paths and matching compact composer picker triggers so the icon aligns visually with the trigger's right padding. Removed broad `[&_svg]:mx-0` resets from custom picker buttons because they overrode the chevron's own end margin and caused the bad placement to persist.

### Text generation model row clarity

- Issue spotted: The text generation model setting duplicated provider/sub-provider text in the model trigger and exposed an `agent` selector (`Build`) that is meaningful for interactive agent sessions but confusing for generated commit messages and PR text.
- Applied fix: Changed model trigger labels to show the model name only while preserving provider identity through the icon and picker details, stripped duplicated sub-provider prefixes from model names, and hid the `agent` option from the text generation traits control so the row focuses on model and reasoning choices.

### Text generation model description layout shift

- Issue spotted: The text generation model description could resolve to either one or two lines depending on how much width the adjacent dropdowns consumed, causing the row height to shift when the controls changed size.
- Applied fix: Added an opt-in two-line description minimum to the shared settings row layout using the resolved line-height unit, then enabled it for the text generation model row so the helper text always reserves a stable two-line block.

### Model picker rail selected-item shape

- Issue spotted: The model picker provider rail selected state rounded its right corners inside the narrow left pane, exposing the darker rail background beside the content divider and making the selected favorites button look clipped.
- Applied fix: Squared the selected rail button's right edge, extended its selected background to the divider, and reduced the rail's top inset so the favorites star aligns vertically with the search header.

### Model picker visual noise and OpenCode source split

- Issue spotted: The model picker mixed rail separators, per-row divider lines, left-aligned favorite stars, and duplicated OpenCode sub-provider labels, making the popup noisy and making OpenCode Go/Zen model sources hard to scan.
- Applied fix: Reworked the shared model picker popup in the same footprint: removed the rail favorites separator, aligned the favorites rail item with the search header, removed model-row dividers, moved favorite stars to the right edge of each row, added a neutral `Selected` badge and stronger selected-row highlight, normalized OpenCode row provider labels to `OpenCode Go` or `OpenCode Zen`, and added Go/Zen tabs beside the search input to filter OpenCode models.

### Model picker scroll lock and selected-row state

- Issue spotted: The settings page could still scroll while the model picker was open, the sidebar still inherited rounded clipping from the shared scroll area, and the currently selected model used both a badge and a row background highlight.
- Applied fix: Locked document scrolling while the shared model picker is open, replaced the sidebar scroll area with a plain overflow-hidden rail inside the already rounded picker container, and removed the selected-row background/ring so selected state is represented by the neutral badge only.

### Model picker background wheel scroll

- Issue spotted: The settings panel could still wheel-scroll behind the model picker because it is an internal scroll container, so locking the document body was not enough.
- Applied fix: Added a model-picker-open wheel/touch guard that permits scrolling inside the picker content but prevents background scroll outside it, and nudged the model-row favorite button slightly farther right for better edge alignment.

### Provider status dot tooltip

- Issue spotted: Provider status dots communicated state through color only, with no hover text explaining whether a provider was ready, unavailable, disabled, or needed attention.
- Applied fix: Added short status tooltips to the provider icon/status-dot area in provider settings, using compact labels such as `Authenticated`, `Unauthenticated`, `Missing Binary`, `Needs Attention`, `Unavailable`, `Disabled`, or `Checking`.

### Provider authenticated description noise

- Issue spotted: Authenticated provider rows used clipped fragments separated by punctuation, repeated subscription text awkwardly, and kept the status tooltip hover target very small.
- Applied fix: Increased the provider status/icon hover target and changed authenticated provider descriptions to read as natural language, e.g. `Authenticated as {email} using your Claude Pro subscription`, with `subscription` lowercased.

### Provider environment variables nesting

- Issue spotted: Provider environment variables rendered as nested rounded row cards with native checkboxes and repeated `Sensitive` row labels, making the dropdown feel visually heavy and inconsistent with the shared UI kit.
- Applied fix: Reworked the environment variables editor into a single shadcn-style table container with alternating row backgrounds, shared `Checkbox` controls under a `Sensitive` header, and no repeated sensitivity label or per-row card shell. Provider status tooltips now open with a 100ms delay.

### Model picker accent color repetition

- Issue spotted: Accent-colored provider instances showed both a sidebar badge and a repeated accent dot on every model row, so the model list carried the same color signal over and over.
- Applied fix: Kept accent color as a compact color-only badge in the model picker rail and removed the per-row accent dot from model provider captions.

### Model picker selected rail strip

- Issue spotted: The selected provider rail item extended a different background color behind the blue selection hint, making the right edge look like a mismatched extra sliver.
- Applied fix: Changed the selected rail extension to use the same muted background as the left pane so only the selection hint stands out, while keeping the selected provider button's right corners rounded correctly.

### Model picker OpenCode tab layout shift

- Issue spotted: Switching to or from OpenCode mounted/unmounted the Go/Zen tab switch beside search, slightly changing the header layout and causing a small picker shift.
- Applied fix: Gave the search header row a stable minimum height while letting the search input fill the available width when the OpenCode tabs are not present.

### Provider warning description verbosity

- Issue spotted: Provider rows with warning/error details printed the full diagnostic inline, making the provider list noisy and forcing long wrapped descriptions.
- Applied fix: Kept the row body to the short status headline, e.g. `Needs attention`, and moved the detailed diagnostic into a circle-question tooltip beside the headline.

### Provider status dot outline color

- Issue spotted: Provider status dots used the global page background for their clipping ring, which looked like a harsh outline inside the provider card.
- Applied fix: Matched the status-dot ring to the card surface color so the indicator clips cleanly without a visible mismatched halo.

### OpenCode connected provider copy

- Issue spotted: OpenCode provider status used backend-oriented wording like `upstream providers connected through OpenCode`, which was technically accurate but unclear in the settings UI.
- Applied fix: Changed the OpenCode success message to natural user-facing copy and made the visible settings row use it instead of the generic `Authenticated · opencode` headline.

### Provider status punctuation

- Issue spotted: Provider status rows mixed punctuated and unpunctuated messages, making the provider list inconsistent with surrounding settings copy.
- Applied fix: Normalized provider summary headlines/details to end with terminal punctuation and added punctuation to the authenticated provider sentence.

### Provider accent color selector

- Issue spotted: Provider accent color controls used a bespoke swatch picker plus a native color input that did not match the app's shadcn-style controls.
- Applied fix: Added Spell UI's `ColorSelector`, replaced provider accent swatches with the imported component, and added a matching custom-color swatch that opens a zero-padding popover containing only the native color picker.
- Follow-up fix: Replaced the native color input with a shadcn-style custom picker panel that opens directly from the custom swatch, keeps the popover flush, and omits opacity and extra fields.
- Follow-up fix: Moved the custom color swatch back to the first position, made it use the selected accent fill and selected ring styling, and replaced the shifting text clear action with a reserved X icon button.
- Follow-up fix: Reduced the custom swatch eyedropper to a quieter translucent icon and removed accent initials from provider status badges so the color marker stays visual-only.
- Follow-up fix: Softened the custom swatch eyedropper icon to `text-foreground/25` so it stays visible without overpowering the selected color.
- Follow-up fix: Removed initials from accent badges in the composer model dropdown trigger as well, preserving initials only for duplicate-provider disambiguation without a custom accent.
- Follow-up fix: Normalized accent swatch selected rings to use the card surface as the offset color and removed the extra neutral ring class so custom and preset swatches share the same ring treatment.
- Follow-up fix: Replaced CSS-state-based indicator clipping with explicit component values: composer triggers use the input surface, provider settings use the card surface, and model picker rail items use JS hover/selected state to choose the normal, hovered, or selected surface.
- Follow-up fix: Gave hovered/focused provider rail state priority over selected state so selected items that darken on hover clip indicators against the highlighted surface.

### Environment variable table alignment

- Issue spotted: The Sensitive checkbox was centered in its table column, making it feel detached from the column header.
- Applied fix: Left-aligned the Sensitive header and checkbox cell so the control starts at the same column edge.

### Provider status text alignment

- Issue spotted: Provider status copy started at the card edge while the provider title started after the status/icon cluster, making the paragraph look misaligned.
- Applied fix: Added matching left padding to provider status copy so it aligns with the provider title text.
- Follow-up fix: Flattened authenticated provider status copy into normal paragraph text with inline spans and baseline-aligned email reveal control so wrapped lines align naturally.
- Follow-up fix: Middle-aligned the status help icon within the status text line so Disabled, Needs attention, and similar states do not look vertically offset.
- Follow-up fix: Wrapped non-auth provider status text and its help icon in a single inline-flex span so the icon is centered by layout rather than font baseline alignment.
- Follow-up fix: Replaced the filled question-mark status detail icon with a clickable outlined info button that opens the provider detail popup on click.
- Follow-up fix: Restyled the provider status info button to match model-row info buttons and changed provider model detail controls from hover tooltips to click-open popovers.
- Follow-up fix: Removed the redundant `hidden` text tag from model rows because the visibility icon and strikethrough already communicate hidden state.

### Main model picker selected badge

- Issue spotted: The selected-model badge styling was local to the model row instead of being a named shared treatment, making it easy for main-page and settings-launched picker states to drift.
- Applied fix: Extracted the neutral `Selected` badge into a shared `SelectedModelBadge` component and used it from the main model picker row.
- Follow-up fix: Removed the left checkmark from the main-page access dropdown and compact access menu, moved selected state into the option header with the shared `Selected` badge, and switched the main composer model selector trigger to the same outlined model-picker treatment used in Settings.
- Follow-up fix: Reverted the composer trigger styling change and removed the composer-only locked-provider model picker layout so the main page opens the same redesigned rail/search/list picker shape as Settings.
- Follow-up fix: Added scoped-rail top padding when favorites are hidden and normalized provider rail button radii so a single locked provider icon no longer hits the picker roof or looks squared off.
- Follow-up fix: Trimmed the scoped single-provider rail top padding by one Tailwind spacing unit so the lone OpenCode icon sits visually centered.

### Composer trait dropdown split

- Issue spotted: The composer traits control combined reasoning and fast mode into one dropdown/trigger (`Medium · Fast`), making two independent settings feel like one compound option.
- Applied fix: Split the full composer traits picker into one dropdown per visible trait while reusing the shared menu body/update logic, and added a brain icon to reasoning triggers plus a lightning icon to fast/speed triggers.

### OpenCode interaction mode toggle consistency

- Issue spotted: Claude/Codex/Cursor exposed plan vs. build through a Build/Plan toggle button, but OpenCode hid that toggle and exposed its `agent` descriptor as a traits dropdown instead, leading to inconsistent composer affordances across providers. The active Plan state also lacked a distinct visual cue.
- Applied fix: Flipped OpenCode's `showInteractionModeToggle` to `true` so it uses the same Build/Plan toggle as other providers, hid the `agent` descriptor from the composer trait menus (they're already plan-controlled by the toggle), wired `interactionMode === "plan"` straight to the OpenCode adapter's `activeAgent`, and updated the toggle to swap to a `PencilRulerIcon` blueprint icon with a blue-tinted background/text when Plan is active.

### Traits dropdown selected/default badges

- Issue spotted: Traits dropdowns (Reasoning, Fast/speed, Context Window, etc.) used a leading checkmark indicator for the active option and an inline `(default)` text suffix, which did not match the neutral `Selected` badge used by the runtime mode (Supervised/Auto-accept/Full access) menu and put the default hint inline with the option label.
- Applied fix: Hid the radio checkmark in traits dropdowns and rendered the shared `SelectedModelBadge` next to the active option, and replaced the inline `(default)` text with a new neutral `DefaultBadge` so option rows use consistent badge chrome.

### Selected badge blue tint

- Issue spotted: The shared `SelectedModelBadge` rendered as a neutral muted chip in some surfaces (runtime mode dropdown, model picker rows) while Plan mode used a blue-tinted active treatment, so the "selected" signal was not consistent across composer menus.
- Applied fix: Updated `SelectedModelBadge` to use the same blue-tinted border/background/text as Plan mode in all call sites (runtime mode menu, traits dropdowns, model list rows, compact composer controls), removed the per-call `tone` prop since every consumer wants the blue treatment.

### Default and Selected badges stack instead of replacing

- Issue spotted: When a traits option was both the provider default and the currently selected value, only the blue `Selected` badge rendered — the `Default` badge was hidden because the chooser fell through an either/or branch, hiding the "this is also the default" signal.
- Applied fix: Rendered the `DefaultBadge` and `SelectedModelBadge` independently so both badges show side-by-side when an option is the default and the selected value at the same time.

### Provider accent badge clipped on icon

- Issue spotted: The accent-color circle and status dot rendered by `ProviderInstanceIcon` were positioned with negative offsets so they sat outside the icon's own bounding box, but ancestor wrappers in the composer model picker trigger applied `overflow-hidden` for label truncation and clipped those badges off (visible as a missing top of the accent circle in the composer trigger).
- Applied fix: Moved the `overflow-hidden` clipping off the composer model picker trigger button and inner row span (the inner label still has its own `overflow-hidden truncate` so text truncation behavior is unchanged), and added explicit `overflow-visible` plus a small `z-10` to the status dot/accent badge inside `ProviderInstanceIcon` so the indicators sit above neighbor content and aren't clipped by stacking contexts.

### Branch toolbar trigger icon

- Issue spotted: The branch picker trigger under the composer (e.g. `main`) only rendered a label and chevron, while its left-hand counterpart (`Current checkout`) had a folder/worktree icon, making the two triggers feel inconsistent.
- Applied fix: Added a leading `GitBranchIcon` to the branch selector trigger so the active branch label sits next to a clear branch glyph and visually matches the workspace selector beside it.

### Composer focus ring matches input ring

- Issue spotted: The composer surface used a flat 1px `has-focus-visible:border-ring/45` border swap when the prompt textarea was focused, which looked thin and harsh compared to the thicker `ring-ring/24 ring-[3px]` glow that the shared `Input` component uses on focus.
- Applied fix: Replaced the composer surface's flat border-color swap with the same focus treatment used by the shared input — `ring-ring/24` baseline plus `has-focus-visible:border-ring has-focus-visible:ring-[3px]` — so the prompt textarea picks up the soft, thicker blue-gray ring on focus instead of a flat colored border.

### Composer stop button uses destructive color

- Issue spotted: The stop button shown while a prompt is running used hard-coded `bg-rose-500` Tailwind utilities, which read as pink in the app's theme rather than the red used elsewhere for destructive actions.
- Applied fix: Switched the stop button to the theme-aware `bg-destructive` token (with `/90` baseline + solid hover) so it uses the same red as other destructive surfaces and adapts to light/dark themes via the existing `--destructive` variable.

### User message bubble shape and metadata layout

- Issue spotted: The user message bubble used `rounded-br-sm` for a small chat-tail effect that still read as a fully rounded corner, the timestamp lived inside the bubble next to hover-only copy/revert actions, and the copy button used the heavier `outline` variant which felt out of place against the bubble's filled background.
- Applied fix: Switched the bottom-right corner to `rounded-br-none` so the chat-tail asymmetry is unmistakable, moved the timestamp paragraph out from inside the bubble into a sibling under it (right-aligned, always visible), and changed the copy + revert buttons to `variant="ghost"` so the hover actions sit on the bubble surface without their own border.

### User message hover actions outside the bubble

- Issue spotted: After moving only the timestamp out from the user message bubble, the hover-only copy/revert actions stayed inside, which made the bubble grow on hover and looked mangled because the action row was reserving height inside the bubble whenever it was hovered.
- Applied fix: Promoted the bubble's `group` to the outer column wrapper, moved the entire hover action cluster out alongside the timestamp into a single right-aligned metadata row beneath the bubble, and bumped the timestamp to `text-sm` so it matches the new sibling layout instead of being stuck on a smaller `text-xs` size.

### Assistant message metadata consistency

- Issue spotted: The assistant message metadata row used `text-[10px] text-muted-foreground/30` (very small + extremely low contrast), the copy button used `variant="outline"` with custom border/background classes that did not match the user message's ghost copy button, and the order placed the timestamp before the copy button while the user-side row now ordered actions then timestamp.
- Applied fix: Reordered the assistant metadata to match the user side (copy button first, timestamp after), switched the assistant copy button to `variant="ghost"` with no extra border/background overrides, and changed the timestamp typography to `text-sm text-muted-foreground/50` so both sides share consistent metadata size and contrast.

### Hover-gated metadata row, no nested hover containers

- Issue spotted: The hover behavior for the user message metadata used a nested wrapper — the outer column was the `group`, and the inner action cluster also gated its own opacity — so the cluster needed both the outer `group:hover` AND its own state to reveal, which made hover feel inconsistent. The user wanted a single hover boundary where the copy button, revert button, and timestamp all fade together, anchored to the message itself.
- Applied fix: Promoted opacity gating to the single metadata-row wrapper (no nested hover divs), so on user messages the entire `[revert] [timestamp] [copy]` row fades in together with the bubble's `group-hover`, and on assistant messages the `[copy] [timestamp]` row fades in together with `group-hover/assistant`. Reordered the user-side metadata so the copy button still sits at the far right of the row.

### Chat-style relative timestamp formatter

- Issue spotted: Message timestamps were always rendered as a raw clock time (e.g. `10:00:09`) which made it hard to scan when a message was sent — there was no day-relative context (today vs yesterday vs last week) — and the timestamp paragraph was rendered at `text-muted-foreground/50` while the surrounding ghost copy button used `text-foreground`, so the metadata color did not match the action color even though they live on the same row.
- Applied fix: Added a shared `formatChatTimestamp(isoDate)` utility in `apps/web/src/timestampFormat.ts` that always returns a relative label — `Ns ago` under a minute, `Nm ago` under an hour, `Nh ago` under a day, `a day ago`, `N days ago`, `a week ago` / `N weeks ago`, `a month ago` / `N months ago`, and `a year ago` / `N years ago` for older messages. Wired the new formatter into both the user message metadata row and the assistant `formatMessageMeta` helper (dropping the now-unused `timestampFormat` argument at call sites), and switched both timestamp paragraphs to `text-foreground` so the timestamp color matches the ghost copy button it sits next to.

### Drop today-clock fallback in chat timestamp

- Issue spotted: The first version of `formatChatTimestamp` returned the absolute clock time (`10:00`) for messages from today — which is what was visibly rendering for fresh messages — and used `yesterday at {time}` for the previous calendar day. The user wanted purely relative output that scales smoothly from `12s ago` through `43m ago`, `12h ago`, `a day ago`, etc.
- Applied fix: Rewrote `formatChatTimestamp` to always produce a relative label (no absolute-clock fallback): seconds for the first minute, minutes under an hour, hours under a day, then `a day ago` / `N days ago` and the existing week/month/year tiers. Removed the `yesterday at {time}` branch and the `timestampFormat` parameter since the formatter no longer renders any clock components.

### Chat header project badges and drawer toggles

- Issue spotted: Outline badges next to the thread title had cramped padding; terminal and diff icon toggles used the default/outline toggle styling instead of ghost chips.
- Applied fix: Tuned header badge layout with `px-2 py-1`, flex centering, `leading-none`, and responsive overrides `sm:h-auto sm:min-h-0 sm:min-w-0` so vertical padding is not negated by the shared `Badge` default size (`h-5.5` / `sm:h-4.5`).
- Applied fix: Added a `ghost` variant to `apps/web/src/components/ui/toggle.tsx` (transparent border/shadow, `data-pressed:bg-accent`) and set both terminal and diff `Toggle`s in `apps/web/src/components/chat/ChatHeader.tsx` to `variant="ghost"`.

### Command palette folder browse key hints

- Issue spotted: Footer key hints used raw `Kbd`/`KbdGroup`; `KbdGroup` wrapped non-key content in a `<kbd>` which is awkward semantically. Add pill repeated the same pattern.
- Applied fix: Introduced `Shortcut` in `apps/web/src/components/ui/kbd.tsx` as a `Kbd` wrapper with `data-slot="shortcut"`. Updated `apps/web/src/components/CommandPalette.tsx` so the footer hint row and the browse Add button use `Shortcut`, with flex `div` wrappers instead of `KbdGroup`.

### Branch picker row tags as badges

- Issue spotted: Git branch rows in the branch combobox showed naked lowercase `current` / `remote` (and similar) as muted text on the right; they did not match dropdown badge styling such as the blue `Selected` chip.
- Applied fix: Replaced the right-hand labels in `apps/web/src/components/BranchToolbarBranchSelector.tsx` with shared `Badge` components: **Current** uses the same blue outline treatment as `SelectedModelBadge`; **Remote**, **Worktree**, and **Default** use the neutral outline/muted chip treatment like `DefaultBadge`.
- Follow-up fix: Removed the `border-b` between the branch search field and the list; restructured the popup body with `flex min-h-0 flex-1 flex-col overflow-hidden` so the scrollable list gets a stable max height. Non-virtualized lists keep the existing `ComboboxList` `ScrollArea` `scrollFade` (same mechanism as the model picker list). Virtualized lists (`LegendList`) use a `from-popover` bottom gradient overlay with opacity driven by scroll position (`getScrollableNode` + `syncBranchListScrollChrome`) so more content below is hinted the same way; scroll listeners for infinite branch loading skip the virtualized path when attaching to the wrong node and instead run from `LegendList` `onScroll`.
- Follow-up fix: Branch row uses `flex … justify-between gap-2` with a `min-w-0 flex-1 truncate` branch label and the kind badge. Tightened flush layout: shared `ComboboxItem` used `pe-4` (and list `px-1`), so badges sat inset; branch picker items use `pe-2`, and `ComboboxList` / `ComboboxListVirtualized` get `not-empty:ps-1 not-empty:pe-0` so the right edge matches the scroll viewport; the badge has only its own `ps`/`pe` padding, no margin.

### Workspace env mode selector matches branch-style badges

- Issue spotted: The Workspace `Select` (desktop) and mobile `MenuRadioItem` workspace options used the default leading check indicator; selection did not match other menus that use the blue `Selected` chip.
- Applied fix: `BranchToolbarEnvModeSelector` and mobile workspace rows in `BranchToolbar` now pass `hideIndicator` with `ps-2 pe-2`, row layout `justify-between`, and render `SelectedModelBadge` on the active option only (same blue treatment as model/branch pickers).

### Work group tool-call card styling

- Issue spotted: The collapsed work / tool timeline card used muted `bg-card/25`, tight padding, all-caps microcopy (`TOOL CALLS (15)`), and a plain “show more” control without a chevron.
- Applied fix: `WorkGroupSection` in `apps/web/src/components/chat/MessagesTimeline.tsx` now uses the same surface tokens as `Textarea` (`rounded-lg border border-input bg-background shadow-xs/5 dark:bg-input/32 not-dark:bg-clip-padding`), `p-4` padding, sentence-case headers (`N tool calls` / `N work log entries`), and chevron icons on the expand/collapse control (`ChevronDownIcon` / `ChevronUpIcon`). Updated `MessagesTimeline.test.tsx` to assert on the new work-log header copy.

### Pending user input panel (answer dialog) refinements

- Removed the `ANSWER NEEDED` uppercase header from `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx`; only the multi-question `N/M` indicator remains when applicable.
- Stacked each option's label and description vertically (label on top, smaller muted description below) instead of inline.
- Moved the digit shortcut (`1`, `2`, `3`, …) from the left of each card to the right end. The existing keyboard-shortcut handler in the same file (digit keys 1–9) was already wired and still triggers the matching option. Selected cards swap the shortcut for a check icon at the same position; both are vertically centered (`items-center`, no top margin).
- Added a fourth `Other` option in the temporary preview at `apps/web/src/components/chat/ChatComposer.tsx` (`TEMP_ALWAYS_SHOW_ANSWER_DIALOG_INPUT`). The panel detects `option.label === "Other"` and renders a transparent text `<input>` in place of the description, using the description string as the placeholder. Key/click events on the input stop propagation so typing does not trigger the digit shortcuts or row selection.
- Made the `Other` card a `<label>` element wrapping the input so clicking anywhere on the card focuses the input via native browser behavior. Other cards remain `role="button"` divs that select on click.
- Bumped per-card contrast: removed the previous `bg-muted/20` light surface, switched to `bg-background dark:bg-input/32` to match the tool-call card surface (see `MessagesTimeline.tsx:566`), with `hover:bg-muted/60 dark:hover:bg-input/45`. Selected cards use `bg-blue-500/10` (no border on any state per request — earlier `border-input` was added then removed).
- Increased shortcut chip contrast: `kbd` chips now use `bg-muted text-foreground` with a `border border-border/70` outline and `group-hover:bg-muted/80` instead of the previous low-opacity muted treatment.
- Investigated (but did not implement) AI-recommended option flow: identified that `AskUserQuestion` is provided by the Claude Agent SDK itself (handled in `apps/server/src/provider/Layers/ClaudeAdapter.ts:2555-2681`), wire schema lives in `packages/contracts/src/providerRuntime.ts:433` (`UserInputQuestionOption`), and a reusable blue badge pattern already exists in `apps/web/src/components/chat/SelectedModelBadge.tsx:7`. Implementation deferred per user direction not to touch backend provider layers.

### Tool call summaries toggle

- Added a new `toolCallSummaries` boolean to `ClientSettingsSchema` and `ClientSettingsPatch` in `packages/contracts/src/settings.ts` (defaults to `true`, flows automatically into `UnifiedSettings` and `DEFAULT_UNIFIED_SETTINGS`).
- Added a `SettingsRow` titled **Tool call summaries** in `apps/web/src/components/settings/SettingsPanels.tsx`, placed between **Delete confirmation** and **Text generation model**, with the same Switch + reset-button pattern used by the surrounding rows.
- Updated `apps/web/src/hooks/useToolWorkLogFriendlyLine.ts` to read the new setting via `useSettings` and short-circuit the LLM summary effect (`setLine(null)`) when `toolCallSummaries` is off, so no friendly-line request is fired and the UI falls through to the existing heading + muted-preview fallback in `SimpleWorkEntryRow` (which already renders `<heading> <preview>` with `gap-2` and `text-muted-foreground` on the preview span).

### "Other" answer prompt option becomes a real free-text answer

- Added a new `onSetActivePendingUserInputCustomAnswer(questionId, value)` callback in `apps/web/src/components/ChatView.tsx` next to the existing composer-bound `onChangeActivePendingUserInputCustomAnswer`. The new handler updates the draft answer state via `setPendingUserInputCustomAnswer` without touching the composer textarea/cursor (no `composerRef.focusAt` side effect), so typing in the inline "Other" input does not steal focus.
- Threaded the new callback through `apps/web/src/components/chat/ChatComposer.tsx` (props + destructure + `<ComposerPendingUserInputPanel onChangeCustomAnswer={...}>`) and added `onChangeCustomAnswer` to `ComposerPendingUserInputPanel`'s prop types in `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx`.
- Wired the "Other" input in the panel to the answer state: controlled `value={progress.customAnswer}`, `onChange` calls `onChangeCustomAnswer(activeQuestion.id, value)`, and pressing Enter (without Shift) when the input is non-empty calls `onAdvanceRef.current()` so the last-question path submits the typed text via `onRespondToUserInput`.
- Reused the existing `customAnswer` field on `PendingUserInputDraftAnswer` (see `apps/web/src/pendingUserInput.ts`): `resolvePendingUserInputAnswer` already returns the trimmed `customAnswer` over any selected option labels, so the SDK answer for that question becomes the user's typed string (not the literal "Other"). `setPendingUserInputCustomAnswer` clears `selectedOptionLabels` while `customAnswer` is non-empty so visual selection moves to the "Other" card automatically.
- Updated the panel's selection visuals: when `progress.customAnswer.trim().length > 0`, the "Other" card renders as selected (blue background + check icon at the right edge); other cards are de-selected because the resolved answer now comes from custom text.
- Updated the digit shortcut handler: pressing the number key for "Other" now focuses its input (`otherInputRef.current?.focus()`) instead of calling `handleOptionSelection`, so users can keyboard-jump to type a free-form answer.

### Removed temp answer-dialog preview

- Deleted the `TEMP_ALWAYS_SHOW_ANSWER_DIALOG_INPUT` constant from `apps/web/src/components/chat/ChatComposer.tsx` and changed `pendingUserInputsForDisplay` back to the real `pendingUserInputs` value (no synthetic preview when the list is empty), so the answer panel only appears when the runtime actually has a pending user-input request.

### Prompt metadata duration prefix

- Updated `formatMessageMeta` in `apps/web/src/components/chat/MessagesTimeline.tsx` to render the elapsed working timer as `worked for {duration}` instead of the bare duration, so prompt metadata reads e.g. `18h ago • worked for 3m 11s` instead of `18h ago • 3m 11s`.

### Composer send/stop buttons get dialog-button halo

- Found the dialog primary/destructive button "halo" treatment in `apps/web/src/components/ui/button.tsx`: `default`/`destructive` variants combine an outer colored glow (`shadow-xs shadow-primary/24` or `shadow-destructive/24`) with a top-edge inset highlight (`not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)]`) and a pressed-state inverted highlight (`[:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)]` plus `[:disabled,:active,[data-pressed]]:shadow-none`).
- Applied the same treatment to the composer primary actions in `apps/web/src/components/chat/ComposerPrimaryActions.tsx`. Both circular buttons (the blue submit/send button and the destructive/red stop button) now use `shadow-xs` + the matching colored shadow tint, the white top inset highlight on idle/hover, and the inverted black inset on `:active` (with `active:shadow-none` and `disabled:shadow-none` to drop the glow on press/disabled), so they match the inset glow used by dialog confirm/cancel buttons across both color states.

### Composer focus ring switched to neutral

- Replaced the composer surface focus treatment in `apps/web/src/components/chat/ChatComposer.tsx` from the theme blue (`ring-ring/24` + `has-focus-visible:border-ring`) to a neutral foreground-tinted ring (`ring-foreground/12` + `has-focus-visible:border-foreground/40`) so the focus glow does not clash with the red destructive stop button when a generation is in progress.

### Project right-click menu — header, icons, destructive separator (web fallback)

- Extended `ContextMenuItem` in `packages/contracts/src/ipc.ts` with two optional fields: `header?: boolean` (renders as a non-interactive section label) and `icon?: string` (icon keyword the web fallback resolves). Both are stripped on desktop because Electron's native context menu has no equivalent affordance.
- Updated `normalizeContextMenuItems` in `apps/desktop/src/main.ts` to skip `header: true` items entirely so they don't reach Electron's `Menu.buildFromTemplate`. The desktop `buildTemplate` already auto-inserts a separator before destructive items, so the destructive divider behavior is unchanged on native menus.
- Reworked `apps/web/src/contextMenuFallback.ts` to render the new fields:
  - Added an inline-SVG icon registry (`pencil`, `copy`, `folder-tree`, `trash`) using stroke-based Lucide path data (`viewBox="0 0 24 24"`, stroke width 2, `currentColor`). `createIconElement(name)` builds an SVG node sized `size-3.5` and prepends it to the menu button.
  - Header items render as a small `text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60` label instead of a button.
  - Auto-inserts a `my-1 h-px bg-border/70` separator before the first destructive leaf when the menu already has at least one interactive entry above it (mirrors desktop's auto-separator).
- Updated the project right-click menu in `apps/web/src/components/Sidebar.tsx` to:
  - Lead with a `{ id: "header:project", label: "Project", header: true }` entry so the menu has a clear title.
  - Attach `icon: iconForAction[action]` to each top-level project action (`rename → pencil`, `grouping → folder-tree`, `copy-path → copy`, `delete → trash`), including the submenu trigger when a project group has multiple members.
  - "Remove project" still uses `destructive: true`, so the web fallback now renders an automatic separator above it.

### Project context menu — drop header, mute neutral icons, keep destructive red

- Removed the `{ id: "header:project", label: "Project", header: true }` entry from the project right-click menu in `apps/web/src/components/Sidebar.tsx`. The header/icon contract fields and web fallback support remain available for other call sites.
- Updated `createIconElement` in `apps/web/src/contextMenuFallback.ts` to accept a `tone: "neutral" | "destructive"` argument and emit `text-muted-foreground` for neutral icons (so rename/grouping/copy-path icons sit visually quieter than the menu label) while destructive icons keep `currentColor` (inheriting the button's `text-destructive`, so the trash icon stays red).
- Threaded the tone through the render loop: `createIconElement(item.icon, isLeafDestructive ? "destructive" : "neutral")`.

### Context menu fallback — full-bleed hover

- Replaced the menu container's vertical padding (`py-1`) with `overflow-hidden` in `apps/web/src/contextMenuFallback.ts`. Item hover backgrounds now extend edge-to-edge (top and bottom) while `overflow-hidden` keeps the rounded corners clipping the items cleanly.

### Project context menu fallback polish and shortcut keycaps

- Fixed `apps/web/src/contextMenuFallback.ts` so the browser fallback context menu opens reliably without a fullscreen dismiss overlay. Dismissal now uses document-level capture listeners for outside pointer/context-menu events, avoiding the previous "opens then immediately disappears" failure mode.
- Restyled the fallback to match the app menu density more closely: rounded-lg popover shell, p-1 inner wrapper, compact 14px rows, 28px row height, muted neutral icons, and no animation dependency that can leave the menu transparent.
- Removed the automatic destructive separator before project removal. Destructive rows now stay in the normal item group.
- Adjusted destructive fallback rows so `Remove` is red at rest and uses a destructive red hover tint.
- Renamed the project context menu actions in `apps/web/src/components/Sidebar.tsx` to `Rename`, `Group into...`, `Copy Path`, and `Remove`.
- Updated stale client settings fixtures in `apps/desktop/src/clientPersistence.test.ts` and `apps/web/src/localApi.test.ts` to include `toolCallSummaries: true`, keeping typecheck aligned with the current settings contract.
- Moved shortcut-label keycap splitting into the shared `Shortcut` component in `apps/web/src/components/ui/kbd.tsx`. String labels like `Ctrl+Shift+O`, `Ctrl K`, and `⇧⌘O` now render as grouped individual keycaps automatically.
- Updated command palette result shortcuts in `apps/web/src/components/CommandPaletteResults.tsx` to rely on the shared `Shortcut` behavior instead of rendering a single chunky `Ctrl+Shift+O` pill.
- Converted dynamic shortcut-label call sites in `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/chat/ModelListRow.tsx`, and `apps/web/src/components/chat/OpenInPicker.tsx` from raw `Kbd` to `Shortcut`, so they share the same keycap treatment.
- Preserved right-alignment classes like `ms-auto` on split shortcut labels by applying auto margins to the shortcut group wrapper while keeping size/typography classes on each keycap.
- Aligned the Projects header ghost icon controls in `apps/web/src/components/Sidebar.tsx` with the chat header ghost icon button footprint: both sort and add-project controls now use a 24px-tall `xs`-style box with matching horizontal padding instead of the previous tight 20px square.
- Aligned the per-project hover "new thread" icon button in `apps/web/src/components/Sidebar.tsx` to the same 24px `xs`-style ghost footprint, then refined its placement after visual review: `right-0.5` and a 1px downward optical nudge keep it centered and slightly closer to the right edge.
- Added a muted folder icon to the active project directory badge in `apps/web/src/components/chat/ChatHeader.tsx`, and added `GitBranchPlusIcon` to the non-repo `Initialize Git` header action in `apps/web/src/components/GitActionsControl.tsx`.
- Matched the `Initialize Git` header action's icon-to-label spacing to `Add action` by wrapping the label with the same small left margin treatment.
- Added local Spell-style `ShimmerText` and `BlurReveal` primitives, wired compact tool-call rows to shimmer on the tool name while the friendly tool summary is pending, then blur-reveal the summary when it arrives. Success checkmarks now use the app primary blue accent.
- Added a temporary chat-page tool-call preview card with failed, in-progress, empty, and delayed-complete rows so the shimmer-to-blur-reveal transition can be inspected in the live UI.
- Adjusted the temporary tool-call preview so failed rows keep neutral text while only the status indicator is destructive, and in-progress rows use a muted spinning loading-circle icon matching the empty minus color.
- Updated the temporary empty tool-call preview row so the tool call name remains foreground; only the status icon is muted.
- Set the tool summary blur-reveal transition speed to `speedReveal={2}` in both real compact tool-call rows and the temporary preview card.
- Fixed `ShimmerText` to use explicit theme colors instead of `currentColor` with transparent clipped text. Tool-call shimmer now stays foreground at rest and mutes through `muted-foreground` during the pass.
- Reworked `ShimmerText` to use a transform-animated muted overlay instead of animating clipped background-position, reducing shimmer hitching. Restored the tool summary blur reveal to a snappier `speedReveal={0.6}`.
- Removed `ShimmerText` from the codebase. Pending tool-call names now render as plain foreground text, with the muted loading-circle status icon carrying the in-progress state.
- Removed the temporary tool-call preview pane from the chat page and deleted its component.
- Removed `truncate` from the `BlurReveal` element in compact tool-call summary rows to avoid clipping animation bugs, and set its reveal speed to `0.2`.
- Matched the composer `@` and `/` popup to the composer card by removing the inset wrapper padding, using the same `rounded-[20px]` radius, forcing full width, and rendering empty states without an empty `CommandList` spacer.
- Updated shared button, select, menu, toggle, autocomplete, and combobox primitives so unlabeled-color icons in foreground label controls render as `text-muted-foreground` while the text remains foreground; explicit icon colors, item check indicators, and destructive menu icons are preserved.
- Aligned the custom provider model picker chevron with the trailing select chevrons by giving it the same trailing auto-margin behavior inside the trigger row.
- Nudged the provider model picker chevron farther right to match the visual trailing edge of adjacent select controls.
- Reworded the Keybindings and Diagnostics settings copy so each description includes its disk path inline as a styled code chip, and removed the duplicated separate path/status helper text.
- Restyled those settings path chips to match chat inline code styling with a smaller font, muted code background, and visible border.
- Removed mono/tabular styling from the Providers section's "Checked ... ago" timestamp so the full label renders in sans.
- Removed the vertical trait separators from the Text generation model settings row by allowing `TraitsPicker` trigger separators to be disabled for that usage.

Note for ongoing work: append new bullets under this file's latest section (or add dated subsections) whenever further UI or behavior changes are made in this thread.
