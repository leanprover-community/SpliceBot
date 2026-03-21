#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$root_dir"

common_args=(
  --container-architecture linux/amd64
  --platform ubuntu-latest=catthehacker/ubuntu:act-latest
  --no-cache-server
)
case_filter="${ACT_CASE_FILTER:-}"
run_reusable_only="${RUN_REUSABLE_ONLY:-0}"
run_composite_only="${RUN_COMPOSITE_ONLY:-0}"
reusable_timeout_seconds="${ACT_REUSABLE_TIMEOUT_SECONDS:-180}"
composite_timeout_seconds="${ACT_COMPOSITE_TIMEOUT_SECONDS:-300}"
heartbeat_seconds="${ACT_HEARTBEAT_SECONDS:-10}"

if [ "$run_reusable_only" = "1" ] && [ "$run_composite_only" = "1" ]; then
  echo "RUN_REUSABLE_ONLY=1 and RUN_COMPOSITE_ONLY=1 cannot both be set." >&2
  exit 1
fi

reusable_events=()
while IFS= read -r event_file; do
  if [ -n "$case_filter" ] && [[ "$event_file" != *"$case_filter"* ]]; then
    continue
  fi
  reusable_events+=("$event_file")
done < <(find tests/actions/events -maxdepth 1 -type f -name '*.json' | sort)

if [ "$run_composite_only" != "1" ] && [ "${#reusable_events[@]}" -eq 0 ]; then
  if [ -n "$case_filter" ]; then
    echo "No reusable workflow smoke fixtures matched ACT_CASE_FILTER='${case_filter}'." >&2
  else
    echo "No reusable workflow smoke fixtures found under tests/actions/events" >&2
  fi
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
docker_config_dir="${tmp_dir}/docker-config"
mkdir -p "$docker_config_dir"
printf '{}\n' > "${docker_config_dir}/config.json"

run_act_with_log() {
  local case_name="$1"
  local log_file="$2"
  local timeout_seconds="$3"
  shift 3

  local start_time
  local elapsed
  local last_heartbeat=-1
  local cmd_pid
  local exit_code
  local timed_out=0

  start_time="$(date +%s)"

  echo "==> Starting: ${case_name} (timeout: ${timeout_seconds}s)"

  DOCKER_CONFIG="$docker_config_dir" DOCKER_AUTH_CONFIG='{}' "$@" > "$log_file" 2>&1 &
  cmd_pid=$!

  while kill -0 "$cmd_pid" >/dev/null 2>&1; do
    elapsed=$(( $(date +%s) - start_time ))

    if [ "$heartbeat_seconds" -gt 0 ] && [ "$elapsed" -ge "$heartbeat_seconds" ] && [ $((elapsed % heartbeat_seconds)) -eq 0 ] && [ "$elapsed" -ne "$last_heartbeat" ]; then
      echo "    still running: ${case_name} (${elapsed}s elapsed)"
      last_heartbeat="$elapsed"
    fi

    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      timed_out=1
      echo "    timed out: ${case_name} after ${elapsed}s" >&2
      kill "$cmd_pid" >/dev/null 2>&1 || true
      sleep 1
      kill -9 "$cmd_pid" >/dev/null 2>&1 || true
      break
    fi

    sleep 1
  done

  wait "$cmd_pid" 2>/dev/null || exit_code=$?
  exit_code="${exit_code:-0}"
  elapsed=$(( $(date +%s) - start_time ))

  if [ "$timed_out" = "1" ] || [ "$exit_code" -ne 0 ]; then
    if [ "$timed_out" = "1" ]; then
      echo "act command timed out; log follows:" >&2
    else
      echo "act command failed; log follows:" >&2
    fi
    echo "--- begin act log ---" >&2
    cat "$log_file" >&2
    echo "--- end act log ---" >&2
    if [ "$timed_out" = "1" ]; then
      echo "Hint: run with RUN_COMPOSITE_ONLY=1 or ACT_CASE_FILTER=... to isolate the slow case." >&2
    fi
    if grep -F "error getting credentials" "$log_file" >/dev/null 2>&1; then
      echo "Hint: this looks like a Docker credential-helper problem while pulling the act runner image." >&2
      echo "Hint: try \`docker pull catthehacker/ubuntu:act-latest\` manually, or run with a clean Docker config." >&2
    fi
    return 1
  fi

  echo "==> Completed: ${case_name} (${elapsed}s)"
}

summarize_act_failure() {
  local log_file="$1"

  if grep -F "🏁  Job " "$log_file" >/dev/null 2>&1; then
    echo "Act job summary:" >&2
    grep -F "🏁  Job " "$log_file" >&2 || true
  fi

  if grep -F "Error: Job '" "$log_file" >/dev/null 2>&1; then
    echo "Act reported failed jobs:" >&2
    grep -F "Error: Job '" "$log_file" >&2 || true
  fi

  if grep -F "  ❌  Failure - " "$log_file" >/dev/null 2>&1; then
    echo "Failing step lines:" >&2
    grep -F "  ❌  Failure - " "$log_file" >&2 || true
  fi
}

if [ "$run_composite_only" != "1" ]; then
  for event_file in "${reusable_events[@]}"; do
    expected_file="${event_file%.json}.expected"
    if [ ! -f "$expected_file" ]; then
      echo "Missing expected marker file for ${event_file}: ${expected_file}" >&2
      exit 1
    fi

    log_file="${tmp_dir}/$(basename "${event_file%.json}").log"
    act_args=(
      act
      --workflows tests/actions/workflows/splice_harness.yaml
      --eventpath "$event_file"
      "${common_args[@]}"
    )
    if [ -n "${GITHUB_TOKEN:-}" ]; then
      act_args+=(--secret GITHUB_TOKEN)
    fi
    act_args+=(pull_request_review_comment)
    run_act_with_log "reusable workflow smoke case: ${event_file}" "$log_file" "$reusable_timeout_seconds" "${act_args[@]}"

    while IFS= read -r expected_marker || [ -n "$expected_marker" ]; do
      [ -z "$expected_marker" ] && continue
      if ! tests/actions/assert/log_contains.sh "$log_file" "$expected_marker"; then
        summarize_act_failure "$log_file"
        echo "Reusable smoke case log:" >&2
        echo "--- begin act log ---" >&2
        cat "$log_file" >&2
        echo "--- end act log ---" >&2
        exit 1
      fi
    done < "$expected_file"
  done
fi

if [ "$run_reusable_only" != "1" ]; then
  composite_log_file="${tmp_dir}/splice_action_harness.log"
  act_args=(
    act
    --workflows tests/actions/workflows/splice_action_harness.yaml
    "${common_args[@]}"
  )
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    act_args+=(--secret GITHUB_TOKEN)
  fi
  act_args+=(workflow_dispatch)
  if ! run_act_with_log "composite action smoke harness" "$composite_log_file" "$composite_timeout_seconds" "${act_args[@]}"; then
    echo "Composite action harness failed. The harness runs jobs in parallel, so individual job success lines may appear even when another job failed." >&2
    summarize_act_failure "$composite_log_file"
    exit 1
  fi
fi
