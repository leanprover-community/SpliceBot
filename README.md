# `splice-bot`: split part of a PR into a separate PR

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

# Usage

To use this workflow from another repository, create a workflow such as:

```yaml
name: splice-bot

on:
  pull_request_review_comment:
    types: [created]

jobs:
  call-splice-bot:
    uses: leanprover-community/SpliceBot/.github/workflows/splice.yaml@master
    permissions:
      contents: write
      pull-requests: write
    with:
      # optional branch to which the PR will point — defaults to "master"
      base_ref: master
    secrets: inherit
```

***

# Inputs

| Name       | Type   | Required | Default  | Description                                                    |
| ---------- | ------ | -------- | -------- | --------------------------------------------------- |
| `base_ref` | string | No       | `master` | The base branch to which the single‑file PR points. |

***

# Permissions

The caller workflow **must** grant the job permissions:

```yaml
permissions:
  contents: write
  pull-requests: write
```

These propagate to the reusable workflow and are required for:

* checking out code
* committing a file
* creating a PR
* commenting on the original PR

***

# Example

In a PR review, comment on a specific file line:
```
The changes to this file look great, let's create a separate PR for them!

splice-bot

Thanks!
```

From the perspective of the action, the only important feature is that one of the lines
**starts with `splice-bot`**.
Whether or not there is further text after that, is irrelevant.

***

# File Structure

Your repository should contain the reusable workflow in:

    .github/workflows/splice.yaml

where the `.yaml` file can be called whatever you want.

***
