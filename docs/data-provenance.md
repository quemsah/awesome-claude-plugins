# Data Provenance

The catalog data is committed under `ui/src/data/` and is the source of truth for the app and generated README.

## Repository data

`ui/src/data/repos.json` contains repository-level metadata used for discovery, ranking, and detail pages. Fields such as `html_url`, `owner`, `repo_name`, `description`, `stargazers_count`, `forks_count`, and `subscribers_count` mirror GitHub repository metadata captured at catalog snapshot time.

`plugins_count` is the number of cataloged plugin entries associated with the repository. A missing or `null` plugin count means the repository was discovered but no normalized plugin count was available in the checked-in snapshot.

## Stats data

`ui/src/data/stats.json` contains dated catalog snapshots. The README uses the latest entry to report the update date and total indexed repository count. Snapshot dates are ISO timestamps and are interpreted as UTC.

## Reproducibility

The checked-in JSON files are sufficient to reproduce the generated README. Network access is not required for `npm run readme:generate` or `npm run readme:check`.

