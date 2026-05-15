# Epic 11: Atlassian Setup UI

## Purpose

Design the Atlassian setup and Jira project selection experience using the existing T3
Code shell and UI primitives as the baseline.

This flow should make project creation feel structured and low-effort:

1. Connect Atlassian.
2. Choose an Atlassian site/account.
3. Choose a Jira project.
4. Confirm managed workspace settings.
5. Land in the project overview with relevant recipes.

## Existing T3 Baseline

The implementation must start from these existing T3 surfaces and primitives:

- `AppSidebarLayout` for the overall shell frame.
- `Sidebar` and `ui/sidebar` primitives for left navigation.
- `SettingsPageContainer`, `SettingsSection`, and `SettingsRow` for structured setup
  pages.
- `Dialog`, `AlertDialog`, `Popover`, `Menu`, and `Select` for focused choices.
- `Button`, `Badge`, `Input`, `Textarea`, `Switch`, `Spinner`, `Skeleton`, `Tooltip`,
  `Toast`, and `ScrollArea` for controls and states.
- `ProjectFavicon` as the local pattern for project identity fallback.
- Existing provider/settings cards as the baseline for integration account cards.

This is not a new design system. Copy or import the existing primitives first, then add
only the missing `t3work`-specific composition.

## Brand Assets

Use official Atlassian assets, not third-party logo copies.

Sources:

- Atlassian Design logos page: `https://atlassian.design/foundations/logos`
- Atlassian trademark page: `https://www.atlassian.com/legal/trademark`
- Optional package candidate: `@atlassian/brand-logos`

Asset rules:

- Source logos from Atlassian's official design site or official package.
- Use product logos only to identify the integration or product.
- Do not modify Atlassian or Jira logos except resizing.
- Do not combine Atlassian logos with the T3 Code logo.
- Do not mimic Atlassian's website look and feel.
- Use `Atlassian` as alt text for the Atlassian company logo.
- Use `Jira` as alt text for the Jira logo.

Recommended MVP assets:

- Atlassian logomark or logo for provider selection.
- Jira logo for Jira project selection and source badges.
- Confluence logo only when Confluence support is actually present.

## Information Architecture

### Entry Points

Project shell should expose Atlassian setup from:

- project browser empty state
- project browser "New project" button
- integrations/settings page
- project source add button

The primary entry point for the MVP is the project browser.

### Flow Shape

Prefer an inline setup page for first-time setup and a dialog for smaller follow-up
actions.

First-time flow:

```text
Project Browser
  -> New Project
  -> Connect Atlassian
  -> Select Site
  -> Select Jira Project
  -> Confirm Project
  -> Project Overview
```

Returning-user flow:

```text
Project Browser
  -> New Project
  -> Select Jira Project
  -> Confirm Project
  -> Project Overview
```

## Screen 1: Integration Choice

Baseline:

- Existing settings/provider card style.
- Existing empty state style.
- Existing button and badge primitives.

Content:

- page title: `Create project`
- primary option: Atlassian
- secondary options: local project, empty managed project
- disabled/future options can be shown only if visually quiet

Atlassian card:

- Atlassian logo
- title: `Atlassian`
- description: `Create a project from Jira work you can access.`
- badges: `Jira`, later `Confluence`
- action: `Connect` or `Choose project`

States:

- not connected
- connecting
- connected
- connection error

## Screen 2: Connect Atlassian

Baseline:

- Existing pairing/connection settings rows.
- Existing dialog/toast patterns for auth status.

Content:

- Atlassian logo
- concise explanation of what the app will read
- connect button
- account status after connection

Required copy:

- what will be read: visible sites, Jira projects, issues, comments
- what will not happen automatically: no Jira edits without approval
- where data is cached: local managed workspace

Controls:

- `Connect Atlassian`
- `Cancel`
- `Retry`
- `Disconnect` after connected

States:

- awaiting auth
- polling/connecting
- success
- denied/cancelled
- expired
- network error

## Screen 3: Select Atlassian Site

Show this only when the account has multiple accessible sites.

Baseline:

- `Select` or list row pattern from settings.
- `ScrollArea` for long site lists.
- `Skeleton` while loading.

Site row:

- Atlassian logo or generic site icon
- site name
- site URL
- optional role/access hint if available
- selected state

Actions:

- `Back`
- `Continue`
- `Refresh`

Empty state:

- title: `No Atlassian sites found`
- actions: `Retry`, `Use another account`

## Screen 4: Select Jira Project

This is the core project selection UI.

Baseline:

- Existing sidebar project list density.
- Existing command palette/search interaction style.
- Existing badges and status indicators.

Layout:

- search input at top
- filter row for project type/category if available
- scrollable project list
- detail preview panel on the right for wider screens
- compact single-column version for narrow screens

Project row:

- Jira logo or project avatar
- project name
- project key
- project type, if available
- issue count or recent issue count, if available
- last updated hint, if available
- selected indicator

Preview panel:

- project name and key
- source: Jira
- site URL
- visible issue count if available
- default managed workspace path, collapsed by default
- top suggested recipes that will be enabled

Actions:

- `Back`
- `Refresh`
- `Continue`

States:

- loading projects
- loaded projects
- search with no matches
- no projects accessible
- API error
- permission error

## Screen 5: Confirm Project

Baseline:

- Existing settings section/row layout.
- Existing project/provider card style.

Content:

- project name
- Jira project key
- Atlassian site
- managed workspace summary
- default profile
- initial recipe bundle
- cache policy summary

Defaults:

- workspace: managed
- profile: QA Assistant when Jira issue flow is selected
- recipes: explain ticket, review acceptance criteria, create QA test plan, draft Jira
  comment, summarize project risk
- mutation policy: review required

Controls:

- project name input
- profile select
- advanced disclosure for workspace path
- create button
- back button

Important: do not ask the user to choose a local directory by default.

## Screen 6: Created Project Overview

After creation, land directly in the project overview.

Show:

- project title and source badge
- Jira issues list
- suggested recipes
- recent artifacts area
- empty artifact state
- thread/run area

Primary first action:

- select a Jira issue
- or launch `Summarize project risk` if no issue is selected

## Component Inventory

New composition components likely needed:

- `IntegrationProviderCard`
- `AtlassianConnectionPanel`
- `AtlassianSiteList`
- `JiraProjectSearch`
- `JiraProjectList`
- `JiraProjectRow`
- `JiraProjectPreview`
- `ManagedWorkspaceSummary`
- `ProjectRecipeBundlePreview`
- `ProjectCreateConfirmation`

These should be built from existing T3 primitives. They are compositions, not new base
controls.

## Data Requirements

### Atlassian Site

```ts
type AtlassianSiteOption = {
  cloudId: string;
  name: string;
  url: string;
  avatarUrl?: string;
};
```

### Jira Project

```ts
type JiraProjectOption = {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
  avatarUrl?: string;
  url?: string;
  recentIssueCount?: number;
  lastIssueUpdatedAt?: string;
  raw?: unknown;
};
```

### Project Creation Draft

```ts
type AtlassianProjectCreationDraft = {
  provider: "atlassian";
  cloudId: string;
  siteUrl: string;
  jiraProjectId: string;
  jiraProjectKey: string;
  title: string;
  workspaceKind: "managed";
  profileId: "qa-assistant" | "product-explainer" | "developer-bridge";
  recipeIds: string[];
};
```

## Accessibility Requirements

- All logos need alt text.
- Project rows must be keyboard navigable.
- Search should focus automatically when project selection opens.
- Selection must be conveyed without relying on color alone.
- Loading and error states must be screen-reader visible.
- Buttons must use concrete verbs: `Connect`, `Continue`, `Create project`, `Retry`.

## Storybook Requirements

Stories required before stabilization:

- integration choice, disconnected
- integration choice, connected
- Atlassian connect, loading
- Atlassian connect, error
- site picker, one site
- site picker, many sites
- Jira project picker, loading
- Jira project picker, empty
- Jira project picker, many projects
- Jira project picker, long names
- confirm project, default settings
- confirm project, advanced workspace expanded
- created project overview, no issues
- created project overview, with issues

## Browser Validation Script

For every implementation change in this flow, the agent must open the app in a browser
and click through:

1. Open project browser.
2. Click `New project`.
3. Choose Atlassian.
4. Complete or mock connection.
5. Select a site if multiple sites exist.
6. Search Jira projects.
7. Select a Jira project.
8. Confirm managed workspace settings.
9. Create project.
10. Verify project overview opens.
11. Verify Jira source badge/logo renders.
12. Verify relevant recipes render.

The final report must state which path was clicked and which states were inspected.
