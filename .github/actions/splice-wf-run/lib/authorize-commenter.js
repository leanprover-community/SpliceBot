function parseList(raw) {
  return String(raw || '')
    .split(/[\n,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function buildDetails({
  commenterLogin,
  prAuthorLogin,
  baseRepo,
  allowPrAuthor,
  minRepoPermission,
  repoPermission,
  allowedUsers,
  allowedTeams,
  matchedRules,
  authzTokenSource,
}) {
  return [
    `commenter: ${commenterLogin}`,
    `pr author: ${prAuthorLogin}`,
    `base repo: ${baseRepo}`,
    `allow_pr_author: ${allowPrAuthor}`,
    `min_repo_permission: ${minRepoPermission}`,
    `observed_repo_permission: ${repoPermission}`,
    `allowed_users: ${allowedUsers.length > 0 ? allowedUsers.join(', ') : '(none)'}`,
    `allowed_teams: ${allowedTeams.length > 0 ? allowedTeams.join(', ') : '(none)'}`,
    `matched_rules: ${matchedRules.length > 0 ? matchedRules.join(', ') : '(none)'}`,
    `authz token source: ${authzTokenSource}`,
  ].join('\n');
}

async function authorizeCommenter({
  allowPrAuthor,
  minRepoPermission,
  commenterLogin,
  prAuthorLogin,
  baseRepo,
  rawAllowedTeams,
  rawAllowedUsers,
  authzTokenSource,
  github,
  onInfo = () => {},
}) {
  const allowedTeams = parseList(rawAllowedTeams);
  const allowedUsers = parseList(rawAllowedUsers);
  const validMinPermissions = new Set(['anyone', 'triage', 'write']);

  if (!validMinPermissions.has(minRepoPermission)) {
    return {
      decision: 'error',
      reason: `Invalid min_repo_permission '${minRepoPermission}'. Expected one of: anyone, triage, write.`,
      details: [
        `commenter: ${commenterLogin || '(missing)'}`,
        `base repo: ${baseRepo || '(missing)'}`,
      ].join('\n'),
    };
  }

  if (!commenterLogin || !prAuthorLogin || !baseRepo) {
    return {
      decision: 'error',
      reason: 'Missing bridge data required for authorization.',
      details: [
        `commenter_login: ${commenterLogin || '(missing)'}`,
        `pr_author_login: ${prAuthorLogin || '(missing)'}`,
        `base_repo: ${baseRepo || '(missing)'}`,
        'Ensure splice.yaml emits comment.user.login, pull_request.user.login, and pull_request.base.repo.full_name.',
      ].join('\n'),
    };
  }

  const repoParts = baseRepo.split('/');
  const owner = repoParts[0];
  const repo = repoParts[1];
  if (!owner || !repo || repoParts.length !== 2) {
    return {
      decision: 'error',
      reason: `Invalid base repo format '${baseRepo}'. Expected owner/repo.`,
      details: `base_repo: ${baseRepo}`,
    };
  }

  const permissionRank = {
    none: 0,
    read: 1,
    triage: 2,
    write: 3,
    maintain: 4,
    admin: 5,
  };
  const minThreshold =
    minRepoPermission === 'triage'
      ? permissionRank.triage
      : minRepoPermission === 'write'
        ? permissionRank.write
        : null;
  let repoPermission = 'not-checked';
  const matchedRules = [];

  const getDetails = () =>
    buildDetails({
      commenterLogin,
      prAuthorLogin,
      baseRepo,
      allowPrAuthor,
      minRepoPermission,
      repoPermission,
      allowedUsers,
      allowedTeams,
      matchedRules,
      authzTokenSource,
    });

  if (allowPrAuthor && commenterLogin.toLowerCase() === prAuthorLogin.toLowerCase()) {
    matchedRules.push('pr-author');
  }

  if (allowedUsers.includes(commenterLogin.toLowerCase())) {
    matchedRules.push('allowed-users');
  }

  if (matchedRules.length > 0) {
    return {
      decision: 'allow',
      reason: `Authorized ${commenterLogin} via ${matchedRules.join(', ')}.`,
      details: getDetails(),
    };
  }

  if (minRepoPermission === 'anyone') {
    matchedRules.push('repo-permission>=anyone');
    return {
      decision: 'allow',
      reason: `Authorized ${commenterLogin} via ${matchedRules.join(', ')}.`,
      details: getDetails(),
    };
  }

  if (minThreshold !== null) {
    try {
      const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username: commenterLogin,
      });
      repoPermission = (data.permission || 'none').toLowerCase();
    } catch (error) {
      if (error.status === 404) {
        repoPermission = 'none';
      } else {
        return {
          decision: 'error',
          reason: `Unable to resolve collaborator permission for ${commenterLogin} on ${baseRepo}: ${error.message}`,
          details: [
            `authz token source: ${authzTokenSource}`,
            'Provide authz_token with sufficient read access if needed.',
          ].join('\n'),
        };
      }
    }

    const observedRank = permissionRank[repoPermission] ?? permissionRank.none;
    if (observedRank >= minThreshold) {
      matchedRules.push(`repo-permission>=${minRepoPermission}`);
      return {
        decision: 'allow',
        reason: `Authorized ${commenterLogin} via ${matchedRules.join(', ')}.`,
        details: getDetails(),
      };
    }
  }

  if (allowedTeams.length > 0) {
    let ownerType = 'Unknown';
    try {
      const { data: repoData } = await github.rest.repos.get({ owner, repo });
      ownerType = repoData.owner?.type || 'Unknown';
    } catch (error) {
      return {
        decision: 'error',
        reason: `Unable to resolve repository owner type for ${baseRepo}: ${error.message}`,
        details: [
          `authz token source: ${authzTokenSource}`,
          'Provide authz_token with repository read access if needed.',
        ].join('\n'),
      };
    }

    if (ownerType !== 'Organization') {
      return {
        decision: 'deny',
        reason: `allowed_teams was configured, but ${baseRepo} is not organization-owned.`,
        details: [
          `commenter: ${commenterLogin}`,
          `base repo owner type: ${ownerType}`,
          `configured teams: ${allowedTeams.join(', ')}`,
        ].join('\n'),
      };
    }

    for (const teamSpec of allowedTeams) {
      const parts = teamSpec.split('/');
      const teamOrg = parts.length === 2 ? parts[0] : owner;
      const teamSlug = parts.length === 2 ? parts[1] : teamSpec;
      if (!teamOrg || !teamSlug) {
        return {
          decision: 'error',
          reason: `Invalid team spec '${teamSpec}'. Use team-slug or org/team-slug.`,
          details: `configured teams: ${allowedTeams.join(', ')}`,
        };
      }

      try {
        const { data } = await github.rest.teams.getMembershipForUserInOrg({
          org: teamOrg,
          team_slug: teamSlug,
          username: commenterLogin,
        });
        if (data.state === 'active') {
          matchedRules.push(`team:${teamOrg}/${teamSlug}`);
          return {
            decision: 'allow',
            reason: `Authorized ${commenterLogin} via ${matchedRules.join(', ')}.`,
            details: getDetails(),
          };
        }
      } catch (error) {
        if (error.status === 404) {
          onInfo(`User ${commenterLogin} is not an active member of ${teamOrg}/${teamSlug}.`);
          continue;
        }
        return {
          decision: 'error',
          reason: `Unable to verify team membership for ${teamOrg}/${teamSlug}: ${error.message}`,
          details: [
            `authz token source: ${authzTokenSource}`,
            'Provide authz_token with organization team/membership read permissions if needed.',
          ].join('\n'),
        };
      }
    }
  }

  return {
    decision: 'deny',
    reason: `Commenter ${commenterLogin} is not authorized to trigger splice-bot.`,
    details: getDetails(),
  };
}

module.exports = {
  authorizeCommenter,
  parseList,
};
