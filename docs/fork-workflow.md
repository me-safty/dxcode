# Fork Workflow

This is the lightweight workflow for maintaining our fork.

## One-time setup

1. Create the fork on GitHub from `pingdotgg/t3code`.
2. Add the fork as `origin` locally:

   ```bash
   git remote add origin https://github.com/YOUR_GITHUB_NAME/t3code.git
   git push -u origin main
   ```

3. In GitHub, open the fork repository and go to **Settings > Branches**.
4. Add a branch protection rule for `main`:
   - Require a pull request before merging.
   - Require approvals. Start with `1`.
   - Require status checks to pass before merging.
   - Select the `CI / quality` check once it has run at least once.
   - Do not allow force pushes.
   - Do not allow deletions.

## Everyday change flow

Start from an up-to-date `main`:

```bash
git switch main
git pull --ff-only origin main
git fetch upstream
git merge --ff-only upstream/main
git push origin main
```

Create a feature branch:

```bash
git switch -c feature/short-description
```

Commit and push your work:

```bash
git status
git add path/to/files
git commit -m "feat: short description"
git push -u origin feature/short-description
```

Open a pull request from `feature/short-description` into `main`. Wait for CI,
review the diff, then merge with **Squash and merge**.

## Building a team DMG

Use **Actions > Team macOS DMG > Run workflow**.

- `arch=arm64` is best for Apple Silicon Macs.
- `arch=x64` is for Intel Macs.
- `publish_release=true` attaches the DMG to a GitHub prerelease.

Without Apple signing secrets, the DMG still builds, but macOS may show a
Gatekeeper warning. Add these GitHub Actions secrets when ready:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

## Syncing with upstream

Pull upstream changes regularly, especially before starting big work:

```bash
git switch main
git fetch upstream
git merge --ff-only upstream/main
git push origin main
```

If the merge is not fast-forward, stop and ask for help before forcing anything.
