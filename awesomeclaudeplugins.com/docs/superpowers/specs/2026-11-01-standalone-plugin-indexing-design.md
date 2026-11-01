# Story 37: индексация одиночных Claude Code плагинов

**Исходный пункт:** FEAT-CRAWL-03. **Тип:** Feature / Discovery. **Приоритет:** Medium.
**Статус:** исследование и предлагаемая спецификация; реализация не начата.
**База исследования:** `dec3e93`, 2026-11-01. Пути ниже относительно `awesomeclaudeplugins.com/`.

## Пользовательская история

Как пользователь каталога, я хочу находить публичные репозитории, у которых есть корневой `.claude-plugin/plugin.json`, но нет `.claude-plugin/marketplace.json`, видеть сведения об их единственном плагине и получать применимый способ его загрузки в Claude Code.

Увеличиваем охват валидных Claude Code плагинов. Утверждение «пропущены сотни» пока является гипотезой: число новых подходящих репозиториев нужно измерить ограниченным аудитом.

## Что выяснено в текущем коде

| Участок | Текущее поведение | Следствие для story |
| --- | --- | --- |
| `crawler/src/github/searchFamilies.ts` | Две Code Search семьи для `marketplace.json` | Нужна отдельная семья для `plugin.json`; прежние checkpoint-ключи сохраняются |
| `crawler/src/crawl/discover.ts:148` | Точный путь проверяется только для `marketplace_path_literal` | Новый запрос тоже должен отбрасывать вложенные манифесты, fixtures и примеры |
| `crawler/src/github/client.ts` | REST и GraphQL читают только корневой marketplace | Изменения одного `marketplace.ts` недостаточно: нужен fallback в enrichment |
| `shared/catalog-contract/src/marketplace.js` | Корневые `name`, `owner.name`, `plugins`; у элемента обязательны `name` и `source` | Plugin manifest требует отдельного контракта; ослаблять marketplace parser нельзя |
| `crawler/src/crawl/enrich.ts:813` | Marketplace 404 удаляет репозиторий и записывает rejection | До удаления нужно проверить одиночный плагин, в обоих transport-путях |
| `crawler/src/storage/rejectedCandidates.ts` | Отклонение переживает удаление строки; повторная проверка по push или через 90 дней | Старый отрицательный кеш не должен блокировать новую eligibility policy |
| `crawler/src/storage/schema.ts` | Текущая версия SQLite — 21 | Следующая миграция — 22, если до реализации не появятся другие миграции |
| `shared/catalog-contract/src/catalog.js`, `crawler/src/output/validate.ts` | Строгий публичный snapshot | Новый признак типа нужно провести через writer, serializer, validators и UI |
| `ui/src/components/repo/RepoPageClient.tsx` | Браузер загружает только marketplace | Без UI-изменения найденный репозиторий покажет отсутствие манифеста |
| `ui/src/components/search/RepoCard.tsx`, `ui/src/lib/markdown.ts` | Команда marketplace строится из owner/repo | Для одиночного плагина такая команда не должна предлагаться |
| `crawler/src/service/execute.ts:181` | Stored report требует ровно текущий набор search families | Добавление третьей семьи требует совместимого чтения старых отчётов |

В репозитории уже есть Repository Search и общий deduplicating writer. Новый endpoint поиска репозиториев, отдельная таблица плагинов и новая система discovery не нужны. Репозиторий, найденный через Repository Search, также должен пройти новый fallback, даже если Code Search его не вернул.

Проверка исходного состояния: `bunx vitest run src/github/searchFamilies.test.ts src/github/marketplaceContract.test.ts` из `crawler/` — **2 файла, 9 тестов прошли**. Это проверка текущего поведения, не доказательство реализации story.

## Контракт Claude Code и установка

Первичные источники и ограничения: [исследование официальных контрактов](../../research/2026-11-01-standalone-plugin-contracts.md).

В исследовании есть реальный plugin-only пример: [`AgriciDaniel/claude-canvas`](https://github.com/AgriciDaniel/claude-canvas/blob/05b808cafd906bb3b8ff1c597ed8cd33ff5145c0/.claude-plugin/plugin.json) на закреплённом commit; в стандартной `.claude-plugin/` нет marketplace. `obra/superpowers` и `mksglu/context-mode` демонстрируют сосуществование обоих файлов. Это контрольные примеры для контракта, не allow-list и не production seeds; исполнение плагинов не проверялось.

Plugin manifest и marketplace manifest — разные документы. Нельзя требовать от одиночного плагина `owner`, `plugins` или marketplace `source`. Отсутствие явно перечисленных компонентов не означает отсутствие плагина: Claude Code поддерживает стандартные каталоги компонентов.

Виртуальная обёртка существует только внутри каталога. Она не создаёт marketplace в исходном GitHub-репозитории. Поэтому не выдаём `/plugin marketplace add owner/repo` или `/plugin install name@virtual-name` за подтверждённую установку одиночного плагина.

Для первой версии предлагаем документированный локальный путь: клонирование репозитория и запуск Claude Code с `--plugin-dir`. Подпись в UI — **Load locally**, пояснение — **Loads the plugin for this Claude Code session.** Это загрузка на сессию, не постоянная marketplace-установка. Доступна ссылка на README автора. Постоянную установку через собственный публичный marketplace можно выделить в отдельную story.

Пример инструкций для валидированной GitHub identity `acme/reviewer`:

```sh
git clone https://github.com/acme/reviewer.git ./reviewer
claude --plugin-dir ./reviewer
```

Команды используют только проверенные owner/repo, а не произвольные строки из manifest. Запускать их при индексации или в тестах краулера не требуется.

## Рассмотренные подходы

1. **Только новый запрос и обёртка marketplace.** Маленький diff, но теряется происхождение записи, UI продолжает читать неправильный файл и предлагает неработающую установку. Требования story полностью не выполняет.
2. **Рекомендуемый: отдельная валидация + REST fallback + тип происхождения.** Сохраняем существующий marketplace fast path; при подтверждённом отсутствии marketplace читаем корневой plugin manifest. Нормализуем результат для подсчёта и summary, но сохраняем реальный тип для UI и API. Дополнительный REST-запрос приходится на кандидатов без marketplace.
3. **Общий dual-manifest GraphQL pipeline.** OID обоих файлов, batch-загрузка обоих типов, раздельный invalid-content кеш. Возможная дальнейшая оптимизация; расширяет наиболее сложную часть crawler до измерения стоимости fallback. Не включаем в первую версию.

Вариант 2 — предложение по результатам исследования, не ранее согласованное решение пользователя.

## Область первой версии

- Публичный GitHub-репозиторий; plugin manifest находится **ровно** в `.claude-plugin/plugin.json` на default branch.
- Один такой репозиторий — одна строка каталога и `plugins_count = 1` после успешной проверки.
- Валидные плагинные метаданные проходят в существующий bounded `plugins` summary и доступны поиску.
- Существующие marketplace-репозитории, их parser, URLs, ids и правила публикации сохраняются.
- Не включаем поиск в произвольных подпапках монорепозитория, извлечение плагинов из чужих marketplace, агрегацию всех одинаковых плагинов между репозиториями, manifests без файла `plugin.json`, MCP-only репозитории и автоматически созданный публичный marketplace.

## Правила выбора манифеста

| Результат marketplace | Действие |
| --- | --- |
| Валидный marketplace, включая пустой | Использовать существующее поведение marketplace; корневой plugin не добавлять вторым элементом |
| Подтверждённый 404 | Запросить корневой `.claude-plugin/plugin.json` |
| Невалидный JSON или структура | Существующая invalid-content политика, отдельная диагностика; fallback не маскирует ошибку автора |
| Timeout, 403/429, 5xx, неизвестный результат | Retry/last-good snapshot по существующим правилам; отсутствие файла не подтверждено |

После marketplace 404: валидный plugin принимается; plugin 404 завершает отклонение; невалидный plugin не получает count 1; transient plugin error не удаляет ранее принятую запись. Удаление всего репозитория, приватность и несовпадение canonical identity обрабатываются прежде manifest fallback.

Политика одинакова для REST, GraphQL с REST fallback и UI. Если присутствуют оба файла, побеждает marketplace. Переходы `standalone-plugin → marketplace` и `marketplace → standalone-plugin` меняют тип существующей строки без дубликата и очищают validators старого типа.

## Данные, валидация и кеши

- В общем пакете добавить `parseStandalonePlugin(value: unknown): StandalonePluginManifest` и `StandalonePluginFormatError`. Обязательный `name` — непустая строка; kebab-case в текущей документации рекомендован, отклонение от него само по себе не делает manifest невалидным. Собственные ограничения каталога: максимум 160 символов, корректный Unicode и отсутствие управляющих символов; это display-policy, а не требование Anthropic. Имя сохраняем без slugification. Не выводим plugin id из имени репозитория и не требуем CLI-token regex для принятия.
- Неизвестные поля не мешают discovery; неподдерживаемые optional-поля не исполняются и не становятся HTML/командами. Для отображения оставляем безопасные поля. Минимальный корректный manifest принимается без `source`, `author`, `version` и списка компонентов. Это валидация для каталога, не запуск полной CLI-валидации всех файлов плагина.
- Нормализация создаёт `plugins: [manifest с source: './']` для совместимости существующих consumers; `source` задаёт каталог после валидации. Не придумывать публичное marketplace name или owner автора.
- В UI имя вне нынешнего `PluginIdSchema` остаётся отображаемым `name`, без поля CLI `id`: локальная загрузка использует owner/repo, поэтому slug и установка по имени не нужны.
- SQLite: `manifest_kind` nullable (`marketplace` / `standalone-plugin`), `plugin_manifest_etag` nullable, `plugin_manifest_parser_version` nullable. Старые строки остаются без типа до обновления, с прежним поведением.
- Публичный snapshot: optional `manifest_kind: 'marketplace' | 'standalone-plugin'`; writer первой версии добавляет поле **только для standalone**. Отсутствие поля — legacy marketplace поведение; `plugins_count = 1` никогда не используется для определения типа.
- Marketplace OID/ETag и standalone ETag не взаимозаменяемы. Для plugin 304 нужны прежний standalone тип, count 1, валидный summary из одного элемента и текущая версия plugin parser. Иначе повторить запрос без ETag один раз; повторный 304 — диагностируемая временная ошибка.
- Standalone parser имеет собственный `STANDALONE_PLUGIN_PARSER_VERSION = 1`. Существующие marketplace parser/cache versions не меняются, если их семантика не изменена. Отдельный standalone OID/negative-content кеш не нужен в первой версии.
- Rejection cache получает `eligibility_version`, старые записи — версия 1. Текущая `REPOSITORY_ELIGIBILITY_VERSION = 2`; запись старой версии не подавляет discovery. Инвалидация точечная при повторном обнаружении, без массового удаления каталога и checkpoint-таблиц.
- Смена `manifest_kind` обновляет `catalog_updated_at`. Merge после rename переносит тип и его validators вместе с соответствующим snapshot; не смешивает их с кешем другой строки.

## Поиск, ограничения и наблюдаемость

Добавить третью семью `plugin_filename_path`:

```text
filename:plugin.json path:.claude-plugin size:<min>..<max>
```

Результат запроса — кандидат. До writer требуется точное равенство `path === '.claude-plugin/plugin.json'`. Фильтруем `plugins/x/.claude-plugin/plugin.json`, `.claude-plugin/examples/plugin.json` и похожие файлы. Используем существующие size partitions, пагинацию, rate budget, `incomplete_results`, provenance и дедупликацию. Границы split и лимит GitHub в 1 000 результатов не дают основания обещать полный охват GitHub.

`discovery_ranges.query_family` уже текстовый: новую семью можно добавить без пересоздания этой таблицы. Старые отчёты с двумя семьями должны читаться; недостающую новую семью нормализуем нулевыми счётчиками. Не принимаем произвольные неизвестные имена семей.

В source summary разделить `acceptedMarketplaces` и новый `acceptedStandalonePlugins`; оба участвуют в количестве принятых кандидатов. Legacy report без нового поля трактуется как 0 standalone. Метрики раздельны по источникам; глобальные добавления считаются по уникальным repository ids, а не суммированием overlapping sources.

## Критерии приёмки

- [ ] **AC1. Discovery:** generic Code Search возвращает корневой plugin-only репозиторий; кандидат проходит enrichment и попадает в snapshot без ручного seed.
- [ ] **AC2. Repository Search:** тот же результат достигается для кандидата только из Repository Search, без зависимости от найденного пути Code Search.
- [ ] **AC3. Минимальный manifest:** валидный `name` без marketplace-полей принимается; count равен 1, summary содержит имя, canonical URL соответствует GitHub identity.
- [ ] **AC4. Отрицательные примеры:** nested-only manifest, неверный корень JSON, отсутствующее/невалидное имя и MCP config без plugin manifest не становятся validated standalone записью.
- [ ] **AC5. Дедупликация:** пересечение источников и наличие обоих корневых файлов не удваивают строку и count; при наличии marketplace используется он.
- [ ] **AC6. Ошибки:** marketplace invalid/transient не вызывает fallback; plugin transient сохраняет last-good snapshot; два подтверждённых manifest 404 допускают rejection по текущей политике.
- [ ] **AC7. Кеш:** plugin ETag не отправляется marketplace endpoint и наоборот; parser bump и некорректный cached summary не подтверждаются ответом 304; смена типа очищает прежние validators.
- [ ] **AC8. Совместимость:** populated SQLite v21 обновляется без потери ids, дат, summaries и search checkpoints; старые snapshots и run reports читаются; старый rejection не блокирует новый тип.
- [ ] **AC9. Detail UI:** отображается один плагин, реальная ссылка на `plugin.json`, корректные component URLs от корня репозитория и локальные инструкции вместо вымышленного marketplace.
- [ ] **AC10. Все поверхности:** search card, detail и Markdown API не выдают standalone за marketplace; JSON API сохраняет `manifest_kind`; SEO metadata и sitemap используют обычные правила качества каталога.
- [ ] **AC11. Эксплуатация:** ограниченный аудит фиксирует кандидатов, validated standalone yield, число запросов/ожиданий, backlog и incomplete coverage; производство и публикация данных не запускаются как часть исследования.

## Риски и границы результата

Наиболее чувствительная часть — enrichment с retry, batched writes и последним успешным snapshot. Её проверяем на обоих transport-путях и на переходах типов. Вторая зона риска — строгая сериализация и восстановление ранее подготовленной публикации: изменение wire format не должно ломать старые draft hashes. UI должен быть готов читать новый тип до появления standalone записей в production snapshot.

Размер пропущенного корпуса и стоимость REST fallback определяются аудитом. Успешный ограниченный прогон доказывает работающий путь и его измеренную стоимость, но не полноту GitHub-поиска и не безопасность исполнения найденных плагинов.
