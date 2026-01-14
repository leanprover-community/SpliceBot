# Split part of a PR into a separate PR

This action automates the creation of a **single‑file pull request** when a reviewer writes a PR review comment with a line starting with `splice-bot`.

The typical use case is as follows.

A reviewer comments on a diff line with something like: `splice-bot`.

The workflow then
* checks out the **base** and **head** of the PR;
* extracts *only the file on which the review comment was made*;
* creates a new branch containing only that file change;
* opens a pull request with that single-file change;
* comments back in the original PR with a link to the new PR.

***

# Features

*   ✔️ Triggered by a `splice-bot` command at the **start of a review comment line**
*   ✔️ Copies only the commented file from the PR’s head into a clean branch based on the target base branch
*   ✔️ Automatically commits the file change
*   ✔️ Opens a pull request through `peter-evans/create-pull-request`
*   ✔️ Comments back in the original PR linking to the generated PR
*   ✔️ Supports external repositories
*   ✔️ Accepts an optional `base_ref` (default: `master`)

***

# Usage

To use this workflow from another repository, create a workflow such as:

```yaml
name: Create single-file PR (Trigger on review comment)

on:
  pull_request_review_comment:
    types: [created, edited]

jobs:
  call-splice-bot:
    uses: YOUR_ORG/YOUR_REPO/.github/workflows/splice.yaml@master
    permissions:
      contents: write
      pull-requests: write
    with:
      # Optional — defaults to "master"
      base_ref: master
    secrets: inherit
```

Replace:

*   `YOUR_ORG/YOUR_REPO`
    with the repository containing this reusable workflow.

***

# Inputs

| Name       | Type   | Required | Default  | Description                                                    |
| ---------- | ------ | -------- | -------- | -------------------------------------------------------------- |
| `base_ref` | string | No       | `master` | The base branch from which the single‑file PR will be created. |

***

# Permissions

The caller workflow **must** grant the job permissions:

```yaml
permissions:
  contents: write
  pull-requests: write
```

These propagate to the reusable workflow and are required for:

*   checking out code
*   committing a file
*   creating a PR
*   commenting on the original PR

***

# How the Workflow Works (Step-by-Step)

### 1. Detect command in the review comment

The workflow looks for:

    splice-bot

at the **start of any line**, with **no leading whitespace**, using:

```js
/^splice-bot\b/im
```

If the command is not present, the workflow exits early.

***

### 2. Extract metadata

The workflow extracts PR metadata:

*   repository names (base/head)
*   PR number
*   file path from the comment (`comment.path`)
*   `base_ref` (from input)
*   SHA information

If the comment is not associated with a file (e.g., a general comment), the workflow stops.

***

### 3. Checkout source repositories

The workflow checks out:

*   the base repo/branch into `./base`
*   the head repo into `./head`

It works across forks and organizations.

***

### 4. Create a clean branch

From the base repo:

*   a branch named:

        bot/file-<SAFE_FILENAME>-from-PR<NUMBER>

    is created.

*   the file from the PR’s head repo is copied into this branch

*   the file is staged and committed (if changed)

If no changes are detected, the workflow exits.

***

### 5. Open a new pull request

The workflow uses:

    peter-evans/create-pull-request@v6

to open a PR such as:

*   **Title:**
    `chore(<filepath>): automated extraction`

*   **Body:**
    `This PR was automatically created from a review comment on PR #NN.`

***

### 6. Comment back on the original PR

If changes were made, a comment is added to the original PR:

    Split off the changes to <file> in #<new-pr-number>

***

# Example Review Comment Trigger

In a PR review, comment on a specific file line:

    splice-bot

You can add additional text below, but **the trigger must start a line**.

***

# File Structure

Your repository should contain the reusable workflow in:

    .github/workflows/splice.yaml

***

# Requirements for Private Repositories

If this workflow is used across **private repos**, ensure:

1.  The reusable workflow repo →
    **Settings → Actions → General → Access → Accessible from repositories owned by <ORG>**

2.  The caller has sufficient Actions permissions.

3.  The `uses:` reference points to a branch, tag, or SHA containing `workflow_call`.

***

# License

MIT
