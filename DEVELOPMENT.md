# SpliceBot development guide

This document covers the repository layout and test harnesses for people working **on** SpliceBot itself.
For installing and configuring SpliceBot in your own repository, see the [README](README.md).

***

# File structure in this repo

Reusable workflows:

- `.github/workflows/splice.yaml` (unprivileged event parser + bridge emitter)

Actions:

- `.github/actions/splice-wf-run/action.yml` (privileged consumer + PR creator)
- `.github/actions/splice-wf-run/lib/*.js` (action logic, loaded inside `actions/github-script` steps)

Example caller workflows:

- `.github/workflows/add_splice_bot.yaml`
- `.github/workflows/add_splice_bot_wf_run.yaml`

CI workflows:

- `.github/workflows/workflow_lint.yaml` (actionlint)
- `.github/workflows/act_smoke.yaml` (node unit tests + `act` smoke suite)

Tests:

- `tests/node/` (node unit tests for the `lib/` modules)
- `tests/actions/` (`act`-based workflow and composite-action smoke tests)

## JavaScript layout

The action's logic lives in `.github/actions/splice-wf-run/lib/` and follows a two-layer pattern:

- `*-step.js` modules are thin step entry points: they read env vars set in `action.yml`, call the logic module, and write `core` outputs / failure status.
- The matching plain modules (for example `authorize-commenter.js`, `command-authorization.js`, `comment-back.js`, `token-sources.js`) hold the logic and are unit-tested under `tests/node/`.

When adding logic, keep it in a plain module with a step wrapper so it stays testable with `node --test`.

***

# Node unit tests

The unit tests use the built-in `node:test` runner and `node:assert/strict`; there are no dependencies to install (CI uses Node 20).

Run all unit tests:

```bash
node --test tests/node/*.test.js
```

Run a single test file:

```bash
node --test tests/node/token-sources.test.js
```

***

# Local `act` smoke tests

You can run the lightweight workflow smoke tests locally with [`act`](https://github.com/nektos/act).
These tests exercise the reusable trigger workflow against canned review-comment payloads and intentionally skip bridge-artifact emission via the workflow's test-only `emit_bridge_artifact` input.
The composite-action smoke harness uses the internal test-only `bridge_override_json` input.
Both inputs exist only for local/CI testing and are not part of the supported public API.

Prerequisites:

- `act` installed locally
- Docker running
- `GITHUB_TOKEN` available if the workflow under test needs it, for example:
  `export GITHUB_TOKEN="$(gh auth token)"`

Run all local `act` smoke tests:

```bash
tests/actions/run_act_smoke.sh
```

That script auto-discovers all reusable-workflow event fixtures under `tests/actions/events/` and then runs the composite-action smoke harness.
If `GITHUB_TOKEN` is set in the environment, the script passes it through to `act` as a secret.
It also supports a few useful controls for local iteration:

```bash
# Only run reusable-workflow fixtures whose path contains "keyword"
ACT_CASE_FILTER=keyword tests/actions/run_act_smoke.sh

# Skip the composite harness
RUN_REUSABLE_ONLY=1 tests/actions/run_act_smoke.sh

# Run only the composite harness
RUN_COMPOSITE_ONLY=1 tests/actions/run_act_smoke.sh

# Override per-run timeouts and heartbeat interval
ACT_REUSABLE_TIMEOUT_SECONDS=180 \
ACT_COMPOSITE_TIMEOUT_SECONDS=300 \
ACT_HEARTBEAT_SECONDS=10 \
tests/actions/run_act_smoke.sh
```

You can also run individual harnesses directly.

Example commands:

```bash
act \
  --workflows tests/actions/workflows/splice_harness.yaml \
  --eventpath tests/actions/events/pr-review-comment-basic.json \
  pull_request_review_comment
```

```bash
act \
  --workflows tests/actions/workflows/splice_harness.yaml \
  --eventpath tests/actions/events/pr-review-comment-keyword.json \
  pull_request_review_comment
```

The canned event payloads live under `tests/actions/events/`; each `*.json` fixture has a sibling `*.expected` file containing a log marker that must appear in the run output.
The CI workflow that runs the same smoke harness (plus the node unit tests) is `.github/workflows/act_smoke.yaml`.
The reusable trigger harness lives at `tests/actions/workflows/splice_harness.yaml`.

There is also a composite-action harness at `tests/actions/workflows/splice_action_harness.yaml`.
Each job feeds the action a canned `bridge_override_json` and asserts (in-workflow) that the action ends in failure, since these are all bad-input cases.
Because `outcome == failure` alone cannot tell whether a job failed at the stage its name claims or died earlier, `run_act_smoke.sh` also checks `tests/actions/workflows/splice_action_harness.expected`.
That file lists `<job-name> :: <log marker>` pairs; the runner asserts each marker appears on a log line tagged with that job (act prefixes every line with the job name), which pins each job to the stage it is meant to exercise.
Most jobs fail without network access (bad bridge data, unauthorized commenter, invalid label config); the cases whose names say they reach the split flow intentionally proceed until they fail checking out a nonexistent base repository.
