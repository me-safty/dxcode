<!--
Downstream (Blazenetic) change template.
This is an ADDITIONAL template and does not replace any upstream default.
To use it explicitly, append ?template=downstream-change.md to the PR "compare" URL.
See docs/blazenetic/CUSTOMISATION-GUIDE.md for the conflict-risk classification.
-->

## Summary

<!-- What does this change do, and why? -->

## Downstream isolation checklist

- [ ] **Does this modify upstream code?** (Prefer additions under `scripts/blazenetic/`,
      `docs/blazenetic/`, or `packaging/`.) If yes, explain why isolation wasn't possible:
- [ ] Can the change be isolated behind configuration or an extension point?
- [ ] **Rebase-conflict risk vs upstream:** <!-- Low / Medium / High / Very high -->
      (see CUSTOMISATION-GUIDE.md)

## Validation

- [ ] `t3b-check` passed (`vp check`, `vp run typecheck`, `vp run test`)
- [ ] Desktop behaviour tested (`t3b-check --desktop` or `t3b-desktop`)
- [ ] Docs under `docs/blazenetic/` updated if behaviour or commands changed

## Notes

<!-- Anything reviewers should know: risks, follow-ups, manual steps. -->
