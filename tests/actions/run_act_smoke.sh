#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$root_dir"

common_args=(
  --container-architecture linux/amd64
  --platform ubuntu-latest=catthehacker/ubuntu:act-latest
  --no-cache-server
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
docker_config_dir="${tmp_dir}/docker-config"
mkdir -p "$docker_config_dir"
printf '{}\n' > "${docker_config_dir}/config.json"

run_act_with_log() {
  local log_file="$1"
  shift

  if ! DOCKER_CONFIG="$docker_config_dir" DOCKER_AUTH_CONFIG='{}' "$@" > "$log_file" 2>&1; then
    echo "act command failed; log follows:" >&2
    echo "--- begin act log ---" >&2
    cat "$log_file" >&2
    echo "--- end act log ---" >&2
    if grep -F "error getting credentials" "$log_file" >/dev/null 2>&1; then
      echo "Hint: this looks like a Docker credential-helper problem while pulling the act runner image." >&2
      echo "Hint: try `docker pull catthehacker/ubuntu:act-latest` manually, or run with a clean Docker config." >&2
    fi
    return 1
  fi
}

for event_file in "${reusable_events[@]}"; do
  expected_file="${event_file%.json}.expected"
  if [ ! -f "$expected_file" ]; then
    echo "Missing expected marker file for ${event_file}: ${expected_file}" >&2
    exit 1
  fi

  log_file="${tmp_dir}/$(basename "${event_file%.json}").log"
  echo "==> Running reusable workflow smoke case: ${event_file}"
  run_act_with_log "$log_file" act \
    --workflows tests/actions/workflows/splice_harness.yaml \
    --eventpath "$event_file" \
    "${common_args[@]}" \
    pull_request_review_comment

  while IFS= read -r expected_marker || [ -n "$expected_marker" ]; do
    [ -z "$expected_marker" ] && continue
    if ! tests/actions/assert/log_contains.sh "$log_file" "$expected_marker"; then
      echo "Reusable smoke case log:" >&2
      echo "--- begin act log ---" >&2
      cat "$log_file" >&2
      echo "--- end act log ---" >&2
      exit 1
    fi
  done < "$expected_file"
done

echo "==> Running composite action smoke harness"
composite_log_file="${tmp_dir}/splice_action_harness.log"
run_act_with_log "$composite_log_file" act \
  --workflows tests/actions/workflows/splice_action_harness.yaml \
  "${common_args[@]}" \
  workflow_dispatch
