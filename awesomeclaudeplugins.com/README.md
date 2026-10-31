# Development

The workspace uses Bun 1.4.4 for dependency management and scripts, and Node.js 24.22.2 for the application and crawler runtimes. From `awesomeclaudeplugins.com/` run:

```sh
bun install --frozen-lockfile
bun run build:ui
bun run build:crawler
```

Run workspace commands from `ui/` or `crawler/` with `bun run <script>`. For example, `bun run test:unit` in `ui/` and `bun run test` in `crawler/`. Update `bun.lock` with `bun install` when dependencies change.
