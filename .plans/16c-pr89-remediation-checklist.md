# PR #89 Consolidated Remediation Checklist

Status: **Historical and closed**
Last reviewed: 2026-07-13

## Record

This file was the working checklist for 53 actionable review findings and six invalid/stale findings on PR #89. It is no longer an active backlog.

The original checklist tracked fixes across:

- worker and WebSocket failure isolation
- checkpoint capture, revert, and ref correctness
- event-store and projection consistency
- provider session lifecycle
- schema and typed-error cleanup
- build/runtime portability
- focused backend regression coverage

All items were either completed or closed as invalid in the PR remediation effort. Detailed thread IDs, contemporary line numbers, and verdict discussion remain available in PR #89 history; duplicating them here had become misleading as files moved.

## Current guardrails

- Background worker defects must prove the worker survives a failed item.
- Transport disconnects and malformed input must not crash the server.
- Checkpoint completion must be receipt-driven and projection-consistent.
- Persistence changes require additive migrations and repository-level tests.
- Review findings against current code must be tracked in a new issue/plan, not appended here.

## Validation for related future work

Run the focused regression with `vp test`, the relevant package scripts with `vp run test`, and the repository baseline.
