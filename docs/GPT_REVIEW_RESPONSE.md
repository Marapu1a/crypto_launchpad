# GPT Review: общий бэкенд Crypto Launchpad и подключение QIANQI

Дата: 09.10.2026. Объект ревью: `Marapu1a/crypto_launchpad`, `main@0124d49dba4d27160da4949a36d333c1172e07eb` (запрос в `docs/SHARED_BACKEND_REVIEW_BRIEF.md`, базовый рабочий код `68eaa6e`). Для совместимости дополнительно прочитаны отдельные файлы `Marapu1a/rh_project` (текущие доступные в GitHub); старый QIANQI-аудит 05.10 использован как датированный контекст, **не как live-state**.

**Статус:** независимое архитектурное предложение, **не принятое владельцем решение**. Только чтение исходников и документов через GitHub. Тесты, RPC, сервер, реальные транзакции и состояние production QIANQI не проверялись. Код контрактов, работающих на сети, не менялся.

## 1. Вердикт

Идея оправданна, если цель — **личный конструктор нескольких токенов**, а не SaaS для чужих операторов. Экономия приходит прежде всего от повторного использования разработки, серверного окружения, доступа к блокчейну, мониторинга и деплоя сайтов. Сама сеть, газ, on-chain права и финансовые обязательства на каждом токене не становятся общими.

**Рекомендация для первого многопроектного этапа: один VPS, одна PostgreSQL, общий read-only API и процесс получения сетевых свидетельств, плюс независимые по состоянию финансовые исполнители проектов.** Разделять **процессы/ключи** финансового исполнения, но не поднимать отдельный API, БД, прокси и полный стек на каждый токен. Пока токенов мало, исполнители могут быть отдельными systemd-инстансами на одном сервере, запускаемыми по готовности. Kubernetes, Redis, Kafka, микросервисы, второй активный сервер и отдельные БД на каждый токен сейчас не нужны.

При этом общий VPS — **единая точка отказа**, а общая БД — **единая зона администрирования и резервного копирования**. Такая конструкция обеспечивает локализацию ошибки проекта, но не независимость от аварии/компрометации хоста. Не обещать большей изоляции, чем реально есть.

Схема:

```text
                        Pons / Robinhood Chain / drand
                                     |
                         Shared chain ingester
                     blocks / receipts / evidence
                                     |
                         PostgreSQL (1 instance)
                    canonical chain + project data
                           /                \
               read-only API            job scheduler
            host -> project_id          per-project cursors
               |                         /         \
          subdomains/site         QIANQI adapter   New token adapter
                                      |                 |
                                signer worker A   signer worker B
                                existing roles    dedicated key/roles
                                      |                 |
                              on-chain obligations per project
```

Общий API и ingester **не должны загружать приватные ключи**. Финансовый исполнитель — отдельный процесс и отдельные права к БД. Отдельные signer-процессы логичны ради ограничения ошибок/секретов; общий код, сервер и службы при этом сохраняются.

## 2. Границы изоляции

| Ресурс | Совместно | Строго по проекту |
|---|---|---|
| VPS, reverse proxy, HTTPS, observability | Да | DNS/host mapping, лимиты и health каждого |
| Сеть / канонические headers / сырые receipts | Да, если chain_id одинаков | Интерпретация BUY, policy, credit и cursor применения |
| Доступ к drand | Можно кэшировать beacon и BLS evidence | Request, context, round binding, outcome |
| БД | Один сервер, общие таблицы | project_id, права, constraints, transactions |
| Контракты и средства | Нет | Deployment/runtime pins, получатели, balances, obligations |
| Финансовое исполнение | Библиотеки кода и scheduler | Состояние, журнал, nonce ownership, ключ, очередь |
| Frontend | Шаблоны/код можно повторять | Тексты, домен, branding, enabled features, ответы API |

Инвариант: **никакая настройка другого проекта не может изменить budget, билет, RNG-контекст, recipient или исход уже созданного обязательства.**

Заявлять эту изоляцию без проверок нельзя. В частности, общий административный доступ к БД или root на VPS обходит прикладные ограничения.

## 3. Минимальное хранение

Я бы выбрал **PostgreSQL с общими таблицами и обязательным project_id**, а не отдельные schemas/DB на токен. Причина — общие миграции, единые транзакции, уникальные ограничения, блокировка конкретной задачи/отправителя и простая аналитика. Отдельные схемы усложнят поддержку модулей и миграций, но не защитят от root/DB-admin. SQLite подходит для одиночного демо, однако очереди, несколько независимых writers, recovery и будущий QIANQI делают его скорее промежуточной архитектурой. Установка PostgreSQL на том же VPS не требует отдельной лицензии/сервера.

**Логическая схема (не предлагаю немедленно создавать все таблицы):**

- `projects`: `id`, статус, owner, network, token address, фактический launch anchor, domain, применённый adapter и immutable deployment profile.
- `module_instances`: `project_id`, тип и **версия** Short/Monthly/другой программы, config hash, addresses/runtime hashes/role bindings.
- `chain_blocks`, `chain_transactions`, `chain_receipts` / evidence refs: глобальная идентичность сети, полные позиции и canonical/branch history. Большие trace/bundles допускается хранить отдельно с content hash и доступным backup.
- `project_sources`, `project_cursor`: watched addresses/decoder versions и отдельно последнее **доказанно применённое** событие. Это не глобальный RPC cursor.
- `purchase_decisions` и `purchase_credits`: source evidence, reason, policy version, wallet, actual raw amount, original block/tx, `creditedAt`; обязательная идемпотентность. Unsupported/ambiguous не превращать в eligible по имени DEX.
- `ticket_ledger` / `attempts` и `draw_snapshots`: carry, OPEN/FROZEN/CONSUMED, cutoff blockHash, participants hash, правила, on-chain draw id и source evidence.
- `financial_obligations`: тип, frozen/reward/claimable, on-chain origin и status. **БД отражает обязательства контрактов, а не создаёт возможность выплачивать по своему усмотрению.**
- `signer_intents`, `signer_transactions`: (chain, signer, nonce), action identity, exact signed bytes/hash, state, canonical receipt, failure; nonce-сериализация и recovery.
- `jobs`, `project_health`, `audit_events`: состояние каждого проекта и его lane, без прав смешивать средства.

Ограничения в БД, которые важнее красивых названий: составные foreign keys с `project_id`, уникальность (project, source event identity, policy/credit identity), (project, draw, wallet, payout obligation), (chain, signer, nonce), запрет второго **незавершённого intent** для одного signer, только монотонные переходы закреплённых финансовых состояний. Фактический natural key покупки зависит от route decoder и может содержать execution path/call index, а не только txHash/logIndex; до его утверждения нельзя искусственно дедуплицировать разные допустимые покупки одной tx. Суммы — целые raw units / NUMERIC, никакого JS float для средств.

**Граница доступа:** host → серверная allowlist привязка к project_id; не принимать произвольный `project_id` из query/body как право доступа. Административные API требуют своей авторизации и проекта в scope; origin/CORS/поддомен не являются авторизацией. Cache key включает chain_id, project_id, версию, а для block-derived ответов — blockHash/cutoff. SQL запросы и jobs должны явно фильтровать project_id. Полезна PostgreSQL RLS как вторая линия обороны под отдельными service roles (без BYPASSRLS; для владельца таблиц учесть FORCE RLS), **но не как замена проверке области доступа в коде**.

Не хранить приватные ключи, RPC credential URLs или signed raw bytes в публичных/API таблицах и логах. Для finance journal raw bytes нужны до reconciliation, после — можно удалить; backup имеет те же требования к секретности.

## 4. Общий scanner — не общий ledger

Нужны **три независимых прогресса**:

1. Каноническая цепь: полученные headers/receipts/logs, диапазон, hash/finality, выявленные gaps и переорганизации.
2. Для каждого проекта: до какого canonical block и какими версиями adapters применены доказательства BUY/recognition/funding.
3. Для каждого финансового модуля: до какого cutoff закреплены snapshots, draws и obligations.

Один поступивший receipt можно прочитать/кэшировать единожды и отдать разным проектам. Но чужой токен не должен блокировать прием блока или изменять результат разбора. При ошибке decoder только его `project_cursor` и новые freeze останавливаются. Уже признанные on-chain obligations обрабатываются по отдельным правилам и не исчезают.

**Важная граница текущего кода:** `src/tickets/scanner.mjs` сканирует полные блоки и receipts всех транзакций, максимум 500 блоков за вызов. Это допустимая локальная реализация, **не масштабируемая стратегия «по одному scanner на токен»**. В общей модели сначала собираются релевантные события/кандидаты и полные необходимые evidence, затем версии admission decoder независимо проверяют calldata, payer/recipient, refunds, smart-account/7702 контекст. Не сводить идентификацию BUY к одному ERC-20 Transfer. Отбор кандидатов не должен пропускать подтверждаемую форму маршрута из-за слишком узкого фильтра.

Reorg: сохранить последние canonical hashes и защитный хвост, перепроверять branch, отвязать незакреплённые проекции и детерминированно переигрывать соответствующие проекты. Если на новой ветке нарушается **уже закреплённый** draw/credit/confirmed transaction, остановить этот проект для reconciliation, не делать silent rollback, смену seed или повторную выплату. `finalized` от RPC — доверенная граница провайдера, не независимый консенсус. Полный range audit нужен для поиска **пропущенных** логов; checksum файла от этого не защищает.

Для QIANQI особенно важно: `originalBuyAt` и **`creditedAt` не взаимозаменяемы**. Late recognition даёт билет на будущее, но не переписывает frozen draws. Shared ingester может быть общий, а decoder/apply/checkpoint — только versioned project-specific.

## 5. Executor, nonce и процессы

**Рекомендую отдельный signer на новый токен**, если контрактные роли позволяют. Новый EOA дешевле для архитектуры, чем универсальная nonce-очередь с общими обязательствами: ошибки и отсутствие газа/зависший nonce тогда локализованы. Разные EOA не удваивают gas on-chain операций. Их нужно **отдельно пополнять ETH**; это капитал, мониторинг и custody, не бесплатная оптимизация.

**Для QIANQI не навязывать новый signer.** Аудит 05.10 фиксировал immutable publisher у recognition source. Действительные роли, executor и runtime надо сверить по сети до cutover. Если publisher/другие роли не меняются, QIANQI adapter обязан работать с существующими адресом и правами. Ротация не должна быть условием переезда.

Если когда-либо решим использовать **один signer на несколько проектов**, сначала нужен **единственный sender service / nonce coordinator** с общей durable очередью для всего (chain, address), одной областью signing authority, запретом конкурентных writers и подробным восстановлением unknown tx. Несколько независимых worker-processes с одним EOA и файловыми lock **на разных roots/машинах небезопасны**. Прямо сейчас общий EOA не рекомендую.

Executor делает: resolve old pending/reward → проверить canonical history и runtime/roles → получить lease **с fencing epoch** на проект и sender → зарезервировать/подписать exact intent и durable commit → broadcast → reconcile receipt/finality → обновить projection → только потом новый action. DB transaction не атомарна с блокчейном: **«exactly once» обеспечивается сочетанием on-chain инвариантов, единственного signer writer, nonce/hash журнала и проверки уже случившегося действия**, а не волшебным `COMMIT` в SQL.

Потерянный ответ RPC: не выдавать новый nonce и не подписывать «то же» заново с новым hash. Допустима отправка прежних сохранённых bytes после проверки. Чужой consumed nonce, mismatched receipt, изменение runtime, reorg или утерянный pending journal — **fail closed + оператор**. Для разных процессов нужен не только TTL lease, но и fencing плюс сериализация по signer; истечение lease не даёт второму процессу право слепо переслать действие. Восстановление зависит от фактической on-chain позиции.

Минимальная эксплуатация: `api`, `chain-reader`, `scheduler`, `executor@qianqi` и `executor@token-N` — **службы на одном хосте**, не отдельные сервера. Если количество экземпляров растёт, запускать finance process по запросу, а не держать N прожорливых циклов. Тяжёлый sync/replay — вне event loop публичного API. Упавший/застрявший проект не останавливает остальные, **кроме общей аварии RPC/БД/хоста**.

## 6. Механики и версии

QIANQI — **existing deployment with an adapter**, а не default settings. Новый токен имеет свои 2% creator fee, split 80/15/5, 10 USDG на entry, фонд 50 USDG, 24-часовой Short с одним слотом и ненулевой вероятностью отсутствия победителя. Эти правила **не должны попадать в QIANQI**: там 3%, 90/5/5, 100 USDG/entry, Short/Monthly с иной математикой и отдельными obligations.

Нужно различать:

- `ModuleDefinition`: код версии и digest, контрактная логика, правила admissibility/settlement, совместимая миграция индекса.
- `ModuleInstance`: immutable deployed адреса/role bindings/rounds/token quote и **параметры этого экземпляра**.
- `CycleSnapshot`: зафиксированная версия, параметры и cutoff для конкретного draw; обновления кода worker не меняют его.
- `ProjectAdapter`: совместимость с live QIANQI V2 и новым LocalShort-V1, не попытка унифицировать несовместимые контракты путём «умных» if-веток внутри одного глобального worker.

Любое изменение будущих правил — отдельная согласованная version transition (и on-chain notice, если требуется), а не редактирование конфигурации после freeze. Выплата по старому обязательству должна работать после появления новой версии.

## 7. QIANQI: shadow и безопасное переключение

**Не переносить QIANQI сейчас в общий финансовый worker.** Реальную устойчивость системы и состояние production на 09.10 этот обзор не проверяет. План:

1. **Inventory без отправок:** fresh on-chain addresses, chainId, runtime hashes, source/version, immutable recognition publisher, controller roles, current configs и policies, backup/state/checkpoints, signer sender/nonce, unresolved intents, frozen draws, rewards, open tickets, recognition bundles, installed runtime release (не путать с GitHub main).
2. **Adapter read-only:** новый бэк читает QIANQI в sidecar mode; отдельно прогоняет соответствующую legacy логику. **Никаких shared подписей, confirm recognition, freeze, claims и sweep.**
3. **Shadow на одинаковом finalized blockHash:** сравнивать не только итоговые balances, но и список BUY/unsupported и creditedAt, carry, OPEN/FROZEN/CONSUMED, frozen datasets/hash, funding pockets, active rounds, reserve/claimable, already-paid reward, receipts и pending. Несовпадение классифицировать, не «чинить» игнорированием.
4. **Fault drill:** остановка одной projection, reorg в тестовом контуре, неполные RPC logs, restart, повреждённый bundle, mid-send interruption — другой проект продолжает. Тот же источник данных не является независимой проверкой полноты, это паритет интерпретации.
5. **Cutover только по отдельному решению:** остановить старый **sender**, зафиксировать safe block/installed config, сверить latest/pending nonce и signed-intent journal, отсутствие второго активного writer, chain obligations и publisher roles. Если pending не разрешён — переключение **не начинать**. Новый sender вводится только после доказанного handoff с той же authority/контрактами.
6. **Rollback не копированием старого файла:** прежде чем вернуть старый sender, нужно воспроизвести операции, уже отправленные новым, и reconcile current chain; оба не могут быть активны одновременно. Если надёжный handback не проверен, считать переключение необратимым операционным событием и не спешить с ним.

Сайт `qianqi.site` и существующие контракты менять ради общего бэка необязательно. Финансовую миграцию нельзя привязывать к смене домена.

**Особый риск:** live QIANQI содержит Short+Monthly, external recognition publisher и 90/5/5 vault accounting, тогда как локальный worker платформы поддерживает только один Short, один quote и другие роли. «Скопировать workflow и поменять config» недостаточно и может привести к ошибке, даже если read-only shadow показывает одинаковый баланс токена.

## 8. Что показал текущий код новой репы

**Сохранять как проверенные паттерны:**

- `src/worker/journal.mjs` сохраняет signed bytes/hash/nonce **до broadcast**, восстанавливает ту же транзакцию и проверяет on-chain receipt.
- `src/worker/local-worker.mjs` сверяет runtime/bindings и отдаёт приоритет старым claimable obligations.
- `src/tickets/ledger.mjs` считает integer carry и отделяет credit от расхода attempts.
- `src/tickets/scanner.mjs` закрепляет snapshot с cutoff/hash и останавливается при нарушении branch.
- `LocalFeeSplitter.sol` распределяет реально полученные средства, округляя от **накопленного revenue**, а не от каждого малого поступления.
- Адаптер/публичный API отделён от финансовых отправок, и документы ясно различают fork и mainnet.

**Не переносить как есть в production multi-project:**

- `src/worker/local-worker.mjs`: `assertLocalFork` / chain 31337, один stateRoot, один dedicated signer; sender lock привязан к локальному fork instance и общему каталогу.
- `src/worker/storage.mjs`: локальные file locks/checksums/atomic rename не создают distributed mutual exclusion, транзакционные constraints и надежную миграцию между хостами. В частности, pid/host recovery — ручной, не отказоустойчивая выдача lease.
- `src/tickets/scanner.mjs`: чтение каждой транзакции/receipt полных блоков и накопление `blocks[]` в JSON; при большом количестве токенов копирование этого на каждый экземпляр умножает RPC, память и replay.
- `server/api.mjs`: сейчас только prepare/image-check; нет project-scoped auth, API для билетов/рекордов, job tenancy, limits финансового администрирования. Его `Origin == Host` — не модель авторизации проектов.
- `journal.mjs`: запись raw signed payload в локальный state без секретов в API — правильно для аварий, но текущая локальная схема ещё не проект custody/ACL/encrypted backup и централизованного sender lease.
- Tests на историческом fork не подтверждают mainnet finality, неизвестные Pons routes, ingress completeness или устойчивость единого VPS под нагрузкой.

**Риск, который легко недооценить:** при общем ingester недостаточно изолировать кошельки. Ошибка project routing/authorization или неправильный cache key может показать не те билеты, а ошибочная project configuration/worker binding — исполнить не тот финансовый action. Без проверяемых уникальных identity на каждом слое это опаснее, чем обычная ошибка фронта.

## 9. Реальная экономия и метрики

**Можно экономить:** на совместном блокчейн-ingest (дубликаты запросов/receipts), одном VPS/PostgreSQL/reverse proxy/TLS/backup/watchdog, общих библиотеках, reusable site templates и отсутствии отдельных ручных релизов.

**Не исчезают:** gas, начальный призовой капитал, ETH на executor, эксплуатация on-chain контрактов, различные route decoders, security review каждой версии финансовых механик, независимые права и подписи, восстановление каждого проекта.

Измерять до/после на фиксированном наборе workload, не придумывая долларов: RPC calls/ответы/byte, % повторных receipts, blocks/сек, project application lag, pass p50/p95, bytes и рост evidence/day, save/replay p95, CPU peak и RSS для N токенов, pending actions/age, финальность и время до credit, ETH gas per financial cycle, длительность backup/restore и время операторского вмешательства. Отдельно оценить доступность **самого хоста**: общий монитор на этом же VPS не обнаружит его полную потерю без внешнего watchdog.

## 10. Маленькие проверяемые пакеты

Это **предложенная очередь, а не приказ реализовать всё сразу**.

**Пакет 0 — зафиксировать contract boundary (только документы).** Согласовать project identity, immutable instance/version/profile, какие операции разрешены read-only, какая система является владельцем writer и signer. Вести единый список открытых решений без изменения продукта.

**Пакет 1 — isolation skeleton без денег.** PostgreSQL migrations: projects, module_instances, cursors, jobs; host→project mapping; read-only API; два синтетических проекта с одинаковыми кошельками, разными адресами программ. Тест: cross-project query/cache/job/host **не читает и не меняет** чужой state. API без ключей. Подтвердить backup/restore схемы.

**Пакет 2 — shared read pipeline.** Один reader получает необходимые блоки/receipts, сохраняет canonical hash/evidence. Два decoder/apply consumer держат отдельные cursors. Тесты: пропущенные logs, divergence, reorg, backlog проекта А, проект B продолжает; recognition creditedAt и freeze cutoff совпадают с исходным reference. RPC metrics показывают, есть ли реальная экономия.

**Пакет 3 — financial executor boundary на локальном fork.** Отдельные процессы/ключи, БД journal, один sender writer per EOA, recovery signed intent, lease/fencing, receipt reconciliation. Kill до/после broadcast, restart, чужой nonce, drift, reverted tx, финальность. Проверять отсутствие дублей **на контракте**, не только записи в SQL.

**Пакет 4 — QIANQI shadow только read-only.** Обновить фактический profile/roles/runtime с сети; сопоставить старый и новый ledger/obligations на одинаковой finalized высоте, архивировать детерминированные diff/evidence. QIANQI sender остаётся старым.

**Пакет 5 — production readiness отдельного нового токена.** До реальных денег закрыть wallet/IPFS/deployment UI, реальные маршруты после graduation, policy finality, watchdog/backup, signer custody, recovery, публичные обещания BUY coverage. QIANQI cutover — **отдельный, более поздний** пакет, только после длительного паритета и согласованного runbook.

Не начинайте с обобщения всех QIANQI контрактов, с новой БД на каждый проект или с автоматического переноса production: это создаст больше поверхности риска, чем экономии.

## 11. Что ещё неизвестно и что действительно влияет на решение

1. Фактическое состояние **live QIANQI на день миграции**: installed release, node/chain manifests, текущие роли и signer authority, last finalized state, pending tx, активные Short/Monthly, events recognition. GitHub не заменяет эти данные.
2. Сколько токенов одновременно планируется обслуживать и какой максимум BUY/tx, насколько допустимы задержки credit/draw/payout. Это определит нужен ли worker pool и насколько велик ingester.
3. Сколько ресурсов даёт нынешний VPS, какова цена одного независимого RPC чтения, есть ли archive/finality limits, готов ли off-server backup и restore.
4. Будет ли **единый оператор-владелец всех проектов** (текущая цель) либо сторонние пользователи с правами изменять deployment/settings. Для второго случая понадобится более строгая аутентификация, tenancy и threat model; не проектировать SaaS заранее.
5. Возможен ли безопасный handoff для **каждой immutable роли** QIANQI без замены on-chain кода. Если нет, допускается длительный вариант: общий API/ingest/мониторинг при отдельном существующем QIANQI executor.

Ни один из этих вопросов не мешает **Пакету 1**. Они мешают обещать «готовый общий финансовый бэк» и назначать дату переключения QIANQI.

## 12. Сводное решение для владельца

**Выбрать архитектурный ориентир:** один сервер + PostgreSQL + общий доказательный слой сети + проектные versioned adapters + независимые процессы финансового исполнения и ключи. Не создавать абстрактный «контракт любого токена» и не смешивать financial journal между projects. Начать с Пакета 1: project identity, storage constraints и изоляция API/job/cache на **двух локальных проектах**, без транзакций. После этого обсуждать следующий пакет по фактическим результатам.

### Прочитанные источники

Новая платформа на `main@0124d49`:
- [AGENTS.md](../AGENTS.md), [CURRENT_CONTEXT](CURRENT_CONTEXT.md), [SHARED_BACKEND_REVIEW_BRIEF](SHARED_BACKEND_REVIEW_BRIEF.md), [PRODUCT_SPEC](PRODUCT_SPEC.md).
- [LOCAL_WORKER](LOCAL_WORKER.md), [PONS_COVERAGE](PONS_COVERAGE.md), [LATE_RECOGNITION](LATE_RECOGNITION.md).
- [local-worker.mjs](../src/worker/local-worker.mjs), [journal.mjs](../src/worker/journal.mjs), [storage.mjs](../src/worker/storage.mjs), [scanner.mjs](../src/tickets/scanner.mjs), [ledger.mjs](../src/tickets/ledger.mjs), [api.mjs](../server/api.mjs), [LocalFeeSplitter.sol](../contracts/draws/LocalFeeSplitter.sol).

Существующий QIANQI: [AGENTS](https://github.com/Marapu1a/rh_project/blob/main/AGENTS.md), [CURRENT_CONTEXT](https://github.com/Marapu1a/rh_project/blob/main/docs/CURRENT_CONTEXT.md), [PRODUCT_SPEC](https://github.com/Marapu1a/rh_project/blob/main/docs/PRODUCT_SPEC.md), [pons-automation](https://github.com/Marapu1a/rh_project/blob/main/scripts/pons-automation.cjs), [transaction-journal](https://github.com/Marapu1a/rh_project/blob/main/scripts/pons-transaction-journal.cjs), [recognition-worker](https://github.com/Marapu1a/rh_project/blob/main/scripts/recognition-worker.cjs), [persistent-buy-indexer](https://github.com/Marapu1a/rh_project/blob/main/scripts/persistent-buy-indexer.cjs). Старый независимый аудит QIANQI: 05.10.2026, `ae445254...`; более свежие значения и серверная конфигурация **не были верифицированы этим ревью**.
