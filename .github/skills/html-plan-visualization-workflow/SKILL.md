---
name: html-plan-visualization-workflow
description: "Design and refine HTML-based planning docs with clear structure, visual flow, embedded links/tooltips, and optional interactive mockup sections. Use when creating or polishing plan pages, proposal docs, walkthrough pages, or HTML specs that explain a workflow visually in any project."
argument-hint: "Describe the plan page, intended audience, and any interactive sections or visual constraints."
user-invocable: true
---

# HTML Plan Visualization Workflow

Build planning pages that explain a workflow visually and in the right order. This skill is for HTML-based plans, product proposals, roadmap pages, design specs, and interactive documentation that mixes narrative, diagrams, cards, and occasional mockup sections.

If a section needs realistic animation choreography, cursor-driven interactions, or thread/timeline simulation, use the companion skill [interactive-mockup-choreography](./interactive-mockup-choreography/SKILL.md) for that portion of the work.

## When to Use

- You need a plan page that is easier to scan than a plain doc.
- The page should feel structured, visual, and causally correct.
- You want linkable references, inline tooltips, or context cards.
- You need a phased plan, a roadmap, or a guided walkthrough in HTML.
- You want the page to read like a polished artifact, not raw notes.

## Inputs To Collect First

- The primary goal of the plan page.
- The audience for the page.
- The sequence the reader should follow.
- Any required sections, milestones, or decision points.
- Constraints: what must stay, what must not be shown too early, and what needs to remain lightweight.

## Phase Workflow

### Phase 1: Structural Map

1. Identify the major sections of the page.
2. Map the reading order and decide which sections need emphasis.
3. Identify any sections that should be visually grouped, collapsed, or staged.

Completion checks:

- The page has a clear top-to-bottom logic.
- Headings, cards, and sections are not redundant.

### Phase 2: Narrative Contract

Define the message before styling.

Required order pattern:

1. State the goal.
2. Show the plan or path.
3. Show evidence, constraints, or tradeoffs.
4. Show the next action or handoff.

Decision points:

- If the page is explanatory, keep prose concise and structured.
- If the page is decision-oriented, surface tradeoffs and priorities early.
- If the page contains an interactive walkthrough, keep the walkthrough subordinate to the plan narrative.

Completion checks:

- A reader can understand the plan without inspecting every detail.
- The page answers “what is this?” and “what happens next?” quickly.

### Phase 3: Visual Hierarchy

1. Make the most important content easy to scan.
2. Use cards, lists, panels, and callouts to separate concepts.
3. Keep the style intentional and consistent.
4. Use rich visualizations when they explain the plan better than text.

Decision points:

- If a card is generic, replace it with a specific workflow, matrix, or summary view.
- If a label is too technical, simplify it.
- If a panel appears only to pad the layout, remove it.

Completion checks:

- The strongest idea is visually dominant.
- The page feels designed, not assembled.

### Phase 4: Inline Context and References

1. Add inline links or tooltips where they reduce ambiguity.
2. Use contextual annotations for prerequisites, locations, owners, or dependencies.
3. Keep references short and useful.

Decision points:

- If a detail can be answered by hovering, use a tooltip-style annotation.
- If a reference needs persistence, make it a link to the right page or section.
- Avoid labels like “Context:” unless the label itself adds clarity.

Completion checks:

- The reader can find where something lives and what they need beforehand.
- The page does not rely on a separate explanation to make sense.

### Phase 5: Optional Interactive Sections

1. If the plan page includes a mini demo, walkthrough, or embedded mockup, keep it clearly bounded.
2. Use realistic chronology for any interactive content.
3. Ensure the interactive section reinforces the plan rather than distracting from it.

Decision points:

- If the section needs cursor choreography or timeline states, hand that portion to [interactive-mockup-choreography](./interactive-mockup-choreography/SKILL.md).
- If interaction is simple and only needs visual emphasis, keep it within the plan workflow.

Completion checks:

- Interactive content appears intentionally and with a purpose.
- The page still reads as a plan first.

### Phase 6: Validate and Tighten

Use iterative validation after each change.

Validation loop:

1. Check structure and copy for clarity.
2. Review the page in-browser or via preview.
3. Confirm the order of sections matches the intended narrative.
4. Verify non-regression constraints.

Completion checks:

- No empty-looking sections.
- No section appears before its rationale is introduced.
- The page remains coherent when skimmed.

## Quick Test Matrix

- Order: goal -> plan -> evidence -> handoff
- Clarity: each section has one job
- References: links/tooltips resolve ambiguity
- Visuals: cards/graphs/flows explain, not decorate
- Interactions: optional and subordinate to the plan
- Timing: nothing important appears out of order

## Output Template

When done, provide:

1. What changed and why.
2. How the plan now reads top-to-bottom.
3. Which references, tooltips, or visualizations were added.
4. Which sections, if any, still need user preference.

## Common Failure Modes

- The plan reads like a dump of notes instead of a guided path.
- Visual elements appear before the rationale behind them.
- Tooltips or links are too technical to help.
- An interactive section overpowers the plan narrative.
- The page duplicates the same idea in multiple places.

## Adaptation Notes

- This skill is project-agnostic and can apply to docs, specs, roadmap pages, or prototype plan pages.
- Use the companion mockup skill for sections that need deeper animation choreography.
- Keep the underlying content and the presentation choreography separate so the structure can evolve independently.
