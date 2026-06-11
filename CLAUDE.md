# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SpliceBot is a GitHub Actions tool (not an app — there is no package.json or build step) that creates a single-file pull request from an existing PR when a reviewer leaves a review comment with a line starting with `splice-bot`. It can also run configured keyword commands (`splice-bot <keyword> [args]`) that apply a label and/or post a comment on the generated split PR; arguments must match the command's `allowed_args` allowlist, and comment lines after the trigger line are passed along as a blockquoted `{extra_comment}` template value.

## Commands

```bash
# Node unit tests (no dependencies; uses node:test, Node 20)
node --test tests/node/*.test.js

# Single test file
node --test tests/node/token-sources.test.js

# Workflow smoke tests via act (requires act + Docker; GITHUB_TOKEN optional)
tests/actions/run_act_smoke.sh

# Useful smoke-test controls
ACT_CASE_FILTER=keyword tests/actions/run_act_smoke.sh   # filter fixtures by path substring
RUN_REUSABLE_ONLY=1 tests/actions/run_act_smoke.sh       # skip composite-action harness
RUN_COMPOSITE_ONLY=1 tests/actions/run_act_smoke.sh      # only composite-action harness
```

CI runs actionlint (`workflow_lint.yaml`) and the node unit + act smoke suites (`act_smoke.yaml`).

## Architecture

The core design is a **two-stage privilege bridge** to safely handle fork-originated review-comment events (where the token is read-only):

1. **Unprivileged stage** — `.github/workflows/splice.yaml` (reusable workflow, `permissions: {}`) runs on `pull_request_review_comment`. It checks the comment for a trigger line (`^splice-bot\b`, case-insensitive, start of line) and emits a "bridge artifact" with the comment id, commenter identity, and PR metadata via `leanprover-community/privilege-escalation-bridge/emit@v1`. It performs no writes. It also still emits parsed keyword/args/extra-text outputs, but only as legacy data for older action pins.
2. **Privileged stage** — a consumer repo's `workflow_run` workflow calls the composite action `.github/actions/splice-wf-run/action.yml`, which consumes the bridge artifact (`privilege-escalation-bridge/consume@v1`), re-fetches the trigger comment by id and parses the grammar from its current body (`lib/parse-trigger-comment.js` is the grammar's source of truth), authorizes the commenter, builds a single-file patch (3-way `git apply` of `merge-base..head` diff onto base), creates the split PR via `peter-evans/create-pull-request`, and comments back on the original PR.

The comment is re-fetched (rather than trusting the bridge's parsed keyword/args) because `pull_request_review_comment` workflows run from the PR's merge commit: open PRs can keep emitting artifacts from an old trigger-workflow pin long after the consumer repo updates it, so grammar parsing must live in the privileged stage, which always runs current code.

The action's step chain: consume bridge → fetch + parse trigger comment → authorize commenter → resolve/authorize trigger command → checkout base + head → stage patch → validate CPR inputs → create PR → apply label / post comment (keyword commands only) → comment back (`if: always()`). Each step gates on the prior steps' outcomes; soft failures (no merge-base, patch conflict, empty diff) set `APPLY_FAILED`/`NO_CHANGES` outputs rather than failing, and the comment-back step reports the result either way. A fetched comment that no longer contains a trigger line (`trigger_found == 'false'`) is a silent no-op: everything downstream skips, including comment-back.

### JavaScript layout

All JS lives in `.github/actions/splice-wf-run/lib/` and is loaded inside `actions/github-script` steps via `require(process.env.ACTION_LIB_PATH)`. There is a deliberate two-layer pattern:

- `*-step.js` — thin entry point: reads env vars set in `action.yml`, calls the logic module, writes `core` outputs and sets failure status.
- The matching plain module (e.g. `authorize-commenter.js`, `command-authorization.js`, `comment-back.js`, `token-sources.js`) — pure(ish) logic, unit-tested under `tests/node/`.

When adding logic, keep it in a plain module with a step wrapper so it stays testable with `node --test`.

### Tests

- `tests/node/*.test.js` — unit tests for the lib modules (plain Node, `node:assert/strict`).
- `tests/actions/` — `act`-based smoke tests. Event fixtures are `tests/actions/events/*.json` with a sibling `*.expected` file containing a log marker that must appear in the run output (asserted by `tests/actions/assert/log_contains.sh`). The reusable-workflow harness is `tests/actions/workflows/splice_harness.yaml`; the composite-action harness (`splice_action_harness.yaml`) uses the test-only `bridge_override_json` input to bypass artifact consumption.

To add a smoke case for the trigger workflow: drop a new event JSON + `.expected` pair in `tests/actions/events/`; the runner auto-discovers them.

## Conventions and constraints

- **Security model is fail-closed**: authorization lookup/config errors must stop execution, not fall through to allow. This applies to both top-level auth (`allow_pr_author`, `min_repo_permission`, `allowed_users`, `allowed_teams`) and per-command auth in `label_commands`.
- **Three token roles** with fallback chains: `token` (API/PR ops) → `github.token`; `authz_token` (permission/team lookups) → `token` → `github.token`; `branch_token` (fork pushes) → `token` → `github.token`. `token-sources.js` derives the effective source for diagnostics. Keep README's Token Matrix in sync when changing token behavior.
- `bridge_override_json` is an internal test-only action input; do not document or extend it as public API.
- Third-party actions are pinned to full commit SHAs with a `# vX.Y.Z` comment — keep that style when bumping or adding actions.
- Docs are split: README.md is the user-facing doc for consumers of SpliceBot (inputs reference, config recipes, troubleshooting); DEVELOPMENT.md covers repo layout and test harnesses. Update the matching doc when changing inputs, behavior, or tests.
