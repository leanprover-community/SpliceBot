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
    secrets:
      token: ${{ secrets.SPLICE_BOT_TOKEN }}
```

`workflow_run.workflows` must match the **exact name** of the trigger workflow.
Prefer passing explicit secrets over `secrets: inherit`.

***

# Inputs

`splice.yaml` inputs:

| Name       | Type   | Required | Default  | Description                                                    |
| ---------- | ------ | -------- | -------- | -------------------------------------------------------------- |
| `base_ref` | string | No       | `master` | The base branch to which the single-file PR points.           |
| `committer`| string | No       | bot user | Committer for the PR creation step in the privileged workflow.|
| `author`   | string | No       | PR author| Author for the PR creation step in the privileged workflow.   |

`splice_wf_run.yaml` inputs:

| Name                | Type   | Required | Default | Description                                                              |
| ------------------- | ------ | -------- | ------- | ------------------------------------------------------------------------ |
| `source_workflow`   | string | Yes      | -       | Name of the source workflow that emitted the bridge artifact.            |

Optional secret for `splice_wf_run.yaml`:

| Name    | Required | Description                                                                      |
| ------- | -------- | -------------------------------------------------------------------------------- |
| `token` | Yes if you want to trigger CI       | Token used for artifact download, checkout, and push. Defaults to `github.token`. Prefer explicitly passing a dedicated secret (for example `SPLICE_BOT_TOKEN`) rather than `secrets: inherit`. |

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
