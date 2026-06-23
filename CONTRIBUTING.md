# Contributing

This repository is an automated catalog of GitHub repositories related to Claude Code plugins, commands, agents, MCP servers, and skills.

Most catalog entries are discovered automatically. Use issues to submit missing repositories, correct existing records, report false positives, or request stale entry removal.

## Valid Catalog Evidence

A repository should have at least one strong signal:

- A `.claude-plugin/marketplace.json` file.
- Claude Code plugin files, command files, agent definitions, MCP server entries, or skill assets.
- README or repository metadata that explicitly describes Claude Code plugin support.
- Clear compatibility with Claude Code plugin, command, skill, or marketplace workflows.

Weak signals are not enough by themselves. Generic mentions of Claude, agents, prompts, or AI tooling can be false positives.

## Submit A Repository

Open a "Plugin repository submission" issue and include:

- Repository URL.
- Evidence path such as `.claude-plugin/marketplace.json`, command files, agent files, or skill files.
- Marketplace manifest URL if one exists.
- Short explanation of why it belongs in the catalog.

## Correct An Entry

Open a "Catalog correction" issue when:

- The repository name, owner, description, plugin count, or URL is wrong.
- A repository was renamed or transferred.
- A marketplace manifest path changed.
- The catalog points to a non-canonical fork or mirror.

## Remove Or Flag An Entry

Open a "Stale or removal request" or "False positive report" issue when:

- The repository was deleted, archived, made private, or no longer relevant.
- The repository does not provide Claude Code plugin-related assets.
- The catalog entry points to spam, malware, credentials, or unrelated content.

## Maintainer Triage Checklist

- Confirm the repository is accessible.
- Confirm the evidence path exists.
- Check whether the repository is canonical or a fork/mirror.
- Check whether the repository is archived, renamed, deleted, or stale.
- Verify marketplace manifest shape when present.
- Record whether the change should be handled by the discovery workflow or a manual correction.
- Close the issue with the catalog update commit or the reason it was rejected.

## Local Checks

From `ui/`, run the available project checks before opening a pull request:

```sh
npm ci
npm run style
npm run build
```
