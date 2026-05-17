# Handling Large or Repetitive Files

Use this when the mockup or plan file is large, repetitive, or easy to break.

## Work in Small Slices

- Find the narrowest section that controls the current behavior.
- Edit one region at a time.
- Validate after each region before widening scope.
- Avoid global formatting changes unless they are required.

## Prefer Localized Changes

- Add scenario-specific selectors instead of broad rules when possible.
- Keep orchestration code separate from content blocks.
- Do not rework unrelated sections just to reach one target state.

## When the File is Repetitive

- Search for the exact phrase or class that controls the target section.
- Reuse the same structural pattern instead of inventing a new one for each block.
- If several sections mirror each other, edit one as a template and then replicate carefully.

## Validation Strategy

- Run a syntax or type check for the touched file.
- Run a browser snapshot or preview for the edited region.
- Confirm the change did not alter nearby phases or unrelated mockups.

## Safe Editing Rule

If the file is long enough that you cannot keep the chronology in your head, break the task into phases and verify the current phase before editing the next one.
