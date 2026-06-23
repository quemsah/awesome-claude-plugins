# Quality Scoring

The directory quality sort is deterministic and uses only checked-in repository fields.

## Signals

- Plugin count: rewards repositories with more cataloged plugin entries, capped so large marketplaces do not dominate.
- Claude/plugin evidence: rewards repository names and descriptions that explicitly mention Claude, plugins, skills, agents, MCP, or marketplace terms.
- Description completeness: rewards repositories with useful descriptions.
- Popularity: adds capped logarithmic star and fork signals.
- Broad-project penalty: lightly demotes broad projects with one or fewer detected plugins when the description lacks Claude/plugin evidence.

The score is intended for discovery ranking, not for security review or endorsement.

