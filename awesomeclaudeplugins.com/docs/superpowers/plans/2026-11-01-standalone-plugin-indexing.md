# Standalone Plugin Indexing Implementation Plan — Story 37

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task; use superpowers:subagent-driven-development only if that execution method is chosen. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** включить публичные репозитории с корневым `.claude-plugin/plugin.json` без marketplace в каталог, поиск и detail UI с корректной инструкцией загрузки.

**Architecture:** сохранить существующий marketplace pipeline и добавить отдельный parser одиночного плагина с REST fallback после marketplace 404. Внутренняя нормализация даёт один элемент `plugins`, явный `manifest_kind` сохраняет происхождение и определяет пользовательские инструкции. Marketplace GraphQL batching остаётся прежним; новый dual-manifest GraphQL pipeline в эту story не входит.

**Tech Stack:** существующие TypeScript, shared JS + `.d.ts`, Zod, GitHub REST/GraphQL, SQLite `better-sqlite3`, Vitest, Next.js/React и Playwright. Новые зависимости не нужны.

**Spec:** [проработанная story и решения](../specs/2026-11-01-standalone-plugin-indexing-design.md). [Первичные источники](../../research/2026-11-01-standalone-plugin-contracts.md).

## Global Constraints

- Пути в плане относительно `awesomeclaudeplugins.com/`; исследована база `dec3e93`, SQLite schema 21.
- Плагин первой версии находится ровно в `.claude-plugin/plugin.json` на default branch; arbitrary subdirectories и manifest-less plugins вне области задачи.
- Новый parser не ослабляет marketplace parser. Обёртка каталога не является опубликованным marketplace.
- Marketplace имеет приоритет; fallback только после подтверждённого 404. Invalid JSON, 403/429, 5xx и timeout не означают отсутствия файла.
- Одна canonical GitHub repository identity — одна строка каталога. Существующие правила публикации, ids, timestamps и ограничения summary сохраняются.
- Сохраняются `MAX_PENDING_CANDIDATES_PER_RUN = 200`, существующий Repository Search cap 20 запросов и текущие rate/retry budgets. Это не новый глобальный cap Code Search.
- Не добавлять allow-list, ручные production seeds или новый поисковый сервис; не запускать production backfill и публикацию при подготовке story.
- UI и snapshot readers выпускаются раньше первых standalone production records. Старые pending drafts и recovery hashes должны восстанавливаться.

## Review Focus

1. Manifest найден во вложенной fixture-папке: discovery его пропускает, root-only репозиторий проходит — Task 4.
2. Ранее отклонённый plugin-only repo не делал новый push: новая eligibility version разрешает повторную проверку — Task 2.
3. Marketplace исчез или появился между обходами, включая rename/merge: одна строка, правильный kind и отсутствие чужого ETag — Tasks 2–3.
4. Сохранённый двухсемейный report или pending draft создан старым кодом: чтение/восстановление не ломается — Tasks 2 и 4.
5. У standalone нет marketplace, а UI/Markdown умеют строить marketplace-команды автоматически: ни одна поверхность не предлагает вымышленную установку — Task 5.

## File Map

| Ответственность | Файлы |
| --- | --- |
| Общий standalone контракт | Создать `shared/catalog-contract/src/standalonePlugin.js`, `.d.ts`; экспортировать через `src/index.js`, `src/index.d.ts`; fixtures в `shared/fixtures/standalone-plugin/v1/` |
| Crawler parser/version | Создать `crawler/src/github/standalonePlugin.ts`; тесты `standalonePluginContract.test.ts`, `standalonePluginCacheVersion.test.ts` |
| Данные и миграция | `crawler/src/storage/schema.ts`, `repositories.ts`, `rejectedCandidates.ts`; `crawler/src/output/catalogSnapshot.ts`, `validate.ts`; shared `catalog.js`, `catalog.d.ts` |
| Получение и принятие plugin manifest | `crawler/src/github/client.ts`, `crawler/src/crawl/enrich.ts` |
| Новый discovery и совместимость отчётов | `crawler/src/github/searchFamilies.ts`, `crawler/src/crawl/discover.ts`, `runCrawl.ts`, `storage/discoveryCandidates.ts`, `service/execute.ts`, `storage/inspect.ts` |
| UI manifest loading и установка | Создать `ui/src/lib/repositoryManifest.ts`, `standalonePluginInstructions.ts`; изменить `app/types/plugin.type.ts`, `components/repo/RepoPageClient.tsx`, `PluginCard.tsx`, `components/search/RepoCard.tsx`, `lib/markdown.ts`, `app/[...repo]/page.tsx` |
| Сквозные проверки | `crawler/test/integration/pipeline.test.ts`, `uiContract.test.ts`; `ui/tests/e2e/repo-detail.spec.ts`, `directory.spec.ts`, `mock-github-server.mjs`; соответствующие unit tests |

Зависимости: **1 → 2 → 3 → 4 → 6**, **1 + 2 → 5 → 6**. Это части одной поставляемой story; discovery нельзя выпускать в производство без готовых readers и установки.

## Task 1: отделить plugin manifest от marketplace manifest

**Files:** shared standalone contract/exports/fixtures из File Map; новый `crawler/src/github/standalonePlugin.ts`; тесты `crawler/src/github/standalonePluginContract.test.ts`, `ui/src/app/types/standalonePluginContract.test.ts`.

**Interfaces:**

- Produce `StandalonePluginManifest = Record<string, unknown> & { name: string }`.
- Produce `parseStandalonePlugin(value: unknown): StandalonePluginManifest`, `StandalonePluginFormatError`.
- Produce `toStandaloneCatalogManifest(manifest: StandalonePluginManifest): { manifestKind: 'standalone-plugin'; plugins: Array<StandalonePluginManifest & { source: './' }> }`.
- Crawler shim реэкспортирует контракт и задаёт `STANDALONE_PLUGIN_PARSER_VERSION = 1`. Существующий marketplace wrapper не меняется.

- [ ] **Написать failing fixture tests.** Минимальный `{name:'reviewer'}` принимается без `owner`, `source`, `plugins`, `version`, `author` и явно перечисленных components. `{name:'Review Tools'}` принимается без изменения регистра и пробелов: kebab-case — рекомендация, не обязательный schema gate. `null`, массив, `{}`, пустое/пробельное имя, non-string, имя длиннее 160 символов, управляющие символы и некорректный Unicode отклоняются. Последние три ограничения — существующая bounded-display политика каталога, не требования Anthropic.
- [ ] **Проверить нормализацию и изоляцию.** `toStandaloneCatalogManifest(parseStandalonePlugin({name:'reviewer',source:'https://untrusted.example'})).plugins` содержит ровно один элемент с `name:'reviewer'`, `source:'./'`; метаданные не могут заменить синтетический source. `parseMarketplace({name:'reviewer'})` по-прежнему бросает `MarketplaceFormatError`.
- [ ] **Запустить тесты до реализации.** Из `crawler/`: `bunx vitest run src/github/standalonePluginContract.test.ts src/github/marketplaceContract.test.ts`. Новый suite должен упасть из-за отсутствующего standalone export, старый marketplace suite — остаться зелёным.
- [ ] **Реализовать parser и fixtures.** Валидировать корневой объект и обязательную identity; неизвестные поля переносить как данные, не исполнять. Общие fixtures читают crawler и UI. Добавить тест, требующий standalone parser version bump при изменении его семантики, по образцу marketplace cache-version test.
- [ ] **Проверить.** В `crawler/`: `bun run typecheck`, focused suites выше и новый cache-version test. В `ui/`: `bunx vitest run src/app/types/standalonePluginContract.test.ts`. Все проходят; marketplace fixtures не меняются ради новой story. Отдельный commit для контракта.

## Task 2: провести происхождение через SQLite и публичный snapshot

**Files:** `storage/schema.ts`, `storage/repositories.ts`, `storage/rejectedCandidates.ts`, `output/catalogSnapshot.ts`, `output/validate.ts`; shared `catalog.js`, `catalog.d.ts`; их текущие `*.test.ts`, `crawler/test/integration/uiContract.test.ts`.

**Consumes:** `StandalonePluginManifest`, standalone parser version из Task 1.
**Produces:** optional `manifest_kind?: 'marketplace' | 'standalone-plugin'` в `CatalogRecord`/`Repo` и persistable standalone validators.

- [ ] **Написать failing migration tests v21 → v22.** Добавляются nullable `manifest_kind` с CHECK на два значения, `plugin_manifest_etag`, `plugin_manifest_parser_version` с CHECK `>=1`; в `rejected_repository_candidates` — `eligibility_version INTEGER NOT NULL DEFAULT 1`. Старые ids, `createdAt`, `catalog_updated_at`, plugins summaries, metadata, `discovery_ranges` и repository-search cursors неизменны. Миграция повторно безопасна. Проверить также создание чистой DB.
- [ ] **Написать failing storage/contract tests.** Standalone row после сериализации даёт `manifest_kind:'standalone-plugin'`, count 1 и один summary. Старый snapshot без поля продолжает приниматься; неизвестный kind отвергается строгим published schema и понятной validation path. Старый marketplace-only snapshot сохраняет прежние байты.
- [ ] **Закрепить отрицательный кеш.** Добавить `REPOSITORY_ELIGIBILITY_VERSION = 2` в `rejectedCandidates.ts`. Старая rejection version 1 разрешает rediscovery без нового push; version 2 сохраняет нынешнюю push/90-day политику. `recordRejectedCandidate` пишет текущую версию; stale matching rejection удаляется при проверке. Не очищать всю таблицу при запуске.
- [ ] **Реализовать атомарное хранение.** Расширить `RepositoryRow`, `EnrichmentFields`, `PublishableRepository`, prepared update, select и canonical merge. Успешный standalone очищает marketplace validators/failure markers; marketplace очищает plugin validators. SQL `COALESCE` не должен препятствовать этой очистке. Rename/merge переносит согласованный snapshot вместе с kind и кешем. Kind change обновляет `catalog_updated_at`, ETag-only update его не меняет.
- [ ] **Обновить public wire format.** `renderRepos` добавляет `manifest_kind` только для standalone. Дополнить strict schemas, allow-lists validation paths и TS declarations. Старые режимы snapshot/recovery сохраняют формат; `publishRun` не меняет старый draft hash из-за нового поля. Добавить regression в `publishRun.test.ts`, если восстановление требует нового serializer option.
- [ ] **Проверить.** В `crawler/`: `bunx vitest run src/storage/schema.test.ts src/storage/repositories.test.ts src/storage/rejectedCandidates.test.ts src/output/catalogSnapshot.test.ts src/output/validate.test.ts src/publish/publishRun.test.ts test/integration/uiContract.test.ts`; затем `bun run typecheck`. Отдельный commit для данных и совместимости.

## Task 3: принимать одиночный плагин через REST fallback

**Files:** `crawler/src/github/client.ts`, `client.test.ts`, `crawler/src/crawl/enrich.ts`, `enrich.test.ts`.

**Interfaces:**

- Add `GitHubReader.getPluginManifest(owner: string, repo: string, etag?: string, options?: GitHubRequestOptions): Promise<RepoResult<StandalonePluginManifest>>` и реализацию `GitHubClient`. Обновить все mock readers; сделать method обязательным, чтобы отсутствие поддержки не превращалось в тихое удаление plugin-only кандидатов.
- Endpoint — `GET /repos/{owner}/{repo}/contents/.claude-plugin/plugin.json`, текущий `core` bucket, raw JSON accept, existing request/retry/shutdown policy.
- Внутренний результат enrichment различает `manifestKind:'marketplace'` и `'standalone-plugin'`; отдельный plugin ETag/parser version не попадает в marketplace OID/ETag.

- [ ] **Написать failing client tests.** Корректные endpoint/encoding/accept, own `If-None-Match`, 200/304/404, invalid JSON, `StandalonePluginFormatError` → `invalid-content/invalid-manifest`, неожиданная parser exception → `temporary-error/parser_internal`, существующие retry/fatal/shutdown правила. Не считать все parser errors временной сетевой ошибкой из-за текущей проверки только `MarketplaceFormatError`.
- [ ] **Написать transport-parameterized enrichment tests.** Для REST reader и GraphQL metadata + REST fallback: marketplace 404 → plugin 200 сохраняет count 1/kind/summary; два 404 завершают rejection; marketplace 200 не запрашивает plugin; marketplace invalid/429/5xx не вызывает fallback. Repository Search-only кандидат проходит тот же путь без Code Search hints.
- [ ] **Закрепить кеш и переходы.** Plugin 304 с корректным cache сохраняет count; stale parser version или summary не из одного валидного элемента вызывает один unconditional retry. Marketplace ETag не отправляется plugin endpoint. Проверить оба kind-перехода, old invalid marketplace OID после удаления файла, transient plugin error для новой и принятой строки, canonical rename и deletion/private repository.
- [ ] **Запустить новые тесты и увидеть ожидаемые failures, затем реализовать fallback.** Проверить все места marketplace `not-found`, включая `loadLegacyMarketplace`, `loadGraphQLMarketplaceViaRest` и GraphQL batch retry recovery. Решение об удалении принимается после завершения применимого fallback; metadata/private checks остаются раньше. Не изменять GraphQL queries для загрузки plugin blobs.
- [ ] **Подключить корректную диагностику.** `plugin_manifest_invalid_json`, `plugin_manifest_invalid_manifest`, `plugin_manifest_temporary_error` с реальным endpoint; transient не записывать как постоянный rejection. Сохранить last-good counts/summaries и запрет writes после завершения run. Новая pending строка при invalid/transient не получает `plugins_count=1`.
- [ ] **Проверить.** В `crawler/`: `bunx vitest run src/github/client.test.ts src/crawl/enrich.test.ts src/crawl/healthCheck.test.ts`; `bun run typecheck`. Прежние marketplace OID, invalid-cache, batch-write и retry тесты проходят. Отдельный commit для enrichment.

## Task 4: расширить discovery и сохранить читаемость отчётов

**Files:** `github/searchFamilies.ts`, `crawl/discover.ts`, `crawl/runCrawl.ts`, `storage/discoveryCandidates.ts`, `storage/inspect.ts`, `service/execute.ts`; соответствующие tests, `storage/discoveryRanges.test.ts`.

**Interfaces:**

- Append family `plugin_filename_path`, query `filename:plugin.json path:.claude-plugin size:${min}..${max}`.
- Add optional `expectedPath` в описание семьи: новая семья — `.claude-plugin/plugin.json`; существующая literal marketplace семья — прежний точный путь. Прежнюю broad marketplace семью не ужесточать попутно.
- Extend yield/source report новым `acceptedStandalonePlugins: number`; старое отсутствие поля нормализовать к 0. `acceptedMarketplaces` теперь считает marketplace accepted rows; сумма двух accepted counters + rejected + pending равна unique candidates.

- [ ] **Написать failing discovery tests.** Новый root manifest включается, nested/fixtures/похожие пути пропускаются до writer. Повторы в семьях, case variants и пересечение Repository Search сохраняют одну строку, но все provenance rows. Старый rejection version 1 не отсекает plugin hit.
- [ ] **Закрепить coverage.** Новая семья имеет собственные size-range keys; старые checkpoints не сбрасываются. Saturation/`incomplete_results` и ограничения страниц остаются видимыми. Failed plugin search не объявляется полной code-search coverage. Не увеличивать repo-search page budget ради новой семьи.
- [ ] **Написать failing report compatibility tests.** Прочитать report с двумя семьями и legacy report без `families`: новая семья получает нули. Новый трёхсемейный report round-trip сохраняет числа. Неизвестная семья и inconsistent totals отвергаются. Source yield отдельно считает marketplace/standalone/pending/rejected; global additions deduplicated.
- [ ] **Реализовать.** Формировать initial family counters из реестра, убрать предположение «ровно две семьи» в `execute.ts`, нормализовать только известные legacy shapes. Обновить aggregation/source serialization и операторский inspect. В test helpers фильтр `query.startsWith('filename:')` заменить на marketplace-specific проверку: после этой story он захватывает plugin queries.
- [ ] **Проверить.** В `crawler/`: `bunx vitest run src/github/searchFamilies.test.ts src/crawl/discover.test.ts src/crawl/discoverRepositories.test.ts src/storage/discoveryRanges.test.ts src/storage/discoveryCandidates.test.ts src/crawl/runCrawl.test.ts src/service/execute.test.ts src/storage/inspect.test.ts`; `bun run typecheck`. Отдельный commit для discovery/reporting.

## Task 5: показать плагин и применимый способ локальной загрузки

**Files:** UI files из File Map; `ui/src/lib/repositoryManifest.test.ts`, `standalonePluginInstructions.test.ts`, `markdown.test.ts`, `app/[...repo]/page.test.ts`; e2e files/mock server; `ui/src/app/SKILL.md/route.ts` и его test — только уточнение существующей инструкции чтения manifest.

**Interfaces:**

- `loadRepositoryManifest(fetchManifest: (path: string) => Promise<Response>): Promise<RepositoryManifestLoadResult>` в `ui/src/lib/repositoryManifest.ts`.
- `RepositoryManifestLoadResult` — union: `{kind:'marketplace'; manifest:unknown; path:'.claude-plugin/marketplace.json'}`, `{kind:'standalone-plugin'; manifest:StandalonePluginManifest; path:'.claude-plugin/plugin.json'}`, `{kind:'missing'}` или `{kind:'error'; path:string; reason:'http'|'invalid-content'|'network'}`.
- `getStandalonePluginLoadInstructions(owner?: string | null, repoName?: string | null): string | null` возвращает две строки clone/`claude --plugin-dir` из spec либо `null` при невалидной identity. Это helper загрузки, не источник fake marketplace name.
- Detail получает snapshot kind отдельным prop из catalog row; обновление live GitHub repository metadata не стирает этот признак.

- [ ] **Написать failing loader/instruction tests.** Marketplace first, fallback только 404; plugin valid/minimal → один display plugin; invalid JSON и transient различаются с missing. URL корневого `plugin.json` показывается при его ошибке. Identity `acme/reviewer` даёт точные две команды из spec; небезопасные owner/repo дают `null`, manifest.name не участвует в shell arguments.
- [ ] **Реализовать единый UI loader.** Переиспользовать в `RepoPageClient` и server metadata fallback через fetch callback. Сохранить AbortController/retry cleanup в браузере и общий server time budget 1 500 ms, а не отдельные 1 500 ms на каждый fallback. Parsing standalone использует общий контракт и существующее безопасное восстановление display metadata; не направлять plugin payload в `MarketplacePluginsSchema`. Имя вне `PluginIdSchema` отображать без CLI `id`; не отвергать запись и не создавать slug. Отдельный тест: `Review Tools` остаётся одним plugin с локальной загрузкой.
- [ ] **Обновить detail.** `PluginCard` различает marketplace install и local load. Для standalone `marketplaceName` отсутствует, а существующий unqualified `/plugin install name` тоже не предлагается. Ссылка View ведёт на настоящий manifest; component paths строятся от root (`source:'./'`). Не синтезировать отсутствующие component files.
- [ ] **Обновить search card и Markdown API.** Standalone card ведёт к local-load инструкции/источнику и не копирует marketplace add. В Markdown frontmatter `install_command: null`, тип `manifest_kind: standalone-plugin`, отдельный блок Local loading с теми же двумя командами. Legacy rows сохраняют прежнее поведение. JSON catalog API сохраняет новый optional field после parsing/serialization.
- [ ] **Добавить deterministic e2e fixture.** Plugin-only repo в маленьком test catalog + GitHub mock: его можно найти по plugin name/description, detail показывает один plugin и Load locally, clipboard содержит точные инструкции, на странице нет `/plugin marketplace add` и `/plugin install`. Marketplace fixture с count 1 остаётся marketplace. Проверить source links, snapshot fallback при недоступном GitHub и один сценарий смены типа. Production catalog вручную не редактировать.
- [ ] **Проверить metadata/машиночитаемые поверхности.** При отсутствии GitHub description server берёт standalone description; прежняя SEO quality policy и canonical URLs сохранены. `/SKILL.md` разрешает читать соответствующий `plugin.json` вместо требования marketplace для всех записей; не добавлять новую процедуру установки/исполнения. Проверить JSON API, Markdown, sitemap и обычный marketplace detail.
- [ ] **Проверить.** В `ui/`: `bun run typecheck`; `bunx vitest run src/lib/repositoryManifest.test.ts src/lib/standalonePluginInstructions.test.ts src/lib/markdown.test.ts 'src/app/[...repo]/page.test.ts' src/app/api/catalog/contract.test.ts src/app/SKILL.md/route.test.ts`; затем `bun run test:e2e -- tests/e2e/repo-detail.spec.ts tests/e2e/directory.spec.ts`. Отдельный commit для UI/API.

## Task 6: проверить полный путь и подготовить ограниченный rollout

**Files:** `crawler/test/integration/pipeline.test.ts`, `uiContract.test.ts`; создать `crawler/scripts/audit-standalone-plugins.ts`; дополнить research-файл результатами аудита; короткий runbook в этом плане.

- [ ] **Сквозной failing integration test.** Мокнутые реальные `GitHubClient` endpoints: generic plugin search → candidate → marketplace 404 → plugin manifest → SQLite → draft snapshot → strict UI schema. Проверить one repo/one plugin/kind/name/description и отсутствие лишнего plugin GET для marketplace. Второй прогон не создаёт дубликат; variant только с Repository Search даёт тот же результат. GitHub publication мокнута.
- [ ] **Запустить required checks после реализации.** В `crawler/`: `bun run typecheck`, `bun run typecheck:integration`, `bun run lint`, `bun run test`, `bun run test:integration`. В `ui/`: `bun run typecheck`, `bun run lint`, `bun run test:unit`, focused e2e из Task 5; `bun run build` если не был выполнен Playwright setup. Дополнительно только новые failures/изменения оправдывают повтор проверок.
- [ ] **Подготовить ограниченный read-only live audit.** Script `crawler/scripts/audit-standalone-plugins.ts` использует существующий `GitHubClient`, query builder и parsers, но не открывает production DB и не вызывает Git publication. Максимум **20 Code Search page requests** и **20 уникальных root plugin кандидатов для проверки manifest**, явно неполный результат при исчерпании бюджета. Повторный GET/304 входит в actual request accounting. Это аудит запросов и валидности; DB writes/полный pipeline уже проверяются integration test. Не выдавать параметры script за существующие flags production CLI: `crawl --dry-run` всё равно изменяет SQLite и для такого read-only аудита не подходит.
- [ ] **Выполнить аудит, если доступен read credential.** Из `crawler/`: `bun scripts/audit-standalone-plugins.ts`; read token берётся из текущего `GITHUB_READ_TOKEN`, без печати. Записать query/ranges, actual requests/latency, root vs nested hits, unique candidates, standalone accepted/rejected/deferred, extra core requests/304 и incomplete coverage. Снимок backlog/типов production можно прочитать отдельно read-only; не измерять его движение этим script. Для 2–3 принятых repo вручную прочитать root manifests/README без запуска найденного кода. Отсутствие credential фиксируется как невыполненный live gate; offline checks не выдаются за live result.
- [ ] **Решить вопрос производительности по измерениям.** Если REST fallback не укладывается в действующий operational run budget, остановить включение production discovery и вынести OID/batch оптимизацию в follow-up. Не придумывать численную оценку «сотни найдено» по search total_count и не увеличивать budgets скрыто.
- [ ] **Подготовить выпуск readers → crawler → проверка snapshot.** Сначала UI/shared readers с optional kind; затем crawler/schema с новой семьёй; проверить типы и count в первом ограниченном draft. Отдельно согласовываются production backfill и публикация. При откате crawler остановить; schema22 не даунгрейдить до21. Старые readers со strict schema не должны получить новый snapshot — вернуть последнюю совместимую версию данных вместе с reader rollback.
- [ ] **Закрыть AC1–AC11 доказательствами.** Сопоставление: AC1/2/3 → Tasks1/3/4/6; AC4/5 → Tasks1/3/4; AC6/7 → Task3; AC8 → Tasks2/4; AC9/10 → Task5; AC11 → Task6. Не отмечать story выполненной до сквозного теста, совместимости и UI установки.

## Зафиксированные решения и оставшиеся измерения

Рекомендуемый scope уже позволяет реализовать story без дополнительного архитектурного исследования: root-only, marketplace-first, REST fallback, отдельное происхождение, локальная загрузка на сессию. Публичный install marketplace, nested plugins и dual-manifest GraphQL — отдельные расширения.

До production включения остаются измерения: фактический standalone yield, увеличение core requests и длительности, наличие saturated диапазонов, скорость backlog. Это release gates, а не причины откладывать подготовку контрактов и deterministic tests.

План подготовлен и проверен как документ. Ни одна задача реализации выше ещё не выполнена.
