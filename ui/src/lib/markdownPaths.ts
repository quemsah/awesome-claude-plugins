/**
 * Catalogued repositories whose name ends with the markdown extension, so their HTML page
 * (`/sstklen/yes.md`) is spelled exactly the way the proxy normally spells a repository's
 * markdown representation (`/{owner}/{repo}.md`).
 *
 * This namespace is only unambiguous while the catalog does not also contain the same path without
 * the suffix (for example both `a/b` and `a/b.md`). `markdownPaths.test.ts` enforces that
 * invariant and fails CI if such a collision appears; the proxy deliberately does not invent an
 * alternate HTML URL for an unsupported collision.
 *
 * Checked in rather than read from the catalog because the proxy is its own bundle and
 * `lib/catalog.ts` validates all 40,314 records while it is imported: 1.1s and 52MB of heap,
 * duplicated per server process, to settle 24 of them. `markdownPaths.test.ts` regenerates this
 * list from the catalog so a dataset refresh that changes it fails CI.
 */
export const REPO_PAGES_ENDING_IN_MD: readonly string[] = [
  'akarelin/AGENTS.md',
  'alexeimoisseev/ocpp.md',
  'amajorai/ship.md',
  'aslobodnik/stash.md',
  'Atanu2k4/ayanokoji.md',
  'BartSoj/SKILL.md',
  'bikemeardsley/GlideGrail.md',
  'caiopizzol/brand.md',
  'evisoft/scio.md',
  'harry-da/agent.md',
  'Herklos/CLAUDEs.md',
  'human-md/human.md',
  'jordantplows/STARTUP-OS.MD',
  'jskladan/claude.md',
  'kevinbarfleur/suivre.md',
  'rosenjcb/spec.md',
  'saadshahd/moo.md',
  'schubergphilis/agents.md',
  'sho-ai-magic/slide.md',
  'sstklen/yes.md',
  'theislampill/IMPLEMENTAUDIT.md',
  'tiramisulabs/SKILL.md',
  'tpiperatgod/hi.md',
  'wevm/curl.md',
]

const repoPagePaths = new Set(REPO_PAGES_ENDING_IN_MD.map((repoPath) => repoPath.toLowerCase()))

/** Whether a path ending in `.md` is a repository page rather than a markdown representation. */
export function isRepoPageEndingInMd(repoPath: string): boolean {
  return repoPagePaths.has(repoPath.toLowerCase())
}
