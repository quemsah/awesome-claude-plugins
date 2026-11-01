# Story 37: проверка реализации

Дата: 2026-11-01. Ветка `feat/standalone-plugin-indexing`, отдельный T3 worktree. Production backfill и публикация каталога не запускались.

## Этапы и коммиты

1. Контракт standalone manifest: `a3dc9ae`.
2. SQLite v22, происхождение и раздельные validators: `4fa00ad`.
3. REST fallback в обоих enrichment-путях: `0db39bf`.
4. Code Search семья и совместимость отчётов: `bff6278`.
5. Detail/search UI, Markdown и локальная загрузка: `1c16555`.
6. Сквозные проверки, ограниченный аудит и доказательства: `b85376f`.

Коммиты сохранены раздельно после rebase на `1457f48` (актуальные shared marketplace validator и FTS5 catalog search). Исправление S1 после первого ревью — `f9d0e08`.

## Выполненные проверки

- Crawler после rebase: typecheck, integration typecheck, lint; 39 unit test files / 722 tests; 3 integration files / 4 tests. Сквозные standalone сценарии проверяют Code Search и Repository Search отдельно, повторный crawl сохраняет одну строку с прежним id. Workspace build и native SQLite smoke также прошли.
- UI после rebase: typecheck и lint; полный unit suite — 358 тестов. Production build и все 88 desktop/mobile проверок Playwright прошли.
- UI lint сохраняет 3 прежних предупреждения: optional chain в `pluginComponentUrl.ts` и два `innerText` в `search-state-sync.spec.ts`. Новых lint errors нет.
- Тест на ответ без нового ETag воспроизвёл сохранение устаревшего plugin validator; storage исправлен, focused и полный crawler suites повторно прошли.
- Sol-loop round 1 выявил S1: при canonical merge после invalid marketplace переносились summary и marketplace validators без соответствующего типа и plugin validators. Для legacy null kind и явного marketplace regression воспроизвёл ошибочный plugin ETag; исправление переносит выбранный snapshot согласованно.
- Sol-loop round 2: **APPROVE**, S1 resolved, новых замечаний нет; совместимость rebase и сохранение шести отдельных этапов подтверждены. Независимо повторно прошли 118 crawler tests, 28 UI tests и whitespace check. Reviewer: `gpt-6.1-sol`, effort `high`; usage не возвращён. Одна ранняя попытка round 2 завершилась лимитом сервиса до ревью; после восстановления проверка выполнена тем же provider/model.
- CodeRabbit CR1: инструкция агента больше не отправляет к новому непроверенному clone после аудита. Standalone ветка использует уже проверенный абсолютный checkout с прежними commit/clean-status rechecks; catalog clone examples считаются reference-only. После правки текста прошли 5 focused и все 358 UI unit tests, lint.
- Проверка замечаний PR: удаление после plugin 404 теперь сообщает `plugin_manifest_not_found` и путь `plugin.json` (единственный вызов helper); REST и GraphQL регрессии наблюдались RED → GREEN. Canonical merge сохраняет существующий standalone snapshot вместе с validators, когда дубликат не содержит summary; две регрессии с null/ненулевым входящим count также RED → GREEN.
- После дополнительного коммита `86e3a89` проверены корневые source links, тексты и machine-readable guidance для обоих видов manifest. Исправлены lint filename/format и включение нового rendering test в unit suite. Итог: 726 crawler unit + 4 integration, 362 UI unit, оба typecheck краулера и UI, lint, production build и 34 desktop/mobile repo-detail E2E прошли; PNG обновлены. Первый параллельный UI unit прогон упёрся в 5s timeout поиска; изолированный повтор двух тестов и весь suite с `--maxWorkers=2` прошли без изменения timeout или production-кода поиска.
- Read-only live audit: 20 кандидатов, 6 standalone / 14 marketplace, 1 Code Search + 26 core-запросов, 23 163 ms. Search saturated, `complete: false`. [Подробности и ограничения](../research/2026-11-01-standalone-plugin-contracts.md).

## Скриншоты

PNG получены Playwright с реально работающей production-сборки после assertions: один plugin, корневой source/component path, правильная ссылка `plugin.json`, session-local инструкции и успешное копирование. GitHub endpoints подменены детерминированным fixture; это не снимок текущего upstream состояния `mksglu/context-mode`.

- [Desktop — блок одиночного плагина](standalone-plugin-desktop.png)
- [Mobile — страница целиком](standalone-plugin-mobile.png)

T3 Preview открыл приложение, но два snapshot-вызова завершились `Preview automation snapshot timed out after 15000ms`; использованы PNG браузерных тестов. Вкладка Preview закрыта.

## Решения и выпуск

- Сохраняется marketplace-first политика: только подтверждённый marketplace 404 запускает standalone fallback.
- Для одиночного плагина предлагается загрузка на сессию через `--plugin-dir`; собственный install marketplace и nested plugin discovery не добавлены.
- Catalog validation проверяет manifest identity и безопасное отображение метаданных; не запускает `claude plugin validate`, компоненты или чужие скрипты.
- Выпускать shared/UI readers до появления standalone production snapshots. При откате остановить crawler и вернуть совместимый snapshot вместе с readers; SQLite v22 не даунгрейдить старым crawler.
- Production backfill остаётся отдельным действием. Live-аудит не изменял SQLite и не измеряет движение production backlog.
- `full-stop`: PR должен оставаться открытым без merge/auto-merge/merge queue; итог независимого ревью и CI сообщается отдельно после этих проверок.
