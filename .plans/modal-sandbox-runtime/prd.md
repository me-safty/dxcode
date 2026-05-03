# Modal Sandbox Runtime PRD

## Problem Statement

The AI Engineer currently behaves like a single engineer with one machine. Even when the product model has Tasks, Worktrees, Threads, and Work Sessions, the runtime still bottlenecks on the Operator's local environment: local dependencies, local CPU, local process contention, local auth, and local cleanup. That makes the AI Engineer useful for one active workstream, but it does not yet behave like an AI Engineering Team that can handle many independent Tasks at once.

The desired product direction is that every actionable Task can receive its own Cloud Sandbox, Cloud Worktree, Sandbox Services, and Primary Thread. For example, when a user reports an issue at `help@nextcard.com`, the Orchestrator should be able to create or link a Linear issue, create a Task, allocate a Modal-backed Cloud Sandbox with a fresh Worktree and Task-scoped Convex deployment, then start a T3 Code Thread that investigates the bug. Browser access is important to the long-term model but can be deferred.

The codebase needs a deep Sandbox module rather than more local worktree logic embedded in Task materialization. Without a stable Sandbox interface, Modal-specific lifecycle behavior, snapshot startup, service provisioning, runtime connection details, cleanup, and retry semantics will leak into the Orchestrator, execution bridge, provider runtime, and Workspace. That would make the system harder to test, harder to resume after failures, and harder for future agents to navigate.

## Solution

Build a robust Sandbox runtime module with Modal as the primary Cloud Sandbox implementation. The Sandbox module will expose a Task-shaped interface that can materialize a Task runtime: allocate a Sandbox, create or attach a Worktree, provision declared Sandbox Services, start or connect to the T3 Code runtime inside the Sandbox, and return the descriptors needed by the Orchestrator and Workspace.

The Orchestrator remains the owner of Task State, Task Status, External Links, current Primary Thread, and Work Session records. T3 Code remains the owner of Sandbox runtime state, Worktree state, Thread state, Coding Agent state, git execution, and full Thread transcripts. Modal supplies Cloud Sandbox capacity: isolated containers, filesystem snapshots for fast startup, named/tagged Sandboxes for lookup and idempotency, filesystem access for artifact capture, tunnels for future browser/dev-server access, and provider-side lifecycle controls.

The first implementation should create a new Sandbox package for provider-neutral types, lifecycle helpers, and interfaces, then implement a Modal Sandbox adapter in the T3 server runtime. Existing local Task materialization should be refactored through the same Sandbox interface so local behavior remains available for development and tests, but the product path for independent Task execution should be Modal-backed Cloud Sandboxes.

The target user experience is that an Operator or Intake Source can create an engineering Task and trust the AI Engineer to provision an isolated environment without manual setup. The Workspace should show the Task, its Sandbox state, its Primary Thread, its Worktree Branch, and its relevant External Links. When the Sandbox is ready, the Primary Thread starts the Coding Agent inside that environment and reports progress back through normal Task lifecycle events.

## User Stories

1. As an Operator, I want every active Task to be able to receive its own Cloud Sandbox, so that independent engineering workstreams do not contend for my local machine.
2. As an Operator, I want the AI Engineer to behave like an AI Engineering Team, so that many unrelated Tasks can advance at the same time.
3. As an Operator, I want Cloud Sandboxes to be Task execution capacity rather than parallel attempts for one prompt, so that the product model stays centered on delegated work.
4. As an Operator, I want a Task to keep exactly one active Worktree, so that the code workspace for the Task is easy to inspect and reason about.
5. As an Operator, I want a Cloud Worktree to live inside its Task's Cloud Sandbox, so that files, services, tests, and the Coding Agent share low-latency local access.
6. As an Operator, I want the Sandbox module to hide Modal details behind a stable interface, so that the Orchestrator does not depend on provider-specific lifecycle behavior.
7. As an Operator, I want Modal to be the primary Cloud Sandbox Provider, so that the product can use fast startup, isolation, and elastic concurrency.
8. As a Platform Engineer, I want the Sandbox interface to be Task-shaped, so that callers request "materialize this Task runtime" instead of sequencing low-level container operations.
9. As a Platform Engineer, I want the Sandbox module to be deep, so that allocation, snapshot selection, Worktree creation, service provisioning, runtime startup, and cleanup sit behind a small testable interface.
10. As a Platform Engineer, I want a local Sandbox adapter for migration and tests, so that existing local development behavior can be preserved while the Cloud Sandbox path is introduced.
11. As an Operator, I want a Task created from `help@nextcard.com` to allocate a Cloud Sandbox automatically when the report is actionable, so that support-reported bugs can start investigation without manual setup.
12. As a Teammate, I want bug reports sent to `help@nextcard.com` to become Linear-linked Tasks when appropriate, so that reported issues enter the engineering workflow.
13. As an Operator, I want each email-originated bug Task to get a Primary Thread, so that the AI Engineer has a canonical place to investigate and report progress.
14. As an Operator, I want the first Primary Thread prompt to include the bug report, relevant Linear link, Project context, and Sandbox details, so that the Coding Agent starts with the right context.
15. As an Operator, I want Task materialization to be idempotent, so that repeated webhooks, retries, or refreshes do not create duplicate Cloud Sandboxes.
16. As an Operator, I want a Cloud Sandbox to have a stable Sandbox identity, so that the Workspace and Orchestrator can reconnect to it after process restarts.
17. As an Operator, I want a Cloud Sandbox to have a human-readable name derived from the Task, so that provider-side inspection is possible.
18. As an Operator, I want Cloud Sandboxes to be tagged with Project, Task, Work Session, and environment metadata, so that operations and cleanup can find the right resources.
19. As a Platform Engineer, I want Sandbox names to be collision-safe and provider-valid, so that retries do not fail because of malformed names.
20. As a Platform Engineer, I want provider-side uniqueness to guard against duplicate active Sandboxes for the same Task, so that runtime idempotency is resilient.
21. As an Operator, I want a Project to declare its Sandbox Snapshot policy, so that Tasks can start from a prepared filesystem instead of cloning from scratch.
22. As an Operator, I want Sandbox Snapshots refreshed regularly, so that new Cloud Sandboxes start close to the Project's default branch.
23. As an Operator, I want snapshot refresh failures to be visible, so that stale or broken Project setup does not silently degrade Task startup.
24. As an Operator, I want a Cloud Sandbox to sync the latest default branch after restoring from a Snapshot, so that Tasks do not start from stale code.
25. As an Operator, I want dependency installation to happen during Snapshot creation when possible, so that Task startup is fast.
26. As an Operator, I want a Task to fall back to a slower clean setup when no usable Snapshot exists, so that work can proceed even during initial rollout.
27. As a Platform Engineer, I want Snapshot metadata to record source branch, commit, created time, setup command outcome, and artifact references, so that startup behavior is auditable.
28. As an Operator, I want each Cloud Sandbox to provision Task-scoped Sandbox Services, so that Tasks do not share mutable runtime services.
29. As an Operator, I want a Convex deployment to be a Sandbox Service, so that Tasks can debug and validate Convex behavior in isolation.
30. As an Operator, I want Sandbox Service provisioning to expose status and failure details, so that service setup problems are distinguishable from Coding Agent failures.
31. As an Operator, I want environment variables and secrets scoped to the Cloud Sandbox, so that each Task has enough access without leaking unnecessary credentials.
32. As a Platform Engineer, I want secret selection to be Project-controlled, so that a Task only receives the secrets approved for that Project.
33. As a Platform Engineer, I want Sandbox Service descriptors to include endpoints, health state, and access mode, so that the Workspace can display useful runtime information.
34. As an Operator, I want browser access represented as a deferred Sandbox Service, so that the module shape supports visual debugging later without blocking the first implementation.
35. As an Operator, I want future browser support to run inside the same Cloud Sandbox, so that the Coding Agent can inspect the app like a human would.
36. As an Operator, I want the T3 Code runtime to run inside the Cloud Sandbox, so that provider sessions, terminals, git operations, tests, and local services share one environment.
37. As an Operator, I want the Workspace to connect to the Cloud Sandbox as a T3 Code Environment, so that existing Thread and runtime UI can be reused.
38. As a Platform Engineer, I want Cloud Sandbox startup to return an Environment descriptor, so that the Workspace can list and route to it.
39. As an Operator, I want the Primary Thread to start only after the Cloud Sandbox and required Sandbox Services are ready, so that the Coding Agent does not fail on missing setup.
40. As an Operator, I want partial readiness to be explicit, so that the system can start safe investigation work while optional services are still provisioning.
41. As an Operator, I want Task Status to reflect Sandbox provisioning states, so that I can tell whether work is queued, provisioning, working, blocked, or failed.
42. As an Operator, I want Work Session lifecycle events to include Sandbox lifecycle references, so that runtime history can be audited.
43. As an Operator, I want a failed Sandbox allocation to mark the Task as Failed or Blocked with a useful reason, so that operational failures are visible.
44. As an Operator, I want a recoverable Sandbox setup failure to be retryable inside the same Task, so that transient Modal or network issues do not create duplicate Tasks.
45. As an Operator, I want a Task restart to reuse the existing Cloud Worktree when safe, so that investigation state is not lost.
46. As an Operator, I want a Task restart to create a replacement Cloud Sandbox when the old Sandbox is unhealthy, so that work can continue after runtime failure.
47. As an Operator, I want old Cloud Sandboxes to be archived or terminated after replacement, so that resource usage stays controlled.
48. As an Operator, I want Sandbox artifacts to survive teardown, so that logs, diffs, screenshots, and diagnostic outputs remain available.
49. As a Platform Engineer, I want artifact capture to be part of Sandbox archival, so that cleanup does not destroy evidence needed for review.
50. As an Operator, I want Cloud Sandbox logs streamed or summarized into Task events, so that I can understand setup and runtime failures.
51. As an Operator, I want the Primary Thread to report meaningful Sandbox milestones, so that humans do not need to inspect Modal directly.
52. As an Operator, I want Linear acknowledgements to include Workspace and Task links once materialization is accepted, so that collaborators can follow the work.
53. As an Operator, I want Linear updates to avoid noisy heartbeat messages, so that Team Apps stay readable.
54. As an Operator, I want the Cloud Sandbox to create a Task-specific Worktree Branch from the Project default branch, so that pull requests are traceable.
55. As an Operator, I want branch naming to be deterministic and safe, so that Task retries and provider constraints do not create confusing branch names.
56. As an Operator, I want git operations to run inside the Sandbox, so that the Cloud Worktree is the source of code changes.
57. As an Operator, I want Pull Request creation to use the Cloud Worktree branch, so that completed Task work can be reviewed normally.
58. As an Operator, I want pure investigation Tasks to avoid opening Pull Requests until code changes are likely, so that no-code diagnosis remains clean.
59. As an Operator, I want code-changing Tasks to create Draft Pull Requests when appropriate, so that review artifacts exist while work is ongoing.
60. As an Operator, I want the Workspace to show Sandbox Provider, status, Worktree Branch, service health, and relevant endpoints, so that I can inspect active Tasks quickly.
61. As an Operator, I want a Cloud Sandbox to expose terminals through T3 Code, so that I can manually inspect or intervene when needed.
62. As an Operator, I want manual intervention to happen inside the same Cloud Sandbox, so that human edits and Coding Agent work share one environment.
63. As an Operator, I want the Coding Agent to run tests, lint, typecheck, and project scripts inside the Cloud Sandbox, so that validation matches the Task environment.
64. As an Operator, I want required validation commands to be Project-configurable, so that different Projects can define what good completion means.
65. As a Platform Engineer, I want Sandbox command execution to record exit codes and output references, so that failures can be diagnosed without replaying commands.
66. As a Platform Engineer, I want Sandbox lifecycle state to be persisted outside the Sandbox, so that the control plane survives Sandbox termination.
67. As a Platform Engineer, I want runtime connection details to be refreshable, so that browser sessions and web clients can reconnect after local process restarts.
68. As a Platform Engineer, I want Modal object ids to be stored as provider runtime references, so that the adapter can rehydrate running Sandboxes.
69. As a Platform Engineer, I want Modal Sandboxes to use timeouts and idle timeouts, so that forgotten Tasks do not run forever.
70. As a Platform Engineer, I want idle timeout behavior to respect active commands, tunnels, and human connections, so that useful sessions are not terminated unexpectedly.
71. As an Operator, I want an active Task to keep its Cloud Sandbox alive while humans or Coding Agents are using it, so that work is not interrupted.
72. As an Operator, I want an inactive completed Task to archive and release its Cloud Sandbox, so that compute cost stays bounded.
73. As a Platform Engineer, I want cleanup jobs to find leaked Sandboxes by tags and persisted state, so that failures do not accumulate cloud resources.
74. As a Platform Engineer, I want Sandbox Provider errors normalized, so that Modal-specific failures become product-understandable failure reasons.
75. As a Platform Engineer, I want Sandbox Provider retry policies to distinguish idempotent operations from unsafe operations, so that recovery is correct.
76. As a Platform Engineer, I want the Modal adapter to avoid leaking raw provider exceptions across the Sandbox interface, so that callers handle stable errors.
77. As a Platform Engineer, I want the Sandbox module to provide fake adapters for tests, so that lifecycle and orchestration behavior can be tested without Modal.
78. As a Platform Engineer, I want Modal integration tests to be explicitly opt-in, so that normal local checks do not require cloud credentials.
79. As a Platform Engineer, I want contract schemas for Sandbox descriptors and materialization responses, so that Orchestrator and T3 Code agree on runtime shape.
80. As a Platform Engineer, I want schema-only definitions to stay in contracts, so that shared wire types do not pull runtime logic into the contracts package.
81. As a Platform Engineer, I want runtime logic to live in the Sandbox package and T3 server adapters, so that the module is testable and not scattered.
82. As a Platform Engineer, I want existing Task materialization to be refactored through the Sandbox module, so that local and Modal behavior share the same interface.
83. As an Operator, I want the first Modal-backed Task path to work end to end before browser support, so that Cloud Sandbox execution can ship incrementally.
84. As an Operator, I want the first end-to-end path to support Linear-created or Orchestrator-created Tasks, so that existing Task workflows benefit immediately.
85. As an Operator, I want email intake to be able to request the same Task materialization path, so that `help@nextcard.com` does not require a separate runtime implementation.
86. As a Teammate, I want the AI Engineer to acknowledge when a reported issue has entered a Cloud Sandbox, so that I know debugging has started.
87. As a Teammate, I want status updates to explain whether the AI Engineer is provisioning, investigating, implementing, blocked, or ready for review, so that I can follow progress without runtime knowledge.
88. As an Operator, I want Sandbox provisioning metrics, so that we can see startup latency, failure rate, snapshot age, and active Sandbox count.
89. As an Operator, I want cost-related metrics, so that Cloud Sandbox usage can be monitored before it surprises us.
90. As a Platform Engineer, I want active concurrency controls per Organization and Project, so that one noisy Intake Source cannot consume all capacity.
91. As an Operator, I want queueing to be explicit when capacity is exhausted, so that Tasks do not appear stuck.
92. As a Platform Engineer, I want Project-level configuration for Modal resources, so that heavy Projects can request different CPU, memory, timeout, and image settings.
93. As a Platform Engineer, I want Project setup scripts to run during Snapshot creation and optionally during Task startup, so that environment preparation is predictable.
94. As an Operator, I want Snapshot creation to validate Project setup, so that broken dependencies are caught before a Task needs them.
95. As an Operator, I want a Cloud Sandbox to expose enough diagnostics for an Operator to decide whether to retry, cancel, or intervene, so that failures are actionable.
96. As an Operator, I want canceled Tasks to terminate or archive their Cloud Sandbox, so that canceled work stops consuming resources.
97. As an Operator, I want completed Tasks to preserve handoff artifacts before Sandbox teardown, so that review and audit history survive.
98. As a Platform Engineer, I want Sandbox archival to be idempotent, so that repeated cleanup is safe.
99. As a Platform Engineer, I want provider capability detection, so that the UI can explain which Sandbox Services are available for a Task.
100. As an Operator, I want Local Sandboxes and Cloud Sandboxes to appear as variants of Sandbox in product language, so that humans do not have to learn two workflows.

## Implementation Decisions

- Create a Sandbox package as the deep module for provider-neutral Sandbox lifecycle logic, provider interfaces, state transition helpers, idempotency helpers, branch/name derivation, and fake adapters for tests.
- Add schema-only Sandbox contracts for Sandbox identity, provider kind, lifecycle status, Worktree descriptor, Snapshot descriptor, Sandbox Service descriptor, materialization request, materialization response, archival request, and provider error shape.
- Keep contracts schema-only. Runtime logic belongs in the Sandbox package or in server-side adapters.
- Implement Modal as the primary Cloud Sandbox Provider.
- Preserve a local Sandbox adapter for migration, local development, and deterministic tests, but do not let the product architecture remain local-first.
- Design the Sandbox interface around Task runtime materialization rather than low-level command execution.
- Make Task runtime materialization responsible for allocating a Sandbox, selecting or creating a Snapshot, creating a Worktree Branch, provisioning Sandbox Services, starting the T3 Code runtime, returning an Environment descriptor, and optionally starting the Primary Thread.
- Refactor existing Task runtime materialization through the Sandbox interface so local and Modal paths share one external behavior.
- Run a T3 Code server/runtime inside each Cloud Sandbox so provider sessions, terminal commands, git operations, project scripts, tests, and Sandbox Services share one machine.
- Treat the Cloud Sandbox as a T3 Code Environment that the Workspace can connect to using existing environment routing concepts.
- Store provider runtime references outside the Sandbox so the control plane can reconnect after process restarts.
- Use Modal Sandbox names and tags for provider-side lookup, idempotency, cleanup, and operations.
- Use Project configuration to select Sandbox Provider, Modal app/environment, resources, timeouts, Snapshot policy, setup scripts, required Sandbox Services, and allowed secrets.
- Use Sandbox Snapshots to reduce startup latency. Snapshot refresh should clone or update the Project, install dependencies, run setup/build commands, and record metadata.
- Start a Cloud Sandbox from the latest healthy Snapshot when one exists, then sync the default branch before creating the Task Worktree Branch.
- Fall back to a clean setup path when no healthy Snapshot exists.
- Model a Task-scoped Convex deployment as a Sandbox Service.
- Model browser access as a future Sandbox Service and include descriptors now, but defer functional browser/VNC implementation.
- Normalize Modal-specific failures into stable Sandbox errors.
- Make lifecycle operations idempotent wherever retries are expected.
- Persist Sandbox lifecycle milestones as Task events and Work Session updates when they matter to the Task narrative.
- Keep Team App updates meaningful and non-periodic.
- Enforce concurrency controls by Organization and Project before allocating new Cloud Sandboxes.
- Archive artifacts before terminating a Sandbox.
- Capture logs, setup command output, service status, git branch metadata, validation output, and future browser artifacts as Sandbox artifacts.
- Do not expose raw Modal concepts as human-facing Workspace language except where Operator diagnostics need provider references.
- Prefer provider-neutral Workspace labels such as Sandbox, Cloud Sandbox, Worktree, Sandbox Services, and Snapshot.
- Keep Modal credentials and Project secrets out of the browser. The Workspace should receive only descriptors and authorized connection endpoints.
- Keep merge, production deployment, and final Done under Operator authority.
- Treat email intake, Linear assignment, Slack promotion, and Workspace New Task as consumers of the same Task materialization path.
- The `help@nextcard.com` use case should use this path by creating or linking a Linear issue, creating a Task, materializing a Modal Cloud Sandbox, provisioning Convex, and starting the Primary Thread.

## Testing Decisions

- Tests should verify external behavior through the Sandbox interface, Task materialization flow, and persisted lifecycle state, not private Modal SDK call sequencing.
- Contract tests should validate Sandbox request and response schemas, descriptor defaults, lifecycle statuses, provider kinds, and error shapes.
- Sandbox package tests should cover lifecycle transitions, idempotency keys, provider-safe naming, branch derivation, Snapshot selection, retry classification, and fake adapter behavior.
- Local Sandbox adapter tests should verify that existing Worktree materialization behavior is preserved through the new interface.
- Modal adapter unit tests should use a fake Modal client and assert behavior at the adapter interface: allocation success, duplicate name handling, timeout configuration, tags, snapshot selection, service provisioning, archival, and normalized errors.
- Modal live integration tests should be opt-in and skipped by default unless explicit credentials and environment flags are present.
- Task materialization tests should verify that a Task creates one Sandbox, one Worktree, one Primary Thread, and one Work Session, and that retries do not duplicate any of them.
- Orchestrator tests should verify that Task State transitions correctly through requested, provisioning, working, blocked, failed, canceled, and archived Sandbox outcomes.
- Execution bridge tests should verify that materialization returns Sandbox and Environment descriptors and records lifecycle events back to the Orchestrator.
- Workspace tests should verify that Sandbox status, Worktree Branch, service health, and connection state are displayed from the user's perspective.
- Cleanup tests should verify that canceled, completed, failed, and leaked Sandboxes archive artifacts and release resources idempotently.
- Snapshot tests should verify stale Snapshot detection, healthy Snapshot selection, setup failure reporting, and clean setup fallback.
- Convex Sandbox Service tests should verify provisioning success, provisioning failure, environment variable delivery, and status reporting without depending on production deployments.
- Security tests should verify that secrets are selected by Project configuration and are not returned to the browser.
- Observability tests should verify that allocation latency, startup latency, Snapshot age, active Sandbox count, and failure counters are emitted.
- Existing tests around execution bridge materialization, Orchestrator Task runtime records, provider runtime ingestion, environment routing, and Workspace state are prior art.
- Required repo checks before completion are `bun fmt`, `bun lint`, and `bun typecheck`.
- Use `bun run test` for test execution when needed; do not use `bun test`.

## Out of Scope

- Racing many parallel attempts for one prompt.
- Autonomous supporting Thread creation by the Orchestrator.
- Automatic Coding Agent switching inside an existing Thread.
- Production deployment.
- Merge automation or final Done without Operator authority.
- Fully functional browser, VNC, or streamed desktop support in the first implementation.
- Full email inbox triage, spam handling, or customer support workflow beyond allowing email intake to request Task materialization.
- Modal alternatives such as EC2, Fly, Kubernetes, or Docker as first-class Cloud Sandbox Providers.
- Multi-repository child sessions.
- Cross-Organization SaaS tenancy.
- Importing arbitrary existing local T3 Code Threads into Tasks.
- Full event sourcing of the Orchestrator.
- Replacing Linear, Slack, or GitHub workflows.
- Exposing raw Modal dashboards as the primary user experience.

## Further Notes

- This PRD follows the domain language in `CONTEXT.md` and ADR-0004, where Cloud Sandboxes are Task execution capacity.
- The [Modal/Ramp reference architecture](https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal) emphasizes full development environments per sandbox, fast filesystem Snapshot startup, provider-side coordination primitives, multiple clients feeding one session, and colocated services/tools for verification.
- Modal's current [Sandbox docs](https://modal.com/docs/guide/sandbox) and [Snapshot docs](https://modal.com/docs/guide/sandbox-memory-snapshots) describe Sandboxes as isolated containers for arbitrary code, support named and tagged Sandboxes, expose filesystem APIs, support timeouts and idle timeouts, and recommend filesystem Snapshots for long-running or fast-starting environments.
- Browser access is deferred, but the Sandbox Service model should not need to be redesigned when browser support arrives.
- The main architectural risk is making the Sandbox package too shallow. The interface should absorb real lifecycle complexity and give callers leverage and locality.
