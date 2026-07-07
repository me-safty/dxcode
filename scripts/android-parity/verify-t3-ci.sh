#!/usr/bin/env bash
# Automated T3 gate (step s27) — unblocks s28 when completion_mode=automated.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "==> T3 CI gate: full check + mobile regression"

scripts/android-parity/gate.sh

echo "==> REV-007 automated perf gate"
vp test run apps/mobile/src/features/review/reviewPerfGate.test.ts

if [[ ! -f scratch/android-parity/perf-results.adoc ]]; then
  echo "perf-results.adoc missing — create in step s26" >&2
  exit 1
fi

echo "==> T3 CI gate PASS"
echo "Set loop-state.json gates.t3_complete=pass_ci to continue"