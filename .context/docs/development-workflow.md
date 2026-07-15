---
type: doc
name: development-workflow
description: Repository workflow for issue #780
category: workflow
generated: "2026-07-15"
status: filled
scaffoldVersion: "2.0.0"
---

# Development workflow

- Follow root `AGENTS.md`; keep functions small, responsibilities isolated, and commits concise.
- Work on `feat/native-turn-notifications` from a merge-updated `upstream/main`; never rebase.
- Preserve unrelated work and never edit `.repos/`.
- Read `.repos/effect-smol/LLMS.md` before adding or changing Effect code.
- Run focused tests during implementation, then `vp test`, `vp check`, and `vp run typecheck`.
- Record commands, results, and limitations in `.context/evidence/issue-780-native-desktop-notifications-validation.md`.
- Push only to `origin`; open a draft PR against `pingdotgg/t3code:main`; do not merge.
- Do not add Changesets infrastructure for this repository.
