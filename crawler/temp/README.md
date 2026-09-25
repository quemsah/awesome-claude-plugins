# Local crawler pilot

Run from the repository root in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\crawler\temp\run-local-crawl.ps1
```

The script builds the crawler, prompts for `GITHUB_READ_TOKEN` with hidden input, reuses the database from the most recent run folder, and runs `crawl --dry-run` with publication disabled. It creates a fresh SQLite database only when no earlier local database exists. It refuses to start if that database still has a running crawl. Logs, exports, and comparison reports go into a new run folder; the reused database stays in the folder where it was first created. It prints live progress every 30 seconds, including per-minute discovery/enrichment rates and an approximate ETA. Discovery ETA uses the previous completed crawl; during enrichment it uses the net reduction in pending repositories over a rolling 10–15 minute window, then falls back to the previous-run baseline while the window warms up. The token is held only in the process environment while crawling and is not written to disk or the log.

To monitor a crawl that was started before progress reporting was added, open a second PowerShell window and run:

```powershell
.\crawler\temp\watch-local-crawl.ps1 -DatabasePath .\crawler\temp\runs\<run-folder>\catalog.sqlite
```

The watcher is read-only. Closing it does not stop the crawl.

Each run gets its own `runs/<timestamp>-<id>/` directory containing:

- `catalog.sqlite` — the local database (`*.sqlite` is ignored by Git).
- `crawl.log` — crawl summary and GitHub request/rate metrics.
- `crawl-stderr.log` — crawler errors, if any.
- `export/README.md` and `export/ui/src/data/{repos,stats}.json` — the prepared draft.
- `comparison.md`, `README.diff`, and JSON difference reports — comparison with the checked-in catalog.

This is a local draft only; it does not publish to GitHub or write into `ui/`.
