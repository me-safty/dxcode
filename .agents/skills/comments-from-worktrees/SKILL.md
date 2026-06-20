---
description: Address all PR comments from worktrees that are not yet merged into main.
name: comments-from-worktrees
---

Study @CUSTOMIZED.md.

Your task is to spawn one subagent for each active worktree, and simply instruct it to use the $piz-comments skill. **You do not load this skill yourself.**

When all subagents finish, if at least one of them reported changes made, you use the $port-from-worktrees skill.
