---
name: interactive-mockup-choreography
description: "Design and refine interactive product mockups with realistic UX flow, phased animations, strict chronology, and synchronized simulated interactions. Use when creating or polishing HTML/CSS/JS prototypes, walkthrough docs, cursor-driven demos, or timeline and sequence simulations in any project."
argument-hint: "Describe the scenario, the required interaction chronology, and any non-regression constraints."
user-invocable: true
---

# Interactive Mockup Choreography

Build high-fidelity interactive mockups from first principles. The job is to make a flow feel causally correct: a trigger happens, the system responds, supporting detail appears, and any later artifact or panel reveals itself only when the sequence justifies it.

## When to Use

- You need an HTML-based mockup, demo, or walkthrough to feel real instead of flat.
- The interaction order is wrong, confusing, or visually out of sync.
- The mockup has staged reveals, animated transitions, or cursor-driven actions.
- You need to preserve existing behavior while refining realism.
- You need a repeatable way to coordinate motion, content, and timing.

## Inputs To Collect First

- Scenario: what the mockup is trying to demonstrate.
- Audience: who should understand it and what they need to see quickly.
- Interaction sequence: the exact order of triggers, responses, and artifacts.
- Non-regression constraints: what must stay intact.
- Realism constraints: what should be shorter, simpler, or more visual.
- Structure constraints: what parts are narrative, what parts are visual, and what parts are interactive.

## References

- [Interaction patterns and examples](./references/example-patterns.md)
- [Timing and synchronization rules](./references/timing-sync.md)
- [Handling large or repetitive files](./references/large-files.md)

## First Principles

### 1. Belief Before Style

Every interaction should answer:

- What just happened?
- What caused it?
- What happens next?

If the page cannot answer those questions clearly, the visual design is not finished yet.

### 2. One Visible Truth Per Moment

At any moment, the mockup should make one state feel primary.

- A trigger should look like a trigger.
- A response should look like a response.
- A staged artifact should appear only after its reason exists.

Do not let multiple states compete for attention unless that tension is intentional.

### 3. Time Is Part of the Design

Timing is not an implementation detail.

- A reveal that happens too early destroys causality.
- A staged state that clears too soon feels broken.
- Motion without purpose feels fake.

The choreography must prove the sequence, not merely animate it.

## Workflow

### Phase 1: Baseline Mapping

1. Identify the target section or artifact and the code path that drives it.
2. Map the visible states by phase: trigger, response, supporting artifact, and any auxiliary panels or annotations.
3. Record the timing model and the selectors or handlers that mutate each state.

Completion checks:

- You can say what appears in each phase and why.
- You can point to the selectors, classes, or handlers controlling each appearance.

### Phase 2: Chronology Contract

Define the causality contract before editing visuals.

Required order pattern:

1. A trigger appears.
2. The system response appears.
3. Supporting evidence or detail appears.
4. Optional confirmation or branching choice appears.
5. Optional artifact, panel, or summary appears.
6. Any long-running or staged detail appears only after its trigger.

Decision points:

- If the trigger already exists, show it immediately and do not replay it unnecessarily.
- If a later confirmation is genuine input, keep it as a separate late-stage interaction.
- If a panel appears without trigger, insert an explicit trigger or confirmation step before reveal.
- If a response answers a question directly, keep it short and concrete before expanding into supporting detail.

Completion checks:

- Every major reveal has a visible trigger in a preceding phase.
- No response appears before the relevant trigger.

### Phase 3: Information Fidelity

1. Replace generic filler with concrete, scenario-specific information.
2. Keep labels, statuses, controls, and callouts short and unambiguous.
3. Present details in structured form when helpful: priority lists, checklists, tables, or flow steps.
4. Convert internal jargon to domain language appropriate for the intended audience.
5. Use explicit nouns and actions that match the workflow instead of placeholders.

Decision points:

- If output looks like raw code, render it as a plain-language activity summary or operational steps.
- If a card is vague, replace it with a concrete workflow, checklist, matrix, or flow visualization.
- If the concept is temporal or staged, prefer a timeline or progress map over generic prose.

Completion checks:

- The first visible system output is directly relevant to the trigger.
- Cards and artifacts are actionable and explanatory, not decorative.

### Phase 4: Animation and Visual State Clarity

1. Distinguish states visually:

- Active state: focused control + staged text + caret or focus cue
- Triggered state: new item in the timeline or flow
- Response state: system content reveal

2. Ensure staged text does not flash empty before send unless intentional.
3. Scope overrides to the target scenario to avoid cross-example regressions.
4. Keep click-before-effect semantics in cursor choreography.
5. Keep the cursor, input state, and content reveal synchronized to the same phase contract.
6. Prefer deterministic phase changes over ad hoc timeouts that drift out of order.
7. Treat animation order as part of the content order.

Decision points:

- If ordering is unstable due to global classes, add scenario-specific phase overrides.
- If state labels leak, tighten selectors to exclude unrelated item classes.
- If the interaction is complex, break it into explicit sub-beats: focus -> trigger -> response -> evidence -> artifact.

Completion checks:

- The user can visually tell which state is active at every step.
- Input, timeline, and panel states do not conflict.

### Phase 5: Panel/Card Gating and Handoff

1. Gate side panel/card visibility behind an explicit in-flow trigger.
2. Keep action labels realistic and destination-aware.
3. Add a concise note for where iteration continues.
4. Make handoff actions believable for the artifact type: add to notes, open walkthrough, export checklist, continue in browser, etc.

Decision points:

- If an action implies persistence, name the target.
- If proposing walkthrough automation, word it as an optional guided mode unless it is actually implemented.
- If the panel is a generated deliverable, say where it lives and how it is used later.

Completion checks:

- No random panel appearance.
- CTA labels imply clear, believable outcomes.

### Phase 6: Validate After Each Change

Use iterative validation after small edits.

Validation loop:

1. Run a syntax or error check for the edited file.
2. Run browser snapshot checks at key phases.
3. Confirm at least these checkpoints:

- Early phase: the trigger is visible first.
- Mid phases: response then evidence appear in order.
- Late phase: confirmation then panel reveal.

4. Re-check non-regression constraints.
5. If the file is large, validate the narrow slice first before touching adjacent sections.
6. If a stage feels out of order in the browser, fix choreography before changing styling.

Completion checks:

- No file errors.
- Sequence and visibility match the chronology contract.
- Protected behaviors remain intact.

## Quick Test Matrix

- Order: trigger -> response -> evidence -> confirmation -> artifact
- Roles: no item should be mislabeled as the wrong actor or source
- Input: no premature clear/flash; staged text appears only when intended
- Cursor: no teleporting/random jumps; click precedes state changes
- Panel: hidden until justified by prior interaction
- Language: no unnecessary technical prefixes unless they add clarity
- Sync: cursor, staged text, timeline items, and panel updates never disagree about what just happened

## Implementation Notes

- Keep choreography data separate from content so timing can evolve without rewriting prose.
- Use reusable helpers for phase scheduling and target selection instead of duplicating animation logic.
- Prefer small, reversible edits when a large file contains many mirrored sections.
- For large files, split the work into isolated regions and validate each region independently.

## Output Template

When done, provide:

1. What changed and why, focused on chronology and realism.
2. Phase-by-phase behavior summary.
3. Validation evidence: errors, phase snapshots, critical selectors.
4. Remaining ambiguities that need user preference.

## Common Failure Modes

- The first response does not answer the trigger.
- The same trigger appears twice without a reason.
- Supporting detail appears before the response.
- Side panel appears before its trigger.
- State selectors accidentally tag the wrong item as active.
- Global phase rules break scenario-specific sequencing.

## Adaptation Notes

- This skill does not assume a specific framework; apply it to HTML/CSS/JS, React, Astro, or other UI prototypes.
- Replace the example nouns with your product terms while keeping the phase contract.
- Keep orchestration logic separate from content text so timing can evolve independently.
- Use the companion references for concrete patterns, synchronization rules, and large-file handling.
