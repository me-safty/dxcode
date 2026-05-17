# Timing and Synchronization Rules

Use this guidance to keep animated interactions in sync.

## Core Rules

1. One phase should own one visible change.
2. A click or send should happen before the visual state it causes.
3. A message should not appear as both typed and sent at the same time unless that is the intended effect.
4. Cursor movement, input focus, and bubble reveals should reference the same phase contract.
5. If a panel needs a trigger, add a visible trigger step before the reveal.

## Suggested Beat Structure

```text
focus -> type -> click/send -> send bubble -> agent response -> evidence/tool output -> confirmation -> artifact/panel
```

## Practical Tips

- Use scenario-specific phase overrides if global classes are too broad.
- Prefer deterministic phase changes to loosely coordinated timeouts.
- Keep text reveal and panel reveal separate when they represent different actions.
- If the first user message was already sent, do not animate it as if it were being typed again.

## Validation Checklist

- The first visible item answers the right question.
- The thread order matches the chronology contract.
- The composer is not empty-flashing before send.
- The cursor does not jump to unrelated elements.
- The panel does not appear before the triggering step.
