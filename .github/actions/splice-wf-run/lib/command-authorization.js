function parseJsonList(raw, fieldName) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`${fieldName} must be an array.`);
    }
    return parsed.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  } catch (error) {
    throw new Error(`Could not parse ${fieldName}: ${error.message}`);
  }
}

async function authorizeCommandActor({
  commenterLogin,
  baseRepo,
  commandName,
  labelName,
  minRepoPermission,
  rawAllowedUsersJson,
  rawAllowedTeamsJson,
  authzTokenSource,
  github,
  onInfo = () => {},
}) {
  let allowedUsers;
  let allowedTeams;
  try {
    allowedUsers = parseJsonList(rawAllowedUsersJson, 'label allowed_users');
    allowedTeams = parseJsonList(rawAllowedTeamsJson, 'label allowed_teams');
  } catch (error) {
    return {
      decision: 'error',
      reason: error.message,
      details: [
        `label command: ${commandName || '(missing)'}`,
        `label: ${labelName || '(missing)'}`,
      ].join('\n'),
    };
  }

  if (!commenterLogin || !baseRepo || !commandName || !labelName) {
    return {
      decision: 'error',
      reason: 'Missing label command authorization inputs.',
      details: [
        `commenter_login: ${commenterLogin || '(missing)'}`,
        `base_repo: ${baseRepo || '(missing)'}`,
        `label_command: ${commandName || '(missing)'}`,
        `label_name: ${labelName || '(missing)'}`,
      ].join('\n'),
    };
  }

  const [owner, repo] = baseRepo.split('/');
  if (!owner || !repo || baseRepo.split('/').length !== 2) {
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
  const thresholdByPermission = {
    disabled: null,
    anyone: null,
    triage: permissionRank.triage,
    write: permissionRank.write,
    maintain: permissionRank.maintain,
    admin: permissionRank.admin,
  };

  if (!(minRepoPermission in thresholdByPermission)) {
    return {
      decision: 'error',
      reason: `Invalid label command min_repo_permission '${minRepoPermission}'. Expected one of: disabled, anyone, triage, write, maintain, admin.`,
      details: `label command: ${commandName}`,
    };
  }

  const minThreshold = thresholdByPermission[minRepoPermission];
  let repoPermission = 'not-checked';
  const matchedRules = [];
  const buildDetails = () =>
    [
      `commenter: ${commenterLogin}`,
      `base repo: ${baseRepo}`,
      `label command: ${commandName}`,
      `label: ${labelName}`,
      `required repo permission: ${minRepoPermission}`,
      `observed_repo_permission: ${repoPermission}`,
      `allowed_users: ${allowedUsers.length > 0 ? allowedUsers.join(', ') : '(none)'}`,
      `allowed_teams: ${allowedTeams.length > 0 ? allowedTeams.join(', ') : '(none)'}`,
      `matched_rules: ${matchedRules.length > 0 ? matchedRules.join(', ') : '(none)'}`,
      `authz token source: ${authzTokenSource}`,
    ].join('\n');

  if (allowedUsers.includes(commenterLogin.toLowerCase())) {
    matchedRules.push('allowed-users');
  }

  if (matchedRules.length > 0) {
    return {
      decision: 'allow',
      reason: `Authorized label command '${commandName}' for ${commenterLogin} via ${matchedRules.join(', ')}.`,
      details: buildDetails(),
    };
  }

  if (minRepoPermission === 'anyone') {
    matchedRules.push('repo-permission>=anyone');
    return {
      decision: 'allow',
      reason: `Authorized label command '${commandName}' for ${commenterLogin} via ${matchedRules.join(', ')}.`,
      details: buildDetails(),
    };
  }

  if (minRepoPermission === 'disabled') {
    onInfo(`Repository permission authorization is disabled for label command '${commandName}'.`);
  }

  if (minRepoPermission !== 'disabled' && minThreshold !== null) {
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
        reason: `Authorized label command '${commandName}' for ${commenterLogin} via ${matchedRules.join(', ')}.`,
        details: buildDetails(),
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
        reason: `label command allowed_teams was configured, but ${baseRepo} is not organization-owned.`,
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
          reason: `Invalid label command team spec '${teamSpec}'. Use team-slug or org/team-slug.`,
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
            reason: `Authorized label command '${commandName}' for ${commenterLogin} via ${matchedRules.join(', ')}.`,
            details: buildDetails(),
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
    reason: `Commenter ${commenterLogin} is not authorized to run label command '${commandName}'.`,
    details: buildDetails(),
  };
}

module.exports = {
  authorizeCommandActor,
  parseJsonList,
};
