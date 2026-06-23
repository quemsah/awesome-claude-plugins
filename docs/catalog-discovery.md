# Catalog Discovery Workflow

This project tracks GitHub repositories that appear to publish Claude Code plugins, agent skills, commands, or related integration assets.

The production discovery job currently runs outside this repository in n8n. This document defines the repository contract that the external workflow must satisfy when it updates checked-in data.

## Generated Outputs

- `ui/src/data/repos.json`: repository records used by the search page, sitemap, and README table.
- `ui/src/data/stats.json`: historical repository-count snapshots used by the stats page.
- `README.md`: top-100 repository table generated from the same catalog snapshot.

## Discovery Schedule

- The external n8n workflow runs daily.
- A dry run should be reviewed before committing large catalog changes.
- If GitHub rate limits or API errors prevent a complete run, do not publish a partial catalog.

## Required Credentials

- `GITHUB_TOKEN`: read-only token used for GitHub Search and Repository API calls.
- n8n credentials must stay in n8n or the deployment secret store.
- Do not commit tokens, exported credential payloads, `.env` files, or workflow exports containing secrets.

## Inclusion Criteria

A repository can be included when at least one strong signal is present:

- It contains `.claude-plugin/marketplace.json`.
- It contains Claude Code plugin, command, agent, MCP server, or skill assets.
- Its repository metadata explicitly references Claude Code plugins, Claude skills, MCP servers, agent skills, or compatible coding-agent plugin systems.
- It is an official or clearly maintained collection of Claude Code plugin resources.

## Exclusion Criteria

A repository should be excluded or flagged for manual review when:

- It only mentions Claude, agents, or plugins in unrelated prose.
- It is a deleted, private, inaccessible, or non-GitHub source.
- It is a low-signal fork or mirror of a canonical repository.
- It is spam, malware, credential material, or unrelated SEO content.
- It lacks enough evidence to distinguish plugin support from generic AI tooling.

## Update Review Steps

1. Run the external discovery workflow in dry-run mode.
2. Export candidate `repos.json` and `stats.json` files.
3. Compare candidate data with the current checkout:

   ```sh
   cd ui
   node scripts/catalog-update-summary.mjs --candidate /path/to/candidate-repos.json
   ```

4. Review added, removed, changed, stale, and warning counts.
5. Regenerate `README.md` from the accepted candidate data.
6. Run local app checks before opening a pull request.

## Dry-Run Expectations

The dry-run summary must include:

- Current and candidate repository counts.
- Current and candidate plugin totals.
- Added repositories.
- Removed or stale repositories.
- Changed repository records.
- Data-quality warnings such as duplicate ids, duplicate URLs, invalid GitHub URLs, negative counts, untrimmed descriptions, and null plugin counts.

## Commit Expectations

Catalog update commits should explain:

- Discovery run timestamp.
- Source query or workflow version.
- Repository count delta.
- Plugin count delta.
- Any data-quality warnings intentionally accepted for that run.
