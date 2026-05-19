# Epic 12: Profiles And Skill Packs

## Purpose

`t3work` should not be positioned as a QA-only product. QA is the first useful bundle,
but the product is a project-based agent workspace for many kinds of work.

Profiles and skill packs make that explicit.

## Concepts

### Profile

A profile controls how the assistant communicates and what kind of output it prefers.

Examples:

- QA Assistant
- Product Partner
- Support Triage
- Delivery Coordinator
- Engineering Copilot

Profiles affect:

- tone
- amount of technical detail
- preferred artifact types
- default recipe ranking
- mutation safety posture
- follow-up suggestions

### Skill Pack

A skill pack is a bundle of recipes, action recipe templates, prompt blocks, artifact
templates, and tool permissions for a type of work.

Examples:

- QA
- Product
- Support
- Delivery
- Engineering
- Release

A project can enable multiple skill packs. A user can select one default profile for how
they want the agent to communicate.

## Package

Skill packs should live in:

```text
packages/t3work-skill-packs
```

This package owns bundled definitions, not runtime execution.

Suggested layout:

```text
packages/t3work-skill-packs/src/
  profiles/
    qaAssistant.ts
    productPartner.ts
    supportTriage.ts
    deliveryCoordinator.ts
    engineeringCopilot.ts
  packs/
    qa.ts
    product.ts
    support.ts
    delivery.ts
    engineering.ts
  promptBlocks/
  artifactTemplates/
```

## Profile Model

```ts
type T3WorkProfile = {
  id: string;
  title: string;
  description: string;
  audience: "qa" | "product" | "support" | "delivery" | "engineering" | "mixed";
  communicationStyle: {
    technicalDepth: "low" | "medium" | "high";
    brevity: "short" | "balanced" | "detailed";
    defaultLanguage?: string;
  };
  preferredArtifactKinds: string[];
  defaultRecipeWeights: Record<string, number>;
};
```

## Skill Pack Model

```ts
type T3WorkSkillPack = {
  id: string;
  title: string;
  description: string;
  defaultProfileId?: string;
  recipeIds: string[];
  actionRecipeIds?: string[];
  promptBlockIds: string[];
  artifactTemplateIds: string[];
  allowedToolGroups: string[];
};
```

## Initial Profiles

### QA Assistant

For testers and QA-focused project work.

Defaults:

- low-to-medium technical depth
- short explanations
- test matrices
- risk lists
- clear reproduction steps
- explicit open questions

### Product Partner

For PMs, analysts, and product-adjacent users.

Defaults:

- low technical depth
- stakeholder summaries
- scope/risk framing
- requirement clarification
- decision notes

### Support Triage

For support and customer-facing investigation.

Defaults:

- customer-readable language
- escalation summaries
- reproduction request drafts
- severity and impact framing

### Delivery Coordinator

For release, planning, and coordination work.

Defaults:

- concise status
- blockers
- dependencies
- release checklists
- standup summaries

### Engineering Copilot

For users who want more technical detail.

Defaults:

- higher technical depth
- implementation plans
- codebase references when available
- testing and verification steps

## Initial Skill Packs

### QA Pack

Recipes:

- Explain ticket simply
- Review acceptance criteria
- Create QA test plan
- Create bug reproduction guide
- Draft Jira comment

### Product Pack

Recipes:

- Summarize requirement
- Find ambiguity
- Draft stakeholder update
- Compare ticket to prior decisions
- Create open question list

### Support Pack

Recipes:

- Summarize customer issue
- Draft reproduction request
- Create escalation summary
- Map issue to known risks

### Delivery Pack

Recipes:

- Summarize project risk
- Create release checklist
- Draft standup update
- Identify blocked work

### Engineering Pack

Recipes:

- Draft implementation plan
- Identify likely repo areas
- Convert ticket to technical checklist
- Draft verification plan

## Project Creation Defaults

When creating from Jira:

- show recommended skill packs based on project type and issue data
- default to QA pack if the user chooses a QA-oriented profile
- allow Product, Support, Delivery, and Engineering packs to be enabled too
- never imply Jira projects are only for QA work

Confirm screen should show:

- selected profile
- enabled skill packs
- top recipes that will appear first
- mutation safety policy

## UI Requirements

Profile selection should be a normal setup step, not hidden in settings.

Use existing T3 primitives:

- cards for profile choices
- badges for skill pack categories
- select/menu for compact profile switching
- settings rows for later edits

Project overview should show enabled skill packs as quiet badges near the project source
badges.
