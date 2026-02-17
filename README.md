# `splice-bot`: split part of a PR into a separate PR

SpliceBot creates a **single-file pull request** from an existing PR when a reviewer requests it in a review comment.

It uses a two-workflow pattern:

1. `pull_request_review_comment` workflow (`splice.yaml`) runs read-only and emits a bridge artifact.
2. `workflow_run` workflow (`splice_wf_run.yaml`) runs with write permissions, consumes the artifact, creates the split PR, and comments back.

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
  run-reusable:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    uses: leanprover-community/SpliceBot/.github/workflows/splice_wf_run.yaml@master
    with:
      source_workflow: ${{ github.event.workflow_run.name }}
      allow_pr_author: true
      min_repo_permission: write
```

If you always provide `token`/`authz_token`/`branch_token` (or app credentials that mint them), you can set `permissions: {}` on this caller.  
If the reusable workflow may fall back to `github.token`, keep:

```yaml
permissions:
  actions: read
  contents: write
  pull-requests: write
```

`workflow_run.workflows` must match the **exact name** of the trigger workflow.

To trigger SpliceBot, add a PR review comment on a changed file with a line starting with `splice-bot`:

```text
Looks good for extraction.

splice-bot
```

If the workflow uses only `github.token`, CI generally will not trigger from bot-created pushes/PRs, and `push_to_fork` is not usable.

***

# Common Config Recipes

For `splice_wf_run.yaml` recipes below:

- Set caller `permissions: {}` only if explicit tokens are always provided (or app-minted) for all operations.
- Otherwise keep caller permissions at least `actions: read`, `contents: write`, and `pull-requests: write` to allow `github.token` fallback.

## PAT-based token setup

```yaml
jobs:
  run-reusable:
    uses: leanprover-community/SpliceBot/.github/workflows/splice_wf_run.yaml@master
    with:
      source_workflow: ${{ github.event.workflow_run.name }}
      allow_pr_author: true
      min_repo_permission: write
      # allowed_users: |
      #   trusted-maintainer
      # allowed_teams: |
      #   my-org/automation-admins
    secrets:
      token: ${{ secrets.SPLICE_BOT_TOKEN }}
      # authz_token: ${{ secrets.SPLICE_BOT_AUTHZ_TOKEN }}
      # branch_token: ${{ secrets.SPLICE_BOT_FORK_TOKEN }}
```

## GitHub App token minting in reusable workflow

```yaml
jobs:
  run-reusable:
    uses: leanprover-community/SpliceBot/.github/workflows/splice_wf_run.yaml@master
    with:
      source_workflow: ${{ github.event.workflow_run.name }}
      token_app_owner: your-base-or-fork-owner
      # authz_token_app_owner: your-org-owner
      # branch_token_app_owner: your-fork-owner
      # push_to_fork: your-fork-owner/your-fork-repo
    secrets:
      token_app_id: ${{ secrets.SPLICEBOT_TESTING_APP_ID }}
      token_app_private_key: ${{ secrets.SPLICEBOT_TESTING_PRIVATE_KEY }}
      # authz_token_app_id: ${{ secrets.SPLICEBOT_TESTING_AUTHZ_APP_ID }}
      # authz_token_app_private_key: ${{ secrets.SPLICEBOT_TESTING_AUTHZ_PRIVATE_KEY }}
      # branch_token_app_id: ${{ secrets.SPLICEBOT_TESTING_FORK_APP_ID }}
      # branch_token_app_private_key: ${{ secrets.SPLICEBOT_TESTING_FORK_PRIVATE_KEY }}
```

## Push branch to fork

```yaml
jobs:
  run-reusable:
    uses: leanprover-community/SpliceBot/.github/workflows/splice_wf_run.yaml@master
    with:
      source_workflow: ${{ github.event.workflow_run.name }}
      push_to_fork: your-fork-owner/your-fork-repo
      # maintainer_can_modify: "true"
```

Prefer explicit secret passing over `secrets: inherit`.

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
| `token` | Artifact download, checkout, PR create/update, callback comments; also branch push when it is the effective push token | `secrets.token` -> app-minted `token` -> `github.token` | Baseline: `Actions: Read`, `Pull requests: Read & write`, `Contents: Read`; require `Contents: Read & write` when `token` performs branch push (non-fork mode, or fork mode when `branch_token` falls back to `token`) | `repo` (private repos), `public_repo` (public-only repos) | Base repository (and fork too if this token is used as branch fallback) |
| `authz_token` | Authorization checks (`min_repo_permission`, `allowed_teams`) | `secrets.authz_token` -> app-minted `authz_token` -> `token` -> `github.token` | Repo-permission checks: `Metadata: Read` (repo). Team checks: `Members: Read` (org). | `read:org` for org/team checks; plus `repo` for private repository collaborator checks (`public_repo` for public-only repos) | Base repo/org metadata context |
| `branch_token` | Push PR branch in `push_to_fork` mode | `secrets.branch_token` -> app-minted `branch_token` -> `token` -> `github.token` | `Contents: Read & write`; often `Workflows: Read & write` if pushed commits include `.github/workflows/*` changes | `repo` (private forks), `public_repo` (public-only forks) | Fork repository |

Additional caveats:

- If `token` resolves to `github.token`, bot-created pushes/PRs typically do not trigger downstream CI.
- If `branch_token` falls back to `token`, then `token` must satisfy branch push permissions too.
- Recommended for fork safety: install branch-write credentials only on the fork and disable Actions on that fork.

Permission mapping references:

- [Workflow `permissions` key](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#permissions)
- [Download an artifact (Actions API)](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28#download-an-artifact)
- [Get repository permissions for a user](https://docs.github.com/en/rest/repos/collaborators?apiVersion=2022-11-28#get-repository-permissions-for-a-user)
- [Get team membership for a user](https://docs.github.com/en/rest/teams/members?apiVersion=2022-11-28#get-team-membership-for-a-user)
- [Create a pull request](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#create-a-pull-request)
- [Create an issue comment (includes PR issues)](https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#create-an-issue-comment)

***

# Inputs and Secrets Reference

## `splice.yaml` inputs

| Name | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `base_ref` | string | No | `master` | Base branch for the split PR. |
| `committer` | string | No | bot user | Committer identity used by privileged workflow. |
| `author` | string | No | PR author | Author identity used by privileged workflow. |

## `splice_wf_run.yaml` inputs

| Name | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `source_workflow` | string | Yes | - | Name of the source workflow that emitted the bridge artifact. |
| `allow_pr_author` | boolean | No | `true` | Always allow PR author to trigger. |
| `min_repo_permission` | string | No | `anyone` | Minimum permission threshold: `anyone`, `triage`, `write`. |
| `allowed_teams` | string | No | `''` | Comma/newline-separated team allowlist (`team-slug` or `org/team-slug`). |
| `allowed_users` | string | No | `''` | Comma/newline-separated GitHub login allowlist. |
| `push_to_fork` | string | No | `''` | Optional fork destination (`owner/repo`) for PR branches. |
| `maintainer_can_modify` | string | No | `''` | Optional fork-mode override (`"true"`/`"false"`). |
| `token_app_owner` | string | No | `''` | Owner used when minting `token` from app credentials. |
| `authz_token_app_owner` | string | No | `''` | Owner used when minting `authz_token` from app credentials. |
| `branch_token_app_owner` | string | No | `''` | Owner used when minting `branch_token` from app credentials. |

## `splice_wf_run.yaml` secrets

| Name | Required | Description |
| ---- | -------- | ----------- |
| `token` | No | Main API token for artifact download, checkout, and PR operations. |
| `authz_token` | No | Auth-check token for collaborator/team authorization lookups. |
| `branch_token` | No | Branch push token for `push_to_fork` mode. |
| `token_app_id` | No | App ID for minting `token` if `token` is absent. |
| `token_app_private_key` | No | App private key for minting `token` if `token` is absent. |
| `authz_token_app_id` | No | App ID for minting `authz_token` if `authz_token` is absent (defaults to `token_app_id`). |
| `authz_token_app_private_key` | No | App private key for minting `authz_token` if absent (defaults to `token_app_private_key`). |
| `branch_token_app_id` | No | App ID for minting `branch_token` if `branch_token` is absent (defaults to `token_app_id`). |
| `branch_token_app_private_key` | No | App private key for minting `branch_token` if absent (defaults to `token_app_private_key`). |

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
- `.github/workflows/splice_wf_run.yaml` (privileged consumer + PR creator)

Example caller workflows:

- `.github/workflows/add_splice_bot.yaml`
- `.github/workflows/add_splice_bot_wf_run.yaml`
