# Daily Workflow

## Start work

```bash
t3b-doctor                              # optional: confirm environment is healthy
git -C ~/Code/t3code switch blazenetic
git -C ~/Code/t3code pull --ff-only origin blazenetic   # if the branch is pushed
t3b-desktop                             # launch the live-source desktop app
```

Or drop into a repo shell first: `t3b-shell` (prints branch + divergence, then
`cd`s into the repo).

## Make changes

- Prefer small, coherent commits — they replay cleanly during upstream rebases.
- Use short-lived branches off `blazenetic` when a change is non-trivial:

  ```bash
  git switch -c feature/my-change blazenetic
  # ...work, commit...
  git switch blazenetic
  git merge --no-ff feature/my-change
  ```

- Rely on the dev server's **hot reload** — the running `t3b-desktop` /
  `t3b-web` process reflects edits without a rebuild.
- Run fast checks while iterating:

  ```bash
  t3b-check --quick     # vp check + typecheck
  ```

## Finish work

```bash
t3b-check               # vp check + typecheck + tests
# (use t3b-check --desktop if you touched desktop behaviour)
git status
git add <files>
git commit -m "feat(blazenetic): ..."
git push origin blazenetic     # requires your GitHub auth
```

> **Where changes belong.** Keep downstream-only tooling and docs under
> `scripts/blazenetic/` and `docs/blazenetic/`. Editing upstream files raises
> rebase-conflict risk — see [CUSTOMISATION-GUIDE.md](CUSTOMISATION-GUIDE.md).

## Integrate upstream changes

```bash
t3b-sync                # fetch upstream, fast-forward main, rebase blazenetic, validate
```

It never pushes automatically; it prints the exact push commands to run after
review. Full details and recovery: [UPSTREAM-SYNC.md](UPSTREAM-SYNC.md).

## Build a stable package (separate from daily dev)

Packaging is **not** part of everyday development and is **not** needed after
source edits. When you want a distributable Linux artefact:

```bash
cd ~/Code/t3code
vp run dist:desktop:linux      # builds an AppImage (x64) under release/
```

The `t3b*` launchers already run the live tree, so for iteration you never build
this. Build it only to produce a shippable package.

## Command cheat-sheet

| Command               | What it runs                                      |
| --------------------- | ------------------------------------------------- |
| `t3b`                 | `vp run dev`                                      |
| `t3b-web`             | `vp run dev:web`                                  |
| `t3b-desktop`         | `vp run dev:desktop`                              |
| `t3b-check`           | `vp check` → `vp run typecheck` → `vp run test`   |
| `t3b-check --quick`   | `vp check` → `vp run typecheck`                   |
| `t3b-check --desktop` | default + `vp run test:desktop-smoke`             |
| `t3b-check --full`    | all checks (no release build)                     |
| `t3b-sync`            | upstream integration (rebase; `--merge` optional) |
| `t3b-doctor`          | environment diagnostics                           |
| `t3b-shell`           | repo shell                                        |
