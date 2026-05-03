# Cloud Sandboxes are Task execution capacity

The AI Engineer should evolve into an AI Engineering Team: many independent Tasks can advance at once because each active Task can receive its own Sandbox, Worktree, Sandbox Services, and Thread. The goal is not to run many parallel attempts for the same prompt. The goal is to remove the Operator machine as the bottleneck for independent engineering workstreams.

We decided that Cloud Sandboxes are the execution-capacity primitive for this direction. A Task created from an Intake Source, such as an email to `help@nextcard.com`, can create or link a Linear issue, allocate a Cloud Sandbox, create a Cloud Worktree, provision Task-scoped Sandbox Services such as a Convex deployment, and start a T3 Code Primary Thread inside that Sandbox. Browser access is part of the Sandbox Services model but can be deferred.

This keeps the existing Task model intact while deepening the Sandbox module. The Orchestrator owns Task State and work assignment, while T3 Code owns Sandbox runtime state, Worktree state, Thread state, and Coding Agent state. The seam should be a Sandbox Provider interface, with Local Sandbox and Cloud Sandbox adapters. The Orchestrator should depend on Sandbox capability, not on Modal or any other provider directly.

This decision does not reopen ADR-0001. v1 still limits autonomous behavior to predictable Task coordination. Cloud Sandboxes increase Task execution capacity and isolation; they do not imply autonomous supporting Thread creation, Coding Agent switching, production deployment, or periodic heartbeat updates.
