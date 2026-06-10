# `splice-bot`: split part of a PR into a separate PR

SpliceBot creates a **single-file pull request** from an existing PR when a reviewer requests it in a review comment.
It can also run configured keyword commands such as applying a label when the trigger line is `splice-bot <keyword> [args]`.

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
  issues: write
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
  issues: write
  pull-requests: write
```

If this job relies on `github.token` to create the split PR, enable the repository or organization setting that allows GitHub Actions to create pull requests.

`workflow_run.workflows` must match the **exact name** of the trigger workflow.

To trigger SpliceBot, add a PR review comment on a changed file with a line starting with `splice-bot`:

```text
Looks good for extraction.

splice-bot
```

If you configure label commands, put the keyword after the trigger word:

```text
splice-bot ready
```

A command may also take arguments (the rest of the trigger line) and extra free text (the lines after the trigger line), if its configuration allows them:

```text
splice-bot maintainer merge?

Happy to merge once CI is green.
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
- If you use `label_commands`, also grant `issues: write`.

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

## Custom split PR title

The split PR title is rendered from the `pr_title` template input (default: `chore({file_path}): automated extraction`). Supported placeholders:

- `{file_path}` — full repo path of the spliced file (e.g. `Mathlib/Algebra/Group/Defs.lean`)
- `{file_name}` — file basename (e.g. `Defs.lean`)
- `{file_scope}` — file path with the extension removed and the `scope_strip_prefix` input (if set) stripped from the front (e.g. `Algebra/Group/Defs`)
- `{pr_number}` — number of the original PR

Unknown placeholders fail the run before the PR is created, so typos are reported instead of producing a wrong title.

Example matching mathlib's commit-style title convention (`<kind>(<scope>): <subject>` where the scope must not start with `Mathlib/` or end with `.lean`):

```yaml
      - uses: leanprover-community/SpliceBot/.github/actions/splice-wf-run@master
        with:
          source_workflow: ${{ github.event.workflow_run.name }}
          pr_title: 'chore({file_scope}): automated extraction from #{pr_number}'
          scope_strip_prefix: 'Mathlib/'
```

This produces titles like `chore(Algebra/Group/Defs): automated extraction from #12345`.

## Configured label commands

When a trigger line is `splice-bot <keyword> [args]`, SpliceBot checks `label_commands` in the `splice-wf-run` action before running the default split-PR flow.
If the keyword matches a configured command, it still creates the split PR and then runs the command's configured actions on the generated PR: applying a label, posting a comment, or both.

The trigger comment is parsed as:

- **keyword**: the first token after `splice-bot`
- **args**: the rest of the trigger line, available as the `{command_args}` placeholder; rejected unless the command declares `allowed_args`
- **extra comment**: all lines after the trigger line, available as the `{extra_comment}` placeholder

Each command object supports:

- `command` or `keyword`: the token immediately after `splice-bot`
- `label`: optional label name to apply to the generated split PR
- `comment`: optional comment template posted on the generated split PR after creation; supports the `{file_path}`, `{file_name}`, `{file_scope}`, and `{pr_number}` placeholders from `pr_title` templates plus `{split_pr_number}` (the generated PR's number), `{commenter}` (login of the reviewer who triggered the command), `{command_args}` (the validated trigger-line arguments), and `{extra_comment}` (the reviewer's free text after the trigger line). Newlines are preserved, so JSON `\n` escapes can build multi-line comments. Unknown placeholders are rejected as invalid configuration.
- `allowed_args`: optional allowlist of trigger-line arguments (array or comma/newline-separated string). Matching is case-insensitive with whitespace collapsed. When set, the command requires exactly one of the listed argument strings; when unset, the command accepts no arguments. Either way, unexpected arguments fail the run instead of being silently dropped.
- `min_repo_permission`: optional command-specific permission floor; one of `disabled`, `anyone`, `triage`, `write`, `maintain`, `admin` and defaults to `write`
- `allowed_users`: optional command-specific user allowlist
- `allowed_teams`: optional command-specific team allowlist
- `type`: optional command type; defaults to `add-label`, which is currently the only supported value

Each command must configure `label` and/or `comment`; commands with neither are rejected as invalid configuration.

JSON example:

```yaml
with:
  source_workflow: ${{ github.event.workflow_run.name }}
  label_commands: >-
    [
      {
        "command": "ready",
        "label": "ready-to-merge",
        "min_repo_permission": "triage",
        "allowed_teams": ["my-org/reviewers"]
      },
      {
        "command": "blocked",
        "label": "blocked",
        "min_repo_permission": "maintain",
        "allowed_users": ["release-manager"]
      },
      {
        "command": "maintainer-merge",
        "comment": "maintainer merge\n\nRequested by @{commenter} via splice-bot from #{pr_number}.",
        "min_repo_permission": "disabled",
        "allowed_teams": ["my-org/reviewers"]
      }
    ]
```

Behavior notes:

- `splice-bot` with no keyword still runs the normal split-PR flow.
- `splice-bot <keyword>` is reserved for configured command handling; it does not fall back to the unlabeled split-PR flow.
- Unknown keywords fail the run and reply back on the PR with guidance.
- Arguments not matching the command's `allowed_args` (including any arguments on a command without `allowed_args`) fail the run before authorization and reply back on the PR with the allowed values.
- `{extra_comment}` is always rendered as a markdown blockquote (`> ...`). This is a deliberate safety measure: the reviewer's free text can never start a line in the bot's comment, so it cannot impersonate line-anchored commands that downstream comment automation might act on.
- Invalid `label_commands` configuration fails the run and replies back on the PR with details.
- Label commands still require the commenter to satisfy the normal top-level authorization policy first.
- Command-level auth is also fail-closed.
- Label commands may use command-specific `allowed_users`, `allowed_teams`, and `min_repo_permission`.
- Command-specific rules are checked in addition to the normal top-level authorization rules.
- When a command matches, the configured label (if any) is applied to the generated split PR after creation, and the configured comment (if any) is posted on it.
- The label and comment are attempted independently: if applying the label fails, the configured comment is still posted (and vice versa). The callback comment reports whichever action(s) failed.
- If the label cannot be applied (for example, missing `issues: write`), the split PR still exists; the run fails and the callback comment reports `Failed to apply label`.
- If the comment cannot be posted, the split PR (and any applied label) still exists; the run fails and the callback comment reports `Failed to post comment on split PR`.
- Comments are posted by the account behind the `token` input (or `github.token`). Downstream automation triggered by such comments sees that account as the comment author, not the reviewer who ran the command — include `{commenter}` in the template when the human requester matters.

### Chaining into comment-triggered automation (e.g. mathlib's `maintainer merge`)

A comment command can hand the split PR off to existing comment-triggered automation. For example, mathlib reviewers can splice a file out of a PR and queue the result for maintainer attention in one review comment:

```text
splice-bot maintainer merge?

Happy to merge once CI is green.
```

with a command like:

```yaml
with:
  source_workflow: ${{ github.event.workflow_run.name }}
  token: ${{ secrets.SPLICE_BOT_TOKEN }}
  authz_token: ${{ secrets.SPLICE_BOT_AUTHZ_TOKEN }}
  label_commands: >-
    [
      {
        "command": "maintainer",
        "allowed_args": ["merge", "merge?", "delegate", "delegate?"],
        "comment": "maintainer {command_args}\n\n{extra_comment}\n\nRequested by @{commenter} via splice-bot from #{pr_number}.",
        "min_repo_permission": "disabled",
        "allowed_teams": ["leanprover-community/mathlib-reviewers"]
      }
    ]
```

This posts `maintainer merge?` on its own line in the bot's comment on the split PR, with the reviewer's extra text quoted below it, so mathlib's `maintainer merge` workflow picks it up and forwards the whole comment (including the quoted text) to Zulip.

Caveats when chaining like this:

- The downstream workflow authorizes the *comment author*, which is the bot account behind `token`, not the reviewer. The downstream workflow must explicitly trust comments from that bot account (mathlib already special-cases trusted bot authors in its bors workflows). SpliceBot's command-level `allowed_teams` check above is what guarantees the bot only posts the comment on behalf of an authorized reviewer.
- Match the downstream trigger's exact comment format. mathlib's `maintainer merge` parser only matches a line that is exactly `maintainer merge` (or `delegate`, with an optional `?`), so keep `maintainer {command_args}` on its own line and put attribution on a separate line. `allowed_args` pins `{command_args}` to the values the downstream parser understands.
- `{extra_comment}` arrives blockquoted, which keeps the reviewer's free text from being mistaken for a downstream command line while still reading naturally in the forwarded notification.

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
3. Commenter meets `min_repo_permission` (`disabled`, `anyone`, `triage`, `write`, `maintain`, `admin`)
4. Commenter is an active member of one of `allowed_teams`

> [!IMPORTANT]
> The rules are an **allow-list union**: any matching rule authorizes the commenter. The default `min_repo_permission` is `anyone`, which matches everyone, so on the defaults `allowed_users`/`allowed_teams` add nothing and do **not** restrict who can trigger. To actually limit triggering to your allowlists, set `min_repo_permission` to `disabled` (and set `allow_pr_author: false` if PR authors should not get an automatic pass).

Notes:

- `min_repo_permission: anyone` preserves open trigger behavior (and, being the default, means a configured `allowed_users`/`allowed_teams` allowlist does not narrow access on its own — see the note above).
- `min_repo_permission: disabled` turns off repo-permission authorization entirely, so only PR-author, user allowlist, and team allowlist rules can authorize.
- Team checks require org-owned repositories and readable team metadata.
- Authorization checks are fail-closed: lookup/config errors stop execution.
- Label commands may also enforce a stricter per-command `min_repo_permission`.

***

# Token Matrix

| Token role | Used for | Resolution / fallback order | Required permissions (GitHub App / fine-grained PAT) | Classic PAT scopes | Install target |
| ---------- | -------- | --------------------------- | ----------------------------------------------------- | ------------------ | -------------- |
| `token` | Artifact download, checkout, PR create/update, callback comments, PR labels; also branch push when it is the effective push token | `token` -> `github.token` | Baseline: `Actions: Read`, `Pull requests: Read & write`, `Contents: Read`; add `Issues: Read & write` when using `label_commands`; require `Contents: Read & write` when `token` performs branch push (non-fork mode, or fork mode when `branch_token` falls back to `token`) | `repo` (private repos), `public_repo` (public-only repos) | Base repository (and fork too if this token is used as branch fallback) |
| `authz_token` | Authorization checks (`min_repo_permission`, `allowed_teams`, command-level label auth) | `authz_token` -> `token` -> `github.token` | Repo-permission checks: `Metadata: Read` (repo) when repo-permission authorization is enabled. Team checks: `Members: Read` (org). | `read:org` for org/team checks; plus `repo` for private repository collaborator checks (`public_repo` for public-only repos) | Base repo/org metadata context |
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
| `min_repo_permission` | string | No | `anyone` | Minimum permission threshold: `disabled`, `anyone`, `triage`, `write`, `maintain`, `admin`. |
| `allowed_teams` | string | No | `''` | Comma/newline-separated team allowlist (`team-slug` or `org/team-slug`). |
| `allowed_users` | string | No | `''` | Comma/newline-separated GitHub login allowlist. |
| `label_commands` | string | No | `''` | JSON array of label-command objects (`command`/`keyword`, optional `label`, optional `comment` template, optional `allowed_args`, `min_repo_permission`, `allowed_users`, `allowed_teams`, `type`). Each command needs `label` and/or `comment`. `allowed_args` allowlists trigger-line arguments; without it a command accepts none. `min_repo_permission: disabled` means command authorization relies only on the command-level allowlists. |
| `push_to_fork` | string | No | `''` | Optional fork destination (`owner/repo`) for PR branches. |
| `maintainer_can_modify` | string | No | `''` | Optional fork-mode override (`"true"`/`"false"`). |
| `pr_title` | string | No | `chore({file_path}): automated extraction` | Title template for the split PR. Supports `{file_path}`, `{file_name}`, `{file_scope}`, and `{pr_number}` placeholders; unknown placeholders fail the run. |
| `scope_strip_prefix` | string | No | `''` | Path prefix stripped from the `{file_scope}` placeholder (for example `Mathlib/`). |
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
| `Unknown splice-bot command` | Trigger keyword did not match any configured `label_commands` entry | Remove the keyword to run the default split flow, or add the missing command to `label_commands` |
| `Invalid splice-bot command arguments` | Trigger-line text after the keyword did not match the command's `allowed_args` (or the command accepts no arguments) | Re-run with one of the allowed argument values, or add the argument to the command's `allowed_args` |
| `Invalid label command configuration` | `label_commands` could not be parsed or validated | Fix the JSON shape so it is an array of objects with `command`/`keyword` plus `label` and/or `comment` (with only supported `comment` placeholders) |
| `Not authorized to run label command` | Commenter passed the top-level auth rules but did not match the command-specific `allowed_users`, `allowed_teams`, or `min_repo_permission` rules | Adjust the command config or use an account/team with the required access |
| `Failed to apply label` | Split PR was created, but the workflow token could not add the configured label | Grant `issues: write` / equivalent token scope and verify the label name; the split PR already exists and can be labeled manually |
| `Failed to post comment on split PR` | Split PR was created, but the workflow token could not post the configured command comment | Grant `issues: write` / `pull-requests: write` token scope; the split PR already exists and the comment can be posted manually |
| `Authorization check failed` | Token lacks read access for permission/team lookup | Provide/fix `authz_token` (or authz app credentials) with required access |
| Split PR created but CI did not run | Main `token` resolved to `github.token` | Use PAT/app token for `token` |
| `push_to_fork` failed | Branch push credential lacks fork write/workflow permissions | Provide `branch_token` (or branch app creds) with required permissions on the fork |
| `Could not apply patch cleanly` | PR branch diverged from base | Rebase/merge base into source branch and re-trigger |

***

# Development

For the repository layout, node unit tests, and the local `act` smoke-test harness, see [DEVELOPMENT.md](DEVELOPMENT.md).
