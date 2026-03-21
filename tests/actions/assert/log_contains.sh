#!/usr/bin/env bash

set -euo pipefail

log_file="$1"
expected_marker="$2"

if ! grep -F -- "$expected_marker" "$log_file" >/dev/null 2>&1; then
  echo "Expected log marker not found: $expected_marker" >&2
  echo "--- begin log ---" >&2
  cat "$log_file" >&2
  echo "--- end log ---" >&2
  exit 1
fi

