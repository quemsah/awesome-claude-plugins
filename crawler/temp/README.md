# Local crawler pilot

Run from the repository root in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\crawler\temp\run-local-crawl.ps1
```

The script builds the crawler, prompts for `GITHUB_READ_TOKEN` with hidden input, creates a fresh SQLite database, and runs `crawl --dry-run` with publication disabled. It prints a progress snapshot immediately and every five minutes. The token is held only in the process environment while crawling and is not written to disk or the log.

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
