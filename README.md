# `splice-bot`: split part of a PR into a separate PR

SpliceBot creates a **single-file pull request** from an existing PR when a reviewer requests it in a review comment.

It uses a workflow-plus-action pattern:

1. `pull_request_review_comment` workflow (`splice.yaml`) runs read-only and emits a bridge artifact.
2. `workflow_run` workflow runs with write permissions, mints any needed tokens, then calls the `splice-wf-run` action to consume the artifact, create the split PR, and comment back.

This avoids trying to push from a read-only token context on fork-originated events.

***

# Quick Start (Minimal)

Create **two** workflows in the consuming repository.

## 1) Unprivileged trigger workflow

```yaml
name: Create single-file PR (Trigger on review comment)

on:
  pull_request_review_comment:
    types: [created, edited]

# `splice.yaml` does not use the GITHUB_TOKEN
permissions: {}

jobs:
  run-reusable:
    # Fast-path filter: skip this job unless the comment mentions splice-bot.
    if: ${{ contains(github.event.comment.body, 'splice-bot') }}
    uses: leanprover-community/SpliceBot/.github/workflows/splice.yaml@master
    with:
      # Optional override; defaults to "master"
      base_ref: master
```

## 2) Privileged workflow_run workflow

```yaml
name: Create single-file PR (workflow_run)

on:
  workflow_run:
    workflows: ["Create single-file PR (Trigger on review comment)"]
    types: [completed]

permissions:
  actions: read
  contents: write
  pull-requests: write

jobs:
  run-splice-bot:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - uses: leanprover-community/SpliceBot/.github/actions/splice-wf-run@master
        with:
          source_workflow: ${{ github.event.workflow_run.name }}
          allow_pr_author: 'true'
          min_repo_permission: write
```

If you always provide `token`/`authz_token`/`branch_token` (or app credentials that mint them), you can set `permissions: {}` on this job.
If you want `splice-wf-run` to fall back to `github.token`, keep:

```yaml
permissions:
  actions: read
  contents: write
  pull-requests: write
```

If this job relies on `github.token` to create the split PR, enable the repository or organization setting that allows GitHub Actions to create pull requests.

`workflow_run.workflows` must match the **exact name** of the trigger workflow.

To trigger SpliceBot, add a PR review comment on a changed file with a line starting with `splice-bot`:

```text
Looks good for extraction.

splice-bot
```

If the workflow uses only `github.token`, same-repo operation is possible, but:

- bot-created pushes/PRs generally do not trigger downstream CI
- `push_to_fork` is not usable
- `allowed_teams` checks should use an explicit `authz_token`

***

# Common Config Recipes

For `splice-wf-run` action recipes below:

- Set caller `permissions: {}` only if explicit tokens are always provided (or minted earlier in the same job) for all operations.
- Otherwise keep caller permissions at least `actions: read`, `contents: write`, and `pull-requests: write` so `github.token` remains usable for same-repo operation if you choose to rely on it.

## PAT-based token setup

```yaml
jobs:
  run-splice-bot:
    runs-on: ubuntu-latest
    steps:
      - uses: leanprover-community/SpliceBot/.github/actions/splice-wf-run@master
        with:
          source_workflow: ${{ github.event.workflow_run.name }}
          allow_pr_author: 'true'
          min_repo_permission: write
          # allowed_users: |
          #   trusted-maintainer
          # allowed_teams: |
          #   my-org/automation-admins
          token: ${{ secrets.SPLICE_BOT_TOKEN }}
          # authz_token: ${{ secrets.SPLICE_BOT_AUTHZ_TOKEN }}
          # branch_token: ${{ secrets.SPLICE_BOT_FORK_TOKEN }}
```

## Local `act` smoke tests

You can run the lightweight workflow smoke tests locally with [`act`](https://github.com/nektos/act).
These tests exercise the reusable trigger workflow against canned review-comment payloads and intentionally skip bridge-artifact emission.
The composite-action smoke harness uses the internal test-only `bridge_override_json` input; that input exists only for local/CI testing and is not part of the supported public API.

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

The canned event payloads live under `tests/actions/events/`.
The CI workflow that runs the same smoke harness is `.github/workflows/act_smoke.yaml`.
The reusable trigger harness lives at `tests/actions/workflows/splice_harness.yaml`.
There is also a composite-action harness at `tests/actions/workflows/splice_action_harness.yaml` for deterministic non-network failure cases.

## GitHub App token minting in caller job

```yaml
jobs:
  run-splice-bot:
    runs-on: ubuntu-latest
    steps:
      - id: token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ secrets.SPLICEBOT_TESTING_APP_ID }}
          private-key: ${{ secrets.SPLICEBOT_TESTING_PRIVATE_KEY }}
          owner: your-base-owner

      - id: authz-token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ secrets.SPLICEBOT_TESTING_AUTHZ_APP_ID }}
          private-key: ${{ secrets.SPLICEBOT_TESTING_AUTHZ_PRIVATE_KEY }}
          owner: your-org-owner

      - id: branch-token
        uses: actions/create-github-app-token@v2
        with:
          app-id: ${{ secrets.SPLICEBOT_TESTING_FORK_APP_ID }}
          private-key: ${{ secrets.SPLICEBOT_TESTING_FORK_PRIVATE_KEY }}
          owner: your-fork-owner

      - uses: leanprover-community/SpliceBot/.github/actions/splice-wf-run@master
        with:
          source_workflow: ${{ github.event.workflow_run.name }}
          # push_to_fork: your-fork-owner/your-fork-repo
          token: ${{ steps.token.outputs.token }}
          authz_token: ${{ steps.authz-token.outputs.token }}
          branch_token: ${{ steps.branch-token.outputs.token }}
```

## Push branch to fork

```yaml
jobs:
  run-splice-bot:
    runs-on: ubuntu-latest
    steps:
      - uses: leanprover-community/SpliceBot/.github/actions/splice-wf-run@master
        with:
          source_workflow: ${{ github.event.workflow_run.name }}
          token: ${{ secrets.SPLICE_BOT_TOKEN }}
          push_to_fork: your-fork-owner/your-fork-repo
          branch_token: ${{ secrets.SPLICE_BOT_FORK_TOKEN }}
          # maintainer_can_modify: "true"
```

Prefer explicit `with:` inputs over implicit secret inheritance.

***

# Authorization Model

A commenter is authorized if **any** configured rule matches:

1. PR author and `allow_pr_author: true`
2. Commenter in `allowed_users`
3. Commenter meets `min_repo_permission` (`anyone`, `triage`, `write`)
4. Commenter is an active member of one of `allowed_teams`

Notes:

- `min_repo_permission: anyone` preserves open trigger behavior.
- Team checks require org-owned repositories and readable team metadata.
- Authorization checks are fail-closed: lookup/config errors stop execution.

***

# Token Matrix

| Token role | Used for | Resolution / fallback order | Required permissions (GitHub App / fine-grained PAT) | Classic PAT scopes | Install target |
| ---------- | -------- | --------------------------- | ----------------------------------------------------- | ------------------ | -------------- |
| `token` | Artifact download, checkout, PR create/update, callback comments; also branch push when it is the effective push token | `token` -> `github.token` | Baseline: `Actions: Read`, `Pull requests: Read & write`, `Contents: Read`; require `Contents: Read & write` when `token` performs branch push (non-fork mode, or fork mode when `branch_token` falls back to `token`) | `repo` (private repos), `public_repo` (public-only repos) | Base repository (and fork too if this token is used as branch fallback) |
| `authz_token` | Authorization checks (`min_repo_permission`, `allowed_teams`) | `authz_token` -> `token` -> `github.token` | Repo-permission checks: `Metadata: Read` (repo). Team checks: `Members: Read` (org). | `read:org` for org/team checks; plus `repo` for private repository collaborator checks (`public_repo` for public-only repos) | Base repo/org metadata context |
| `branch_token` | Push PR branch in `push_to_fork` mode | `branch_token` -> `token` -> `github.token` | `Contents: Read & write`; often `Workflows: Read & write` if pushed commits include `.github/workflows/*` changes | `repo` (private forks), `public_repo` (public-only forks) | Fork repository |

Additional caveats:

- If `token` resolves to `github.token`, bot-created pushes/PRs typically do not trigger downstream CI.
- If `branch_token` falls back to `token` or `github.token`, that effective token must satisfy branch push permissions too.
- `github.token` is practical only for same-repo mode. Use an explicit `branch_token` for `push_to_fork`.
- `github.token` does not expose org members/team-read capability through workflow `permissions`; use an explicit `authz_token` when `allowed_teams` is configured.
- Recommended for fork safety: install branch-write credentials only on the fork and disable Actions on that fork.

Permission mapping references:

- [Workflow `permissions` key](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#permissions)
- [Download an artifact (Actions API)](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28#download-an-artifact)
- [Get repository permissions for a user](https://docs.github.com/en/rest/repos/collaborators?apiVersion=2022-11-28#get-repository-permissions-for-a-user)
- [Get team membership for a user](https://docs.github.com/en/rest/teams/members?apiVersion=2022-11-28#get-team-membership-for-a-user)
- [Create a pull request](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#create-a-pull-request)
- [Create an issue comment (includes PR issues)](https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#create-an-issue-comment)

***

# Inputs Reference

## `splice.yaml` inputs

| Name | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `base_ref` | string | No | `master` | Base branch for the split PR. |
| `committer` | string | No | bot user | Committer identity used by privileged workflow. |
| `author` | string | No | PR author | Author identity used by privileged workflow. |

## `splice-wf-run` action inputs

| Name | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `source_workflow` | string | Yes | - | Name of the source workflow that emitted the bridge artifact. |
| `bridge_override_json` | string | No | `''` | Internal test-only override used by the local/CI `act` harness instead of consuming the bridge artifact. Do not rely on this in normal workflow usage; it is not part of the supported public API. |
| `allow_pr_author` | boolean | No | `true` | Always allow PR author to trigger. |
| `min_repo_permission` | string | No | `anyone` | Minimum permission threshold: `anyone`, `triage`, `write`. |
| `allowed_teams` | string | No | `''` | Comma/newline-separated team allowlist (`team-slug` or `org/team-slug`). |
| `allowed_users` | string | No | `''` | Comma/newline-separated GitHub login allowlist. |
| `push_to_fork` | string | No | `''` | Optional fork destination (`owner/repo`) for PR branches. |
| `maintainer_can_modify` | string | No | `''` | Optional fork-mode override (`"true"`/`"false"`). |
| `token` | string | No | `''` | Main API token for artifact download, checkout, and PR operations. Falls back to `github.token`. |
| `authz_token` | string | No | `''` | Optional auth-check token for collaborator/team authorization lookups. Falls back to `token`, then `github.token`, but `allowed_teams` should use an explicit token with org-membership read access. |
| `branch_token` | string | No | `''` | Optional branch push token for `push_to_fork` mode. Falls back to `token`, then `github.token`, but fork mode should use an explicit token with write access to the fork. |

Sensitive values should be passed through action inputs using workflow secrets when you do not want to rely on `github.token`, for example `token: ${{ secrets.SPLICE_BOT_TOKEN }}`.
Test-only internal inputs such as `bridge_override_json` are intentionally undocumented outside the local test harness context and may change without notice.

## Sensitive `splice-wf-run` action inputs

| Name | Required | Description |
| ---- | -------- | ----------- |
| `token` | No | Main API token for artifact download, checkout, and PR operations. Falls back to `github.token`. |
| `authz_token` | No | Auth-check token for collaborator/team authorization lookups. Required in practice for `allowed_teams`. |
| `branch_token` | No | Branch push token for `push_to_fork` mode. Required in practice for fork mode. |

***

# Operational Caveats

- If selected changes touch `.github/workflows/*`, the token performing the push must have workflow-write capability (`Workflows: Read & write` for app/fine-grained tokens).
- This can also be required even when the selected file is not under `.github/workflows/*` if upstream commits included in the push modify workflow files.
- `maintainer_can_modify=true` is not supported for organization-owned forks on GitHub.

References:

- [GitHub fork permissions docs](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/about-permissions-and-visibility-of-forks#about-permissions-of-forks)
- [create-pull-request fork guidance](https://github.com/peter-evans/create-pull-request/blob/main/docs/concepts-guidelines.md#push-pull-request-branches-to-a-fork)

***

# Troubleshooting

| Symptom | Likely cause | Action |
| ------- | ------------ | ------ |
| `Not authorized to trigger splice-bot` | Commenter does not match configured auth rules | Adjust auth inputs (`allow_pr_author`, `min_repo_permission`, `allowed_users`, `allowed_teams`) or use an authorized account |
| `Authorization check failed` | Token lacks read access for permission/team lookup | Provide/fix `authz_token` (or authz app credentials) with required access |
| Split PR created but CI did not run | Main `token` resolved to `github.token` | Use PAT/app token for `token` |
| `push_to_fork` failed | Branch push credential lacks fork write/workflow permissions | Provide `branch_token` (or branch app creds) with required permissions on the fork |
| `Could not apply patch cleanly` | PR branch diverged from base | Rebase/merge base into source branch and re-trigger |

***

# File structure in this repo

Reusable workflows:

- `.github/workflows/splice.yaml` (unprivileged event parser + bridge emitter)

Actions:

- `.github/actions/splice-wf-run/action.yml` (privileged consumer + PR creator)

Example caller workflows:

- `.github/workflows/add_splice_bot.yaml`
- `.github/workflows/add_splice_bot_wf_run.yaml`
