# `splice-bot`: split part of a PR into a separate PR

This action automates the creation of a **single-file pull request** when a reviewer writes a PR review comment with a line starting with `splice-bot`.

To support PRs from forks safely, setup is split into two workflows:

* `pull_request_review_comment` workflow (read-only): parses comment context and emits a bridge artifact.
* `workflow_run` workflow (write permissions): consumes that artifact, creates the split branch/PR, and comments back.

This avoids trying to push with a read-only `GITHUB_TOKEN` from fork-originated PR events.

***

# Typical use case

A reviewer comments on a specific diff line with something like `splice-bot`.

Then:

* Workflow A (`pull_request_review_comment`) checks whether the comment requests splice-bot, captures the PR/file metadata, and emits a bridge artifact.
* Workflow B (`workflow_run`) runs with write permissions, consumes that artifact, creates a branch containing only that file's change, opens a single-file PR, and comments back on the original PR with the new PR link.

This split is what allows the automation to work for PRs from forks without trying to push from the read-only event context.

***

# Usage

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
      # Optional: push the PR branch to a dedicated fork instead of base repo.
      # Format: owner/repo
      # push_to_fork: splice-bot-user/target-repo
      # Optional in fork mode; defaults to false when omitted.
      # maintainer_can_modify: "true"
    secrets:
      token: ${{ secrets.SPLICE_BOT_TOKEN }}
      # Optional: token used only for branch push (useful with push_to_fork).
      # branch_token: ${{ secrets.SPLICE_BOT_FORK_TOKEN }}
```

`workflow_run.workflows` must match the **exact name** of the trigger workflow.
Prefer passing explicit secrets over `secrets: inherit`.

### Example: mint GitHub App token(s) inside the reusable workflow

`jobs.<id>.uses` jobs cannot have `steps`, and GitHub may block passing generated tokens across jobs via outputs (`Skip output ... since it may contain secret`).
So this reusable workflow supports passing GitHub App credentials directly; it mints tokens in the same job where checkout and PR creation run.

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
      # Installation owner used when minting token from app credentials below.
      token_app_owner: your-base-or-fork-owner
      # Optional override when branch_token should be minted from a different owner.
      # branch_token_app_owner: your-fork-owner
      push_to_fork: your-fork-owner/your-fork-repo
    secrets:
      # Optional static token; if omitted, token_app_* below is used.
      # token: ${{ secrets.SPLICE_BOT_TOKEN }}
      token_app_id: ${{ secrets.SPLICEBOT_TESTING_APP_ID }}
      token_app_private_key: ${{ secrets.SPLICEBOT_TESTING_PRIVATE_KEY }}
      # Optional static branch token; if omitted, branch_token_app_* (or token_app_*) is used.
      # branch_token: ${{ secrets.SPLICE_BOT_FORK_TOKEN }}
      # Optional override app credentials for branch_token minting.
      # branch_token_app_id: ${{ secrets.SPLICEBOT_TESTING_FORK_APP_ID }}
      # branch_token_app_private_key: ${{ secrets.SPLICEBOT_TESTING_FORK_PRIVATE_KEY }}
```

GitHub App token permissions for the example above:

* `token` (artifact download, checkout, PR API):
  * Repository permissions: `Contents: Read`, `Pull requests: Read & write`, `Actions: Read`.
* `branch_token` (fork branch push):
  * Repository permissions: `Contents: Read & write` on the fork repo.
  * `Pull requests` permission is not required if this token is only used for branch pushes.
* If `branch_token` is omitted (or falls back to `token`), then `token` also needs `Contents: Read & write` for branch updates.
* If you use one token for both roles, it needs the union of the permissions above (`Contents: Read & write`, `Pull requests: Read & write`, `Actions: Read`).

***

# Inputs

`splice.yaml` inputs:

| Name       | Type   | Required | Default  | Description                                                    |
| ---------- | ------ | -------- | -------- | -------------------------------------------------------------- |
| `base_ref` | string | No       | `master` | The base branch to which the single-file PR points.           |
| `committer`| string | No       | bot user | Committer for the PR creation step in the privileged workflow.|
| `author`   | string | No       | PR author| Author for the PR creation step in the privileged workflow.   |

`splice_wf_run.yaml` inputs:

| Name                    | Type   | Required | Default | Description                                                                                                 |
| ----------------------- | ------ | -------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `source_workflow`       | string | Yes      | -       | Name of the source workflow that emitted the bridge artifact.                                               |
| `push_to_fork`          | string | No       | `''`    | Optional fork destination (`owner/repo`) for PR branches. When empty, branches are pushed to base repo.    |
| `maintainer_can_modify` | string | No       | `''`    | Optional fork-mode override (`"true"` or `"false"`). If omitted in fork mode, defaults to `"false"`.       |
| `token_app_owner`       | string | No       | `''`    | Optional owner used when minting `token` from GitHub App credentials.                                      |
| `branch_token_app_owner`| string | No       | `''`    | Optional owner used when minting `branch_token` from GitHub App credentials.                               |

Branch naming in `splice_wf_run.yaml`:

* Base branch template: `splice-bot/file-<sanitized-file-path>-from-PR<pr-number>`.
* Sanitization keeps only `[0-9a-zA-Z/._]` from the file path.
* The final pushed branch includes a random suffix because `create-pull-request` uses `branch-suffix: random`.

Optional secrets for `splice_wf_run.yaml`:

| Name           | Required | Description                                                                                                                                            |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `token`        | No       | Token used for artifact download, checkout, and PR API calls. Defaults to `github.token`. Use an explicit secret (e.g. `SPLICE_BOT_TOKEN`) if needed. |
| `branch_token` | No       | Token used only for branch push in fork mode. Defaults to `token` (or `github.token` if `token` is also omitted).                                   |
| `token_app_id` | No       | GitHub App ID used to mint `token` when `token` is not provided.                                                                                      |
| `token_app_private_key` | No | GitHub App private key used to mint `token` when `token` is not provided.                                                                          |
| `branch_token_app_id` | No | GitHub App ID used to mint `branch_token` when `branch_token` is not provided. Defaults to `token_app_id` when omitted.                            |
| `branch_token_app_private_key` | No | GitHub App private key used to mint `branch_token` when `branch_token` is not provided. Defaults to `token_app_private_key` when omitted. |

Token caveats:

* If `token` is `github.token`, downstream workflows may not trigger on the bot-created push/PR.
* If using `push_to_fork`, the branch push token (resolved from `branch_token` then `token`) must have write access to that fork.
* If the selected file is under `.github/workflows/`, the token that pushes the branch must have `Workflows: Read & write` (GitHub rejects workflow-file updates from apps without this permission).
* `maintainer_can_modify` is a GitHub platform capability that is commonly used with user-owned forks; set it explicitly if your repository policy requires it.
* GitHub does not allow granting push permissions to organization-owned forks, so maintainer-edit behavior differs from user-owned forks ([GitHub docs](https://docs.github.com/pull-requests/collaborating-with-pull-requests/working-with-forks/about-permissions-and-visibility-of-forks)).
* For additional behavior details and fork setup patterns, see the upstream action guidance ([peter-evans/create-pull-request: Push pull request branches to a fork](https://github.com/peter-evans/create-pull-request/blob/main/docs/concepts-guidelines.md#push-pull-request-branches-to-a-fork)).

***

# Permissions

Use the minimum permissions per workflow:

* `pull_request_review_comment` workflow: read-only permissions are enough (and `permissions: {}` is also valid here).
* `workflow_run` workflow: needs `actions: read`, `contents: write`, `pull-requests: write`.

***

# Example comment

In a PR review, comment on a specific file line:

```
The changes to this file look great, let's create a separate PR for them!

splice-bot

Thanks!
```

Only one condition matters: at least one line **starts with `splice-bot`**.

***

# File structure in this repo

Reusable workflows are:

* `.github/workflows/splice.yaml` (unprivileged event parser + bridge emitter)
* `.github/workflows/splice_wf_run.yaml` (privileged consumer + PR creator)

Example caller workflows are:

* `.github/workflows/add_splice_bot.yaml`
* `.github/workflows/add_splice_bot_wf_run.yaml`

***
