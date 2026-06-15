# Power Consumption Investigation

## 2026-06-15 21:06 +0100 - Iteration 1: Ignore Git internal filesystem events

Baseline:

- Existing packaged T3 Code 0.0.27 was already reproducing the issue while apparently idle.
- `ps` showed sustained work in packaged child processes: server PID 31846 around 22-30% CPU with one spike to 85.7%, renderer PID 32339 around 13-14% with one spike to 40.2%, and GPU PID 31326 around 13%.
- `sample 31846 5` showed the server active in Node/libuv child process spawning paths.
- Short-process polling caught repeated Git commands (`git diff --numstat`, `git diff --cached --numstat`, `git symbolic-ref refs/remotes/origin/HEAD`, `git remote get-url origin`) from the dev server while VCS status was subscribed, and a packaged-server `git fetch --quiet --no-tags origin` for `/Users/luismiguelsousa/Sites/career-ops`.

Hypothesis:

- The VCS status filesystem watcher was reacting to repository metadata writes under `.git/`, including writes caused by the app's own remote refresh/fetch operations.
- Those internal Git writes do not represent user-visible working tree changes, but they can trigger local status refreshes and downstream Version Control panel refreshes, creating repeated Git subprocess churn while idle.

Fix:

- Added a focused `.git` root guard in `VcsStatusBroadcaster` before the watcher runs `git check-ignore` or refreshes local status.
- Added a unit test confirming `.git/FETCH_HEAD` and `.git/logs/HEAD` are ignored while normal workspace paths still pass through.

Verification:

- Dev server restarted automatically and Playwright reloaded `http://localhost:8636/`.
- Fixed dev server PID 82195 measured around 0.0-2.9% CPU over 30 seconds, usually under 1%, with `sample 82195 5` showing 4331/4352 main-thread samples blocked in `kevent` and only a handful of active stream/log/GC samples.
- Post-fix 12 second git-process polling showed the previous repeated `git diff --numstat`, `git diff --cached --numstat`, `git symbolic-ref`, and `git remote get-url` churn from the dev server disappeared. A later 18 second poll captured only expected low-frequency remote work from the fixed dev instance (`git fetch --quiet --no-tags origin`, `git config --get remote.origin.url`) plus one unrelated plugin `git ls-remote`.
- The already-running packaged app remained hot because it was still the old installed build: server PID 31846 continued to spike between 0-89%, renderer PID 32339 between 5.7-73.1%, and GPU PID 31326 around 12.5-23.0%. This validates the fix in the patched dev instance but not in the old packaged binary.

## 2026-06-15 21:16 +0100 - Iteration 2: Reduce default remote polling cadence

Baseline:

- After iteration 1, the patched dev server was mostly idle, but an 18 second process poll still caught a remote-status refresh from the dev process.
- The VCS status stream defaulted to the user setting `automaticGitFetchInterval`, whose default was 30 seconds. That meant every active VCS status subscription could run background remote Git work twice per minute while the app was otherwise idle.

Hypothesis:

- Thirty-second background remote polling is too aggressive for an overview panel, especially because local working-tree changes already arrive through the filesystem watcher and explicit branch actions fetch immediately.
- A longer default should preserve passive remote freshness while avoiding frequent idle network/Git wakeups.

Fix:

- Changed `DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL` from 30 seconds to 5 minutes.
- Updated the Version Control settings copy to make the distinction explicit: local file changes still update through the workspace watcher, while remote branch status is background-polled.

Verification:

- Restarted the dev instance and loaded it through Playwright at `http://localhost:8636/pair#token=EDJR5E9A93UC`.
- Over a 60 second post-fix CPU sample, patched dev server PID 96204 stayed at 0.0-0.6% CPU, Vite PID 96146 stayed at 0.0%, Playwright Chrome renderer PID 19598 stayed at 0.1-0.5%, and Playwright Chrome GPU PID 19496 stayed at 0.1-0.3%.
- `sample 96204 5` showed 4338/4350 main-thread samples blocked in `kevent`; only two samples were in child-process spawn paths and four in timer paths.
- An 80 second Git-process poll saw no Git subprocess from the patched dev instance. The only Git subprocess observed was `git --git-dir /Users/luismiguelsousa/Sites/career-ops/.git fetch --quiet --no-tags origin` from the old packaged app server PID 31846.
