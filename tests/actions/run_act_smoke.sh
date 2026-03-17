#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$root_dir"

common_args=(
  --container-architecture linux/amd64
  --platform ubuntu-latest=catthehacker/ubuntu:act-latest
)

reusable_events=()
while IFS= read -r event_file; do
  reusable_events+=("$event_file")
done < <(find tests/actions/events -maxdepth 1 -type f -name '*.json' | sort)

if [ "${#reusable_events[@]}" -eq 0 ]; then
  echo "No reusable workflow smoke fixtures found under tests/actions/events" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

for event_file in "${reusable_events[@]}"; do
  expected_file="${event_file%.json}.expected"
  if [ ! -f "$expected_file" ]; then
    echo "Missing expected marker file for ${event_file}: ${expected_file}" >&2
    exit 1
  fi

  log_file="${tmp_dir}/$(basename "${event_file%.json}").log"
  echo "==> Running reusable workflow smoke case: ${event_file}"
  act \
    --workflows tests/actions/workflows/splice_harness.yaml \
    --eventpath "$event_file" \
    "${common_args[@]}" \
    pull_request_review_comment \
    > "$log_file" 2>&1

  while IFS= read -r expected_marker || [ -n "$expected_marker" ]; do
    [ -z "$expected_marker" ] && continue
    tests/actions/assert/log_contains.sh "$log_file" "$expected_marker"
  done < "$expected_file"
done

echo "==> Running composite action smoke harness"
act \
  --workflows tests/actions/workflows/splice_action_harness.yaml \
  "${common_args[@]}" \
  workflow_dispatch
