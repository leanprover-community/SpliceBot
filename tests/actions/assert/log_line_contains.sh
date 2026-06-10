#!/usr/bin/env bash

# Assert that a single line in the log file contains BOTH needles.
# Used by the composite-action harness, where act prefixes every log line with
# the job tag (e.g. "[Splice Action Act Harness/<job-name> ]"), so pairing the
# job name with a stage-specific marker binds the assertion to a single job.

set -euo pipefail

log_file="$1"
needle_a="$2"
needle_b="$3"

if ! grep -F -- "$needle_a" "$log_file" | grep -F -- "$needle_b" >/dev/null 2>&1; then
  echo "Expected a single log line containing both markers:" >&2
  echo "  [1] $needle_a" >&2
  echo "  [2] $needle_b" >&2
  exit 1
fi
