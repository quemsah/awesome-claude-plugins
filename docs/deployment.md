# Deployment Contract

The UI is a Next.js application in `ui/`. Production deployments must use the same verification gate as CI before publishing a build.

## Environment

Required:

- `NEXT_PUBLIC_SITE_URL`: canonical production origin, for example `https://awesomeclaudeplugins.com`. This value controls metadata, structured data, robots, and sitemap URLs. The app falls back to `https://awesomeclaudeplugins.com` when unset.

Optional:

- `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION_CODE`: Google Search Console verification code.
- `ALLOWED_DEV_ORIGINS`: comma-separated origins allowed by `next dev` for local network testing. Leave unset in production.
- `ANALYZE=true`: enables bundle analyzer output for local build analysis.

## Gate

Every production deployment must pass:

1. `npm run validate:data`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`

Use `npm run verify` from `ui/` to run the full gate locally.

## Workflow

The `Deploy` GitHub Actions workflow runs the same verification gate on pushes to `main` and on manual dispatch. The final `production-ready` job is intentionally provider-neutral: hosting providers should deploy only from commits where that job succeeds.
