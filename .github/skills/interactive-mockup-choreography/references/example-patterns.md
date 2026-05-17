# Interaction Patterns and Examples

Use these patterns when building animated mockups.

## Pattern: Already-Sent User Prompt

When the user message should already exist in the thread, show it immediately at the top and do not retype it in the composer.

```html
<div class="thread">
  <div class="message user">How should I test this?</div>
  <div class="message agent">Start with the highest-risk path...</div>
</div>
```

## Pattern: Late Confirmation

If a later confirmation is genuine user input, keep it as a separate composer-driven step.

```html
<div class="composer">
  <input value="Yes, generate the test plan." />
  <button>Send</button>
</div>
```

## Pattern: Direct Response First

The first agent reply should answer the question directly before adding detail.

```html
<div class="message agent">
  <strong>Test in this order:</strong>
  <ol>
    <li>High-risk path</li>
    <li>Timeout/retry path</li>
    <li>Parity path</li>
  </ol>
</div>
```

## Pattern: Visual Evidence Card

Use a flow, checklist, or graph when it explains the plan better than prose.

```html
<div class="card">
  <strong>Execution Flow</strong>
  <div class="flow">
    <span>Start</span>
    <span>Verify</span>
    <span>Record</span>
  </div>
</div>
```
