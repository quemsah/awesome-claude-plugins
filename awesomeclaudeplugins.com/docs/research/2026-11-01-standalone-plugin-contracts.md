# Standalone-плагины Claude Code: контракт для story 37 / FEAT-CRAWL-03

Дата проверки: **2026-11-01**. Только исследование: официальная документация Anthropic и GitHub, файлы самих авторов через подключённый GitHub. Установка плагинов и проверка их исполнения не проводились. Код crawler не исследовался и не изменялся.

## Главный вывод

Корневой `.claude-plugin/plugin.json` позволяет распознать отдельный плагин, но **не доказывает возможность выполнить `/plugin marketplace add owner/repo`**. Для этого нужен marketplace-манифест. Обнаружение плагина и доступный способ его установки должны быть разными признаками каталога. Официальная инструкция прямо разделяет передачу плагина без marketplace и публикацию через marketplace. [Anthropic: публикация](https://code.claude.com/docs/en/plugins/publish)

## Проверенные факты: manifest и компоненты

Если `plugin.json` присутствует, единственное обязательное верхнеуровневое поле — непустая строка `name`; рекомендуется kebab-case. `description`, `version`, `author` необязательны; если задан `author`, внутри обязателен `name`, а `email` и `url` необязательны. `version` описан как строка, поэтому требование строгого SemVer не следует выдавать за обязательный контракт загрузки. [Создание плагина](https://code.claude.com/docs/en/plugins/create), [справочник manifest](https://code.claude.com/docs/en/plugins-reference)

Остальные необязательные поля текущего справочника:

| Группа | Поля |
| --- | --- |
| Метаданные | `$schema`, `displayName`, `homepage`, `repository`, `license`, `keywords`, `metadata` |
| Листинг Anthropic | `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl` |
| Конфигурация | `defaultEnabled`, `dependencies`, `settings`, `userConfig`, `channels`, `types` |
| Компоненты | `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers`, `outputStyles`, `workflows` |
| Экспериментальные | `experimental` с `themes`, `monitors`, `evals` |

Сам manifest необязателен для некоторых способов загрузки стандартной структуры; его отсутствие не доказывает отсутствие плагина вообще. Неизвестные верхнеуровневые поля удаляются с предупреждением, а некоторые вложенные схемы строгие. Не стоит отвергать плагин только из-за дополнительных метаданных. [Справочник manifest](https://code.claude.com/docs/en/plugins-reference)

Пути по умолчанию относительно **корня плагина**, рядом с `.claude-plugin/`:

| Компонент | Расположение |
| --- | --- |
| Skills | `skills/<name>/SKILL.md` |
| Старые команды | `commands/*.md` |
| Агенты | `agents/` |
| Hooks | `hooks/hooks.json` |
| MCP / LSP | `.mcp.json` / `.lsp.json` |
| Стили / workflows / темы | `output-styles/` / `workflows/` / `themes/` |
| Monitors / executables / настройки | `monitors/monitors.json` / `bin/` / `settings.json` |

Компоненты необязательны; перечислять их в manifest при стандартном расположении не требуется. Поэтому отсутствие ключей `skills`, `commands` или `hooks` не означает отсутствия этих компонентов. [Компоненты плагина](https://code.claude.com/docs/en/plugins/components)

Дополнительный fallback: корневой `SKILL.md` загружается как одна skill, если нет `skills/` и ключа `skills`. [Стандартная структура](https://code.claude.com/docs/en/plugins-reference#standard-layout)

Явные пути должны оставаться внутри корня и обычно начинаться с `./`. `skills` **добавляет** пути к стандартному `skills/`; `commands`, `agents`, `outputStyles`, `workflows`, темы и monitors **заменяют** свои стандартные пути; hooks/MCP/LSP объединяются со стандартными файлами. Это важно при подсчёте компонентов. [Правила путей](https://code.claude.com/docs/en/plugins-reference#path-rules)

## Проверенные факты: ловушка установки

| Команда / способ | Реальный контракт |
| --- | --- |
| `/plugin marketplace add owner/repo` | Регистрирует marketplace; без ожидаемого `.claude-plugin/marketplace.json` сообщает об отсутствии файла. `plugin.json` его не заменяет. |
| `/plugin install owner/repo` | Прямой установки git-репозитория нет: путь, URL и `owner/repo` дают ошибку marketplace. |
| `/plugin install name@marketplace` | Ищет запись в зарегистрированном marketplace; часть после `@` — его объявленное имя, а не автоматически GitHub owner/repo. |
| `/plugin install name --marketplace owner/repo` | На v2.1.275+ объединяет добавление marketplace и открытие установки. Требование marketplace-манифеста сохраняется. |
| `claude --plugin-dir ./checkout` | Загружает локальный плагин на одну сессию; это не постоянная marketplace-установка. |

Источники: [ошибка отсутствующего marketplace-манифеста](https://code.claude.com/docs/en/plugins/troubleshooting), [контракт команд, включая ошибку прямого install](https://code.claude.com/docs/en/plugins/cli-reference), [установка и однокомандный вариант](https://code.claude.com/docs/en/discover-plugins). В интерактивной сессии `/plugin install` открывает карточку для выбора установки; shell-команда `claude plugin install` выполняет установку.

Без marketplace официально поддерживаются clone/передача каталога и загрузка через `--plugin-dir`; текущий CLI также принимает локальный ZIP и `--plugin-url <zip-url>` для одной сессии. Постоянный вариант — разместить **весь каталог плагина**, включая `.claude-plugin/plugin.json`, в `~/.claude/skills/<directory>/`: загрузка происходит при запуске. Есть также проектный `.claude/skills/`, с проверкой доверия и дополнительными ограничениями. Администратор может ограничить эти способы. [Передача без marketplace](https://code.claude.com/docs/en/plugins/publish#share-a-plugin-without-a-marketplace), [загрузка и origins `@inline` / `@skills-dir`](https://code.claude.com/docs/en/plugins/loading)

## Рекомендации для install в нашем каталоге

**Без собственного marketplace:** показывать «Загрузить локально» с проверенным URL репозитория и инструкцией вида:

```bash
git clone https://github.com/OWNER/REPO.git ./plugin-checkout
claude --plugin-dir ./plugin-checkout
```

Это шаблон инструкции, не выполненная проверка конкретного плагина. Не генерировать `marketplace add OWNER/REPO` только из факта существования `plugin.json`. Для постоянного использования можно отдельно объяснить skills-directory способ и ручное обновление checkout.

**Если нужен стандартный Install:** наш каталог может опубликовать собственный настоящий marketplace, ссылающийся на чужие standalone-репозитории. Поддерживаемый формат внешнего источника:

```json
{
  "name": "catalog-marketplace",
  "owner": { "name": "Catalog maintainer" },
  "plugins": [
    {
      "name": "plugin-name",
      "source": { "source": "github", "repo": "OWNER/REPO" }
    }
  ]
}
```

Здесь upstream не обязан иметь `marketplace.json`: он является **источником плагина**, а marketplace предоставляет наш manifest. После публикации пользователь добавляет **наш** marketplace и устанавливает `plugin-name@catalog-marketplace`. Это предлагаемая схема, не существующая интеграция. Для карточки до установки полезно передавать в запись `description` и другие метаданные: внешний `plugin.json` до установки не читается для листинга. Избегать component-overrides. `github` получает корень репозитория; для чужого вложенного плагина предусмотрен `git-subdir` с `path`. [Marketplace: поля и источники](https://code.claude.com/docs/en/plugins/marketplace-reference)

Владелец upstream также может добавить свой `.claude-plugin/marketplace.json` с единственной записью `source: "./"`. Только после этого его репозиторий сам подходит для `marketplace add`. [Публикация из собственного репозитория](https://code.claude.com/docs/en/plugins/publish#add-the-marketplace-file-to-your-repository)

## Граница scope: корневой и вложенный manifest

**Проверено:** корень плагина — каталог, содержащий `.claude-plugin/`; пути компонентов относятся к нему. Для `plugins/foo/.claude-plugin/plugin.json` корень — `plugins/foo`, а не весь репозиторий. Marketplace-запись с `source: "./plugins/foo"` явно выбирает такой плагин. Наличие корневого `plugin.json` совместимо с marketplace в том же репозитории. [Структура плагина](https://code.claude.com/docs/en/plugins/create#plugin-layout), [относительные источники marketplace](https://code.claude.com/docs/en/plugins/marketplace-reference#relative-path-plugin-source)

**Рекомендация для FEAT-CRAWL-03:** standalone discovery ограничить точным путём `.claude-plugin/plugin.json` от корня репозитория; вложенные манифесты не превращать в корневые записи. Хранить происхождение и способ установки отдельно; различать «корневой плагин» и «корневой плагин без marketplace». Дедуплицировать корневой плагин, если тот же источник уже представлен записью marketplace. Для будущих вложенных плагинов идентичность должна учитывать подкаталог. Самостоятельный `.mcp.json` без plugin-контракта недостаточен для этой истории.

## GitHub REST Code Search: факты и измеренная проверка

Используется **legacy-синтаксис REST**, а не новый веб-поиск с regex. `filename:plugin.json` ищет имя файла; `path:` ограничивает расположение, включая подкаталоги указанного пути. Документация legacy разрешает filename-only запрос без слова из содержимого; REST-справочник формулирует общее требование поискового слова без этого исключения. Подключённый API фактически принял qualifier-only запрос ниже. [Legacy-синтаксис](https://docs.github.com/en/search-github/searching-on-github/searching-code), [REST Search](https://docs.github.com/en/rest/search/search#search-code)

Контрольные запросы 2026-11-01; считаны только указанные страницы, не весь GitHub:

| Точный запрос `q` | Ответ / показанный путь |
| --- | --- |
| `filename:plugin.json path:.claude-plugin repo:obra/superpowers` | `total_count=1`, `incomplete_results=false`; `.claude-plugin/plugin.json`. [API](https://api.github.com/search/code?q=filename%3Aplugin.json%20path%3A.claude-plugin%20repo%3Aobra%2Fsuperpowers&per_page=10) |
| `filename:plugin.json path:.claude-plugin repo:anthropics/claude-plugins-official` | `total_count=0`, `incomplete_results=false`. [API](https://api.github.com/search/code?q=filename%3Aplugin.json%20path%3A.claude-plugin%20repo%3Aanthropics%2Fclaude-plugins-official&per_page=3) |
| `filename:plugin.json repo:anthropics/claude-plugins-official` | `total_count=40`, `incomplete_results=false`; считаны 3 результата, включая `plugins/hookify/.claude-plugin/plugin.json`. Это число файлов, не standalone-репозиториев. [API](https://api.github.com/search/code?q=filename%3Aplugin.json%20repo%3Aanthropics%2Fclaude-plugins-official&per_page=3) |
| `filename:plugin.json path:plugins/hookify/.claude-plugin repo:anthropics/claude-plugins-official` | `total_count=1`, `incomplete_results=false`; тот же вложенный manifest. [API](https://api.github.com/search/code?q=filename%3Aplugin.json%20path%3Aplugins%2Fhookify%2F.claude-plugin%20repo%3Aanthropics%2Fclaude-plugins-official&per_page=3) |

**Вывод из проверки:** `path:.claude-plugin` нельзя считать поиском любого одноимённого сегмента на любой глубине. Для root discovery всё равно нужен точный фильтр `item.path === ".claude-plugin/plugin.json"` и повторное получение файла. Это подтверждение поведения нескольких запросов, не доказательство полноты индекса.

Ограничения, существенные для контракта:

- До **1 000 результатов на запрос**, максимум 100 на страницу, по умолчанию 30. Это файлы, а не уникальные репозитории; `total_count` и `incomplete_results=false` не отменяют потолок. Общий REST-справочник также указывает поиск максимум по 4 000 подходящим репозиториям и возможность частичных ответов при timeout. [REST Search](https://docs.github.com/en/rest/search/search)
- Code Search: аутентификация и **10 запросов/мин** по основному тексту справочника; остальные authenticated search endpoints — 30/мин. Там же есть противоречащая шаблонная фраза о публичных запросах без auth; anonymous Code Search здесь не проверялся. Для crawler рассчитывать на authenticated доступ. [REST Search](https://docs.github.com/en/rest/search/search)
- Индексируется только **default branch**, не обязательно `main`; файлы меньше 384 KB. Архивные репозитории исключены, как и репозитории с 500 000+ файлами; есть ограничение активности/попадания в поиск за последний год. [Legacy Code Search](https://docs.github.com/en/search-github/searching-on-github/searching-code)
- Forks обычно исключены. `fork:true` / `fork:only` включает только индексируемые forks: больше звёзд, чем у родителя, и хотя бы один push после создания. Эти флаги не дают все forks. [Legacy Code Search](https://docs.github.com/en/search-github/searching-on-github/searching-code)
- Core REST: обычно 5 000/час с пользовательской аутентификацией, 60/час без неё; search-квоту это не увеличивает. Учитывать secondary limits, `Retry-After`, `x-ratelimit-remaining` и `x-ratelimit-reset`. [Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

**Рекомендация:** учитывать pagination, сохранение прогресса, насыщение/неполноту и дедупликацию отдельно. Не переносить repository-qualifiers `created:` / `pushed:` в Code Search: legacy допускает только code-qualifiers. Для известных кандидатов получать корневой manifest через Contents API; без `ref` он читает default branch, а для воспроизводимости можно закрепить commit. [Legacy Code Search](https://docs.github.com/en/search-github/searching-on-github/searching-code), [Contents API](https://docs.github.com/en/rest/repos/contents#get-repository-content)

## Три публичных примера: проверены файлы, не исполнение

Это целевая подборка, не случайная выборка и не оценка размера рынка. Ссылки закреплены на commit:

| Репозиторий | Корневой manifest | Стандартный marketplace |
| --- | --- | --- |
| `AgriciDaniel/claude-canvas` | [plugin.json](https://github.com/AgriciDaniel/claude-canvas/blob/05b808cafd906bb3b8ff1c597ed8cd33ff5145c0/.claude-plugin/plugin.json): `name=claude-canvas`, `version=1.0.0`, без явных component-путей | В [листинге `.claude-plugin/`](https://api.github.com/repos/AgriciDaniel/claude-canvas/contents/.claude-plugin?ref=05b808cafd906bb3b8ff1c597ed8cd33ff5145c0) только `plugin.json`; `marketplace.json` отсутствует. Пример ловушки установки. |
| `obra/superpowers` | [plugin.json](https://github.com/obra/superpowers/blob/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/.claude-plugin/plugin.json): `name=superpowers`, `version=7.0.1` | [marketplace.json](https://github.com/obra/superpowers/blob/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/.claude-plugin/marketplace.json): `name=superpowers-dev`, `source="./"`. Root plugin и marketplace сосуществуют. |
| `mksglu/context-mode` | [plugin.json](https://github.com/mksglu/context-mode/blob/baf6a5510790cba7e9d5c2f5399354f54a962bb1/.claude-plugin/plugin.json): `name=context-mode`, `version=1.0.169`, inline `mcpServers`, `skills="./skills/"` | [marketplace.json](https://github.com/mksglu/context-mode/blob/baf6a5510790cba7e9d5c2f5399354f54a962bb1/.claude-plugin/marketplace.json): `name=context-mode`, `source="./"`. |

## Неопределённости и границы доказательств

- Текущая документация не является зафиксированной спецификацией всех старых CLI. Особенно важно проверить минимальную поддерживаемую версию перед обещанием skills-directory / ZIP / `--plugin-url` способов; здесь их исполнение не проверялось.
- Для `claude-canvas` установлено отсутствие **стандартного корневого** marketplace на указанном commit; это не исключает публикацию через чужой marketplace или нестандартный источник. Совместимость имени и компонентов с текущим валидатором не проверялась.
- Глобальный запрос, полный обход, production-backfill и оценка количества standalone-плагинов не выполнялись. Утверждение «сотни пропущенных standalone-репозиториев» этими данными не подтверждается.
- Firecrawl был недоступен (`Unknown tool`); документация прочитана через веб-доступ, файлы и контрольные REST-запросы — через подключённый GitHub. Коммитов и удалённых изменений нет.

## Проверка реализации: ограниченный live-аудит 2026-11-01

После реализации выполнен `bun scripts/audit-standalone-plugins.ts` с существующей локальной GitHub-аутентификацией. Script не открывает SQLite и не публикует данные. Проверены первые 20 уникальных корневых кандидатов из первой страницы generic `filename:plugin.json path:.claude-plugin size:0..400000`:

- 1 фактический Code Search запрос, 26 core-запросов; 100 файлов в ответе, 20 кандидатов проверены; среди обработанных нет вложенных путей.
- 6 кандидатов приняты standalone parser после marketplace 404; остальные 14 имеют marketplace. Это целевая ограниченная выборка, не оценка доли во всём GitHub.
- Продолжительность 23 163 ms; учтённые ожидания rate budget — 10 165 ms; retry waits — 0.
- `complete: false`, warning `saturated`: search ceiling и лимит 20 кандидатов исключают вывод о полноте.
- Дополнительно прочитаны plugin manifests и README у `grafana/mcp-grafana`, `antonbabenko/terraform-skill`, `yzy1996/english-writing`; код плагинов не запускался.

Сквозные offline integration tests отдельно проверяют запись в SQLite и валидный draft snapshot для кандидатов из Code Search и Repository Search. Браузерные доказательства используют детерминированный standalone fixture на detail-маршруте `mksglu/context-mode`; это не утверждение о текущем upstream manifest этого репозитория. [Desktop](../evidence/standalone-plugin-desktop.png), [mobile](../evidence/standalone-plugin-mobile.png).
