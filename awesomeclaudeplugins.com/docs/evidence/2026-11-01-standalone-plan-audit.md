# Story 37: сверка реализации с тремя документами из imp

Проверены версии из **`3bde8a88f1559681a30a53d883cc050494ef5d4e`**, а не только более поздний отчёт о реализации:

- `docs/research/2026-11-01-standalone-plugin-contracts.md` — первичные контракты и ограничения.
- `docs/superpowers/specs/2026-11-01-standalone-plugin-indexing-design.md` — scope, данные и AC1–AC11.
- `docs/superpowers/plans/2026-11-01-standalone-plugin-indexing.md` — шесть этапов и конкретные проверки.

Аудит начат от `9ceb548` после merge #427; доработка перебазирована на **`03b7e40`** с новой marketplace-командой из #423. Работа выполняется в изолированном T3 worktree. Исходные документы в ветке `imp` не изменялись.

## Что потребовало исправления

1. **Task 5 / AC6: ошибка чтения тела ответа.** `loadRepositoryManifest` объединял `response.json()` и проверку структуры одним catch. Обрыв уже начатого HTTP 200 превращался в `invalid-content`; standalone UI отказывался показывать сохранённый snapshot. Теперь SyntaxError означает невалидный JSON, ошибка чтения потока — network, а проверка manifest остаётся отдельной. Две unit-регрессии сначала показали неверный `invalid-content`, затем прошли. Браузерный тест получает настоящий HTTP 200, обрывает chunked JSON на mock-сервере и подтверждает отображение сохранённого плагина.
2. **Task 4 / AC8: нормализация source counters старых отчётов.** Двухсемейный stored report принимался валидатором, но отсутствующий `acceptedStandalonePlugins` оставался `undefined`. Replay publication теперь нормализует отсутствующий счётчик каждого имеющегося источника к `0`. Регрессия воспроизвела `undefined != 0`, затем прошла. Отчёты вообще без source summary сохраняют прежнюю форму; неизвестные семьи и невалидные totals по-прежнему отвергаются.
3. **Task 5: неполное доказательство пользовательского пути.** Прежний search-card E2E подменял `/api/catalog`, а detail использовал другой репозиторий. Добавлен отдельный fixture-каталог и тест настоящих API/SSR/поиска/перехода на detail. Нет ручного seed в production snapshot. `CATALOG_DATA_PATH` — приватный параметр процесса чтения каталога; без него используется прежний файл `src/data/repos.json`. Отдельная Playwright-конфигурация передаёт fixture и сборке, и серверу. CI запускает этот набор отдельно от обычного каталога.
4. **Task 3 / AC7: явная регрессия stale standalone parser.** Расширен тест 304: даже при валидном summary несовпадающая версия parser требует запроса без ETag и восстановления содержимого. Изменять корректно работающий cache pipeline не потребовалось.

## Сопоставление критериев приёмки

| Критерий | Результат и доказательство |
| --- | --- |
| AC1, AC2: discovery обоих источников до snapshot | [Integration](../../crawler/test/integration/standalonePlugin.test.ts) использует настоящий `GitHubClient` с мокнутыми endpoints, отдельно Code Search и Repository Search; повторный crawl сохраняет один id. |
| AC3: минимальный manifest, count 1, имя | Общий standalone parser и fixtures принимают только обязательное name, сохраняют `Review Tools` без slug/id; integration проверяет опубликованный strict snapshot. |
| AC4: nested/невалидный/MCP-only не становятся standalone | Точный root path до writer в `discover.ts`, negative parser cases и два manifest 404 в enrichment. Нет нового поиска подпапок или manifest-less плагинов. |
| AC5: дедупликация и marketplace priority | Общий discovery writer/provenance и существующие tests; новый E2E проверяет появление marketplace у standalone без plugin GET и возврат к standalone после удаления marketplace. |
| AC6: ошибки и last-good | REST/GraphQL enrichment tests сохраняются; новые unit и browser body-read регрессии закрывают найденный пробел UI. Невалидный JSON остаётся ошибкой автора, без тихой подмены snapshot. |
| AC7: отдельные validators и parser version | [Enrichment tests](../../crawler/src/crawl/enrich.test.ts), kind-transition storage tests и новый stale-parser вариант 304. Marketplace и plugin validators не смешиваются. |
| AC8: миграции, snapshots, reports, rejections | Пополненные v21 migration tests, recovery/draft hash tests и eligibility v2; новый [two-family replay](../../crawler/src/service/execute.test.ts) доказывает нулевые source counters. |
| AC9: один plugin, реальные URLs, local load | Новый E2E проверяет root source, component URL на default branch `trunk`, plugin.json, README и точный clipboard. В имени плагина есть пробелы; команды используют owner/repo. |
| AC10: все поверхности и качество | Настоящий API ищет по plugin name/description, card view сохраняет kind без summaries; detail, Markdown, metadata description fallback и sitemap проверяются на одном каталоге. Marketplace с count 1 остаётся marketplace. |
| AC11: ограниченный аудит и эксплуатационные границы | Существующий read-only аудит: 20 кандидатов, 6 standalone / 14 marketplace, 1 search + 26 core, incomplete coverage. В этой доработке live-аудит повторно не запускался: discovery/request budgets не менялись. Production backlog/скорость его обработки остаются release measurements; production DB и публикация не запускались. |

## Допустимые уточнения и оставшиеся ограничения

- Спецификация первоначально оставляла все legacy kinds null до refresh. Итоговая v22 миграция backfill-ит уже обогащённые marketplace **до** установки kind-change trigger: это сохраняет прежний sitemap lastmod после первого неизменного refresh. Pending rows остаются null, public snapshot legacy marketplaces по-прежнему не получает поле kind. Откат к буквальному раннему варианту ухудшил бы AC8.
- Новый main предлагает однокомандную marketplace-установку. Проверки учитывают её; standalone всё равно загружается через `--plugin-dir`, без выдуманного marketplace и без исполнения плагина тестами.
- Собственный публичный marketplace, nested plugins, dual-manifest GraphQL и массовый production backfill исключены исходными документами. Их отсутствие не является недоделкой этой story.
- Порядок выпуска сохраняется: совместимые UI/shared readers → crawler → проверка ограниченного snapshot; production backfill и публикация отдельно. Результат тестов не доказывает полноту GitHub-поиска или безопасность исполнения сторонних плагинов.

## Проверки и воспроизведение

- Crawler: 731 unit tests / 39 files, 4 integration tests / 3 files; typecheck, integration typecheck, build и lint прошли.
- UI после rebase: 407 unit tests / 53 files; typecheck и lint. Три прежних lint warnings остаются без изменений.
- `cd awesomeclaudeplugins.com/ui && bun run test:e2e:standalone`: **10 desktop/mobile E2E**, production build, настоящие catalog API/SSR, GitHub mock. Все прошли, включая обрыв тела HTTP 200.
- Обычный focused набор `repo-detail.spec.ts` + `directory.spec.ts`: **94 desktop/mobile E2E прошли** отдельно с исходным production snapshot, чтобы fixture override не скрыл регрессии обычного каталога.

## Скриншоты

Снимки сделаны Playwright с реально работающей production-сборки после assertions. Каталог из двух записей и GitHub endpoints — детерминированные test fixtures; это не реальные upstream репозитории `acme`.

- [Desktop: найденный плагин и локальная загрузка](standalone-audit-desktop.png).
- [Mobile: тот же путь](standalone-audit-mobile.png).
- [HTTP 200 с оборванным телом: сохранённый plugin snapshot и local loading](standalone-audit-snapshot.png).

Независимое Sol-loop ревью и итог CI будут указаны в PR; режим full-stop оставляет PR открытым без merge, auto-merge или merge queue.
