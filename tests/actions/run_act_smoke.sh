#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$root_dir"

common_args=(
  --container-architecture linux/amd64
  --platform ubuntu-latest=catthehacker/ubuntu:act-latest
)

mapfile -t reusable_events < <(find tests/actions/events -maxdepth 1 -type f -name '*.json' | sort)

if [ "${#reusable_events[@]}" -eq 0 ]; then
  echo "No reusable workflow smoke fixtures found under tests/actions/events" >&2
  exit 1
fi

for event_file in "${reusable_events[@]}"; do
  echo "==> Running reusable workflow smoke case: ${event_file}"
  act \
    --workflows tests/actions/workflows/splice_harness.yaml \
    --eventpath "$event_file" \
    "${common_args[@]}" \
    pull_request_review_comment
done

echo "==> Running composite action smoke harness"
act \
  --workflows tests/actions/workflows/splice_action_harness.yaml \
  "${common_args[@]}" \
  workflow_dispatch
