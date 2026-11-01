# Story 37: проверка реализации

Дата: 2026-11-01. Ветка `feat/standalone-plugin-indexing`, отдельный T3 worktree. Production backfill и публикация каталога не запускались.

## Этапы и коммиты

1. Контракт standalone manifest: `33f7f9e`.
2. SQLite v22, происхождение и раздельные validators: `6577936`.
3. REST fallback в обоих enrichment-путях: `9b514cd`.
4. Code Search семья и совместимость отчётов: `d2e64fa`.
5. Detail/search UI, Markdown и локальная загрузка: `8bd0fdd`.
6. Сквозные проверки, ограниченный аудит и доказательства: `93a6d34`.

## Выполненные проверки

- Crawler: typecheck, integration typecheck, lint; 39 unit test files / 717 tests после исправления S1; 3 integration files / 4 tests. Сквозные standalone сценарии проверяют Code Search и Repository Search отдельно, повторный crawl сохраняет одну строку с прежним id.
- UI: typecheck и lint; полный unit suite — 339 тестов, затем дополнительный metadata fallback test и focused run — 9 тестов. Production build и Playwright — 88 desktop/mobile проверок прошли.
- UI lint сохраняет 3 прежних предупреждения: optional chain в `pluginComponentUrl.ts` и два `innerText` в `search-state-sync.spec.ts`. Новых lint errors нет.
- Тест на ответ без нового ETag воспроизвёл сохранение устаревшего plugin validator; storage исправлен, focused и полный crawler suites повторно прошли.
- Sol-loop round 1 выявил S1: при canonical merge после invalid marketplace переносились summary и marketplace validators без соответствующего типа и plugin validators. Для legacy null kind и явного marketplace regression воспроизвёл ошибочный plugin ETag; исправление переносит выбранный snapshot согласованно. Оба сценария и 717 unit / 4 integration tests прошли; исправление отправляется на round 2.
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
