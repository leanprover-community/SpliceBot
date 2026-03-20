function buildCommentBody({
  filePath,
  applyFailed,
  noChanges,
  automatedPrNumber,
  baseRef,
  sourceBranch,
  runUrl,
  tokenSource,
  branchTokenSource,
  authzOutcome,
  authzDecision,
  authzReason,
  authzDetails,
  authzTokenSource,
  forkOwner,
  forkOwnerType,
  failedStepNames,
  outcomeLines,
}) {
  let title = 'Splice bot status';
  let adviceLines = [];
  let bodyIntro = '';

  if (!filePath) {
    title = 'Could not determine target file';
    bodyIntro = 'I could not determine `event.comment.path` from the bridge artifact.';
    adviceLines = [
      'Ensure the source workflow uploaded the `workflow-data` artifact and this run was triggered from a `pull_request_review_comment` event.',
      'Check the run logs link below and re-run after posting a fresh review comment on a file line.',
    ];
  } else if (authzOutcome === 'failure' || authzDecision === 'deny') {
    title = 'Not authorized to trigger splice-bot';
    bodyIntro = authzReason
      ? authzReason
      : 'This review comment is not authorized by the configured splice-bot trigger policy.';
    adviceLines = [
      'If this should be allowed, update workflow inputs (`allow_pr_author`, `min_repo_permission`, `allowed_users`, `allowed_teams`) or adjust repository/team permissions.',
      'You can also re-run using an authorized commenter account.',
    ];
  } else if (authzDecision === 'error') {
    title = 'Authorization check failed';
    bodyIntro = authzReason
      ? authzReason
      : 'I could not complete the authorization checks for this review comment.';
    adviceLines = [
      'Verify the auth-check token has required access for collaborator/team lookups (`authz_token` preferred).',
      'Check run logs and retry once token permissions are fixed.',
    ];
  } else if (applyFailed) {
    title = 'Could not apply patch cleanly';
    bodyIntro = `I couldn't cleanly apply the changes for **${filePath}** onto the latest base branch (**${baseRef}**).`;
    adviceLines = [
      `Rebase the source branch (**${sourceBranch}**) onto **${baseRef}**, or merge **${baseRef}** into **${sourceBranch}**.`,
      'Resolve conflicts in that file, push, then trigger the bot again with a new review comment.',
    ];
  } else if (noChanges) {
    title = 'No file changes found';
    bodyIntro = `I found no diff for **${filePath}** between the PR head and merge base, so there was nothing to split into a new PR.`;
    adviceLines = [
      'Confirm the review comment is on a file that actually changed in the current PR head commit range.',
      'Push the intended file changes first, then trigger the bot again with a new review comment.',
    ];
  } else if (automatedPrNumber) {
    title = 'Split PR created';
    bodyIntro = `Split off the changes to **${filePath}** in #${automatedPrNumber}.`;
    adviceLines = [`Review and merge #${automatedPrNumber} if it looks correct.`];
  } else {
    title = 'Failed to create split PR';
    bodyIntro = filePath
      ? `I couldn't create a split PR for **${filePath}**.`
      : "I couldn't create a split PR.";
    adviceLines = [];
    if (failedStepNames.includes('Consume bridge artifact')) {
      adviceLines.push('Ensure the source workflow uploaded `workflow-data` and this workflow is consuming the correct `source_workflow`.');
    }
    if (failedStepNames.includes('Check out BASE') || failedStepNames.includes('Check out HEAD')) {
      adviceLines.push('Verify the token used by checkout can read both base/head repos and that the referenced refs/SHAs still exist.');
    }
    if (failedStepNames.includes('Stage file changes')) {
      adviceLines.push('Inspect the "Stage file changes" logs for git fetch/apply errors and retry after rebasing if needed.');
    }
    if (failedStepNames.includes('Validate create-pull-request inputs')) {
      adviceLines.push('Fix invalid `create-pull-request` inputs reported in the validation step logs (for example `push_to_fork`, `maintainer_can_modify`, fork owner lookup, author/committer format, or generated branch name).');
    }
    if (failedStepNames.includes('Create Pull Request')) {
      adviceLines.push('Check the "Create Pull Request" logs for input validation errors (for example invalid `maintainer-can-modify` values) and other action-level failures.');
      adviceLines.push('Verify fork settings and branch inputs (`push_to_fork`, branch naming, and whether the target branch already exists) are valid for this repository.');
      adviceLines.push('Also verify token permissions include `contents: write` and `pull-requests: write`; in fork mode, ensure branch token can push to the fork.');
    }
    if (adviceLines.length === 0) {
      adviceLines.push('Open the run logs and retry after fixing the reported step failure.');
    }
  }

  const failedStepsLine =
    failedStepNames.length > 0 ? `\n\nFailed step(s): ${failedStepNames.join(', ')}.` : '';
  const adviceBlock = adviceLines.map((line) => `- ${line}`).join('\n');
  const tokenDiagnostics = [
    `- token source: \`${tokenSource || 'unknown'}\``,
    `- branch token source: \`${branchTokenSource || 'unknown'}\``,
    `- authz token source: \`${authzTokenSource || 'unknown'}\``,
  ];

  if (forkOwner || forkOwnerType) {
    tokenDiagnostics.push(`- push_to_fork owner: \`${forkOwner || 'unknown'}\` (type: \`${forkOwnerType || 'unknown'}\`)`);
  }

  if (authzDetails) {
    const detailLines = authzDetails
      .split('\n')
      .filter(Boolean)
      .map((line) => `- ${line}`);
    if (detailLines.length > 0) {
      tokenDiagnostics.push(...detailLines);
    }
  }

  const tokenDiagnosticsBlock = tokenDiagnostics.join('\n');
  const stepOutcomesDetails = `<details>\n<summary>Step outcomes</summary>\n\n${outcomeLines}\n</details>`;
  const successBody = `**${title}**\n\n${bodyIntro}`;
  const failureBody = `**${title}**\n\n${bodyIntro}${failedStepsLine}\n\nAdvice:\n${adviceBlock}\n\nToken diagnostics:\n${tokenDiagnosticsBlock}\n\nRun logs: ${runUrl}\n\n${stepOutcomesDetails}`;

  return automatedPrNumber ? successBody : failureBody;
}

function buildCallbackCommentPayload(input) {
  const {
    originalPrNumber,
    reviewCommentId,
    repoFull,
    filePath,
    applyFailed,
    noChanges,
    automatedPrNumber,
    baseRef,
    headRef,
    headLabel,
    runUrl,
    tokenSource,
    branchTokenSource,
    authzOutcome,
    authzDecision,
    authzReason,
    authzDetails,
    authzTokenSource,
    forkOwner,
    forkOwnerType,
    outcomes,
  } = input;

  if (!Number.isFinite(originalPrNumber) || originalPrNumber <= 0) {
    return { skipReason: 'Missing or invalid original PR number; cannot post a callback comment.' };
  }

  const [owner, repo] = String(repoFull || '').split('/');
  if (!owner || !repo) {
    return { skipReason: `Missing repository context (${repoFull}); cannot post a callback comment.` };
  }

  const failedStepNames = outcomes
    .filter(([, outcome]) => outcome === 'failure' || outcome === 'cancelled')
    .map(([name]) => name);
  const outcomeLines = outcomes
    .filter(([, outcome]) => outcome)
    .map(([name, outcome]) => `- ${name}: \`${outcome}\``)
    .join('\n');
  const sourceBranch = headLabel || headRef;

  return {
    owner,
    repo,
    originalPrNumber,
    reviewCommentId,
    body: buildCommentBody({
      filePath,
      applyFailed,
      noChanges,
      automatedPrNumber,
      baseRef,
      sourceBranch,
      runUrl,
      tokenSource,
      branchTokenSource,
      authzOutcome,
      authzDecision,
      authzReason,
      authzDetails,
      authzTokenSource,
      forkOwner,
      forkOwnerType,
      failedStepNames,
      outcomeLines,
    }),
  };
}

module.exports = {
  buildCallbackCommentPayload,
};
