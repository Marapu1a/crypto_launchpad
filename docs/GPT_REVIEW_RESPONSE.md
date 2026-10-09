# Ответ GPT для Codex: аудит handoff QIANQI — проблемы и исправления

**Контрольная точка:** 10.10.2026, `main@5dcfecec77095345f91e380163e84dfb11bbda08`. Основание: `docs/QIANQI_PLATFORM_HANDOFF_REPORT.md` и адресное чтение code/ops текущего репозитория. Это **новое ревью после миграции**, оно заменяет прежнюю архитектурную записку в этом файле; та сохранена в Git history (commit `df6a307`).

**Поручение владельца:** разобрать находки и исправить реальные недостатки небольшими проверяемыми пакетами. В первую очередь — надёжность backup/alerts и безопасность единственного исполнителя QIANQI. Не переписывать весь backend, не менять экономику, контракты, участников, seed, признанные credits, состояния розыгрышей или правила QIANQI. Рабочую production-систему не останавливать ради эксперимента: воспроизведение отказов — на изолированном стенде/копиях. Live изменения — только после адресных тестов, с rollback/backup/зафиксированными исходными условиями.

## Что уже подтверждено / чего не утверждаем

**Подтверждено отчётом команды:** в `QIANQI_PLATFORM_HANDOFF_REPORT.md` отмечены остановка старого исполнителя до старта нового, успешный новый waiting pass, nonce latest/pending=85, отсутствие новых отправок за контрольное окно, паритет overview/53 wallet API, verified native/platform backups и отдельные restores. Новый API обслуживает `/v1` из PostgreSQL; **финансовый журнал и scanner QIANQI остались native файловыми**. Новые Short/Monthly/reward транзакции после handoff не были проверены на реальном потоке. Эти факты **не** подтверждались мной независимым SSH/RPC/live-аудитом.

**Положительное по коду:** `server/adapters/qianqi/executor.mjs` берёт PostgreSQL session advisory lock, а `runtime/scripts/local-receipt.cjs` и `runtime/scripts/pons-transaction-journal.cjs` проверяют execution fence до новой подписи/отправки и после сохранения подписанного intent. Hash/nonce journal сохраняется до broadcast; on-chain obligations и native state не обнулены. Выявленная проблема — не «отсутствие journal» и не доказанная двойная выплата.

**Метод ревью:** адресное статическое чтение; тесты, SSH, SQL, RPC и серверные команды мной не выполнялись. Каждый пункт ниже имеет степень уверенности и ссылку на код. Пожалуйста, при исправлении укажите ревизию, точные тесты и runtime boundaries; не называйте локальные fault-tests боевым фактом.

## P1 — реальный сценарий: неудачный native backup оставляет индексатор и executor остановленными

**Источник:** [ops/qianqi/backup-public.sh](../ops/qianqi/backup-public.sh). `set -euo pipefail`, после `systemctl stop` идут helper/копирования/архивирование/sha256, а `systemctl start` находится только в успешном конце. Нет `trap`/`EXIT`-обработки для состояния «перед stop активны, после сбоя оставлены stopped». Проверка manifest/helper **до остановки** уже добавлена, это хорошо, но ошибка `ENOSPC`, `cp`, `tar` или `sha256sum` после stop всё ещё возможна. Это **подтверждённый по коду fail-closed путь**, не доказанный текущий production incident.

**Рекомендации:**

1. Сохранить принцип *fail closed*: **не делать безусловный restart financial executor после любой ошибки backup**. Ошибки могут означать неполную/непроверенную копию или незавершённый journal.
2. Сначала вынести проверки, не требующие остановки writers, в preflight: свободное место/inodes, writable destination, ожидаемые state/release paths, verifier, manifest/config hash, доступность off-server pipeline. При непрохождении предчека активные службы не трогать.
3. После stop вести durable итог `backup_status` с таймштампом/step/error/списком `was_active`, явным `backup_failed_services_stopped` и **обязательной тревогой** оператору. Exit code не должен означать success при incomplete backup. Статус переживает перезапуск timer/процесса.
4. Сделать **узкий безопасный resume**, только когда после ошибки можно доказать неизменность/целостность native state и нет unresolved intent/несогласованных blocks/locks; иначе оставить остановленным, записать причину и выдать конкретный runbook для ручного восстановления. Для не-финансового indexer допустимость отдельного рестарта решить отдельно.
5. Тесты-инъекции после stop: failure helper, `cp`, `tar`, недостаток диска, повторный timer, SIGTERM/kill; assert отсутствие ложного `BACKUP_OK`, сохранность прежних файлов, корректные уведомления и строго определённое состояние обеих служб. В production не запускать такие инъекции.

**Acceptance:** на штатном backup службы возвращаются к исходной активности; на каждом отказе после остановки нет молчаливой потери работы, и доказано, почему разрешён или запрещён restart. Новые транзакции/изменения экономики не требуются.

## P1 — обнаружение простоев и ошибок: монитор пишет JSON, но не поднимает тревогу сам

**Источник:** [ops/shadow/monitor.py](../ops/shadow/monitor.py). Программа собирает `systemctl show` и HTTP `/v1/overview`, при исключении HTTP пишет `{"status":"UNAVAILABLE"}`, затем печатает имя файла и в обычном LIVE-режиме завершается успешно. Она **не отправляет алерт и не завершает процесс ошибкой из-за unavailable API или неактивного executor/indexer**. `ops/shadow/backup.sh` при занятом `flock` вообще может завершиться с кодом 0, не выполнив backup; это надо учитывать при мониторинге успешности, не объявляя любой пропуск сбоем.

**Граница вывода:** возможно, в прежнем QIANQI уже есть отдельные Telegram alerts. Их конфигурацию/работу на live-сервере я здесь не проверял. Не дублируйте существующие оповещения и не объявляйте, что «алертов вообще нет», пока не проверите всю цепочку.

**Рекомендации:**

- Сделать alert по **последнему успешному native backup**, возрасту/целостности off-server копии, состоянию `qianqi-public-automation` и `qianqi-public-indexer`, API `observed/stale/unavailable` и age/lag относительно chain. Развести planned backup-stop и длительный незапланированный простой, сделать dedup/rate limiting.
- Переиспользовать существующий notifier/Telegram, если он действительно работоспособен после handoff. Проверить доставку **реальным тестовым событием** без финансовой транзакции.
- Добавить **внешний** dead-man/watchdog для полной потери VPS. Timer на том же VPS не может сообщить о собственной полной недоступности.
- Проверить, что статус timer `last-success` отражает успешное завершение проверенного архива, а не факт запуска/создания каталога. Если пропуск из-за lock допустим, метрика age-of-last-verified backup всё равно обязана расти.

**Acceptance:** локально воспроизведённые crash/HTTP failure/no-backup дают один своевременный и понятный сигнал, recovery даёт разрешение инцидента. Уведомления не содержат credentials/keystore/сырой signed transaction.

## P1/P2 — не атомарны native файлы и PostgreSQL projection/backup: нужен runbook согласованного restore

**Источники:** [ops/qianqi/backup-public.sh](../ops/qianqi/backup-public.sh), [ops/shadow/backup.sh](../ops/shadow/backup.sh), [server/adapters/qianqi/read-model.mjs](../server/adapters/qianqi/read-model.mjs), [docs/QIANQI_PLATFORM_HANDOFF_REPORT.md](QIANQI_PLATFORM_HANDOFF_REPORT.md). Native backup останавливает indexer+executor и копирует filesystem state; platform backup независимо получает `pg_dump launchpad_shadow` и public projection. Нет общей атомарной точки на весь двухкомпонентный снимок.

**Это риск восстановления, не доказанная порча.** Возможны разные поколения: PG projection впереди восстановленного native index или наоборот; уже опубликованные on-chain действия отсутствуют в старом backup; API временно читает сохранённое «observed» прошлой высоты, хотя financial sender нельзя запускать по устаревшему nonce. Текущий `publishSnapshot` запрещает более низкий head и иную ветку на равном head, что хорошо, но сам по себе этот guard не превращает отдельные архивы в совместный checkpoint. Отдельный restore `pg_dump` успешно проверялся, **финансовый исполнитель на восстановленной БД не запускался**.

**Рекомендации:**

1. Зафиксировать manifest *набора* backup: UTC, native state checksums, DB dump checksum, pinned config/instance/runtime hashes, QIANQI chain anchor, observed finalized head/hash для index/API, latest/pending nonce и unresolved intents, значения активных Short/Monthly обязательств. Не создавать фиктивную «атомарность» записей, снятых в разное время.
2. Написать safe recovery preflight **без подписи/отправки**, который читает восстановленные native state + БД и перечитывает on-chain canonical blocks, актуальные nonce, frozen/claimable rewards, recognition commitments. Любой конфликт блокирует financial executor.
3. Если PG public projection новее восстановленного native index — обеспечить документированную безопасную переиндексацию / reconstruction и републикацию, а не принудительный «записать более старый head» или автоматическую подмену chain state. Если native state новее PG — догнать projection, сохранить monotonic branch proofs. Все меры только после reconciliation.
4. Отдельно отработать **устаревшую пару архивов** на стенде: поздняя покупка/recognition, уже выплаченная reward, pending signed intent, DB старше/новее native; гарантировать отсутствие повторной выплаты и корректную работу API. Старые архивы не разворачивать поверх live без контроля.
5. Runbook обязан объяснять порядок запуска indexer, API, затем **только после проверки** единственного executor. Для полного восстановления также нужны отдельные custody/credentials, не включать их в публичные архивы.

**Acceptance:** stage restore гарантированно останавливается при конфликте поколений; на согласованных копиях можно восстановить read-only API и затем разрешить sender строго по on-chain состоянию. Не требовать для этого настоящей покупки QIANQI.

## P2 — две версии runtime и обход нового signer fence

**Источники:** [server/adapters/qianqi/executor.mjs](../server/adapters/qianqi/executor.mjs), [server/adapters/qianqi/fence.cjs](../server/adapters/qianqi/fence.cjs), [scripts/run-qianqi-executor.mjs](../scripts/run-qianqi-executor.mjs), [server/adapters/qianqi/runtime/scripts/local-receipt.cjs](../server/adapters/qianqi/runtime/scripts/local-receipt.cjs), [server/adapters/qianqi/runtime/scripts/pons-transaction-journal.cjs](../server/adapters/qianqi/runtime/scripts/pons-transaction-journal.cjs), [docs/QIANQI_PLATFORM_HANDOFF_REPORT.md](QIANQI_PLATFORM_HANDOFF_REPORT.md).

**Конкретная граница:** новый `checkFence()` вне AsyncLocalStorage-контекста просто возвращает (см. `if(check)`), а **старый** `rh_project` runtime вовсе не участвует в новом PG lock. Два одинаково настроенных процесса используют старый файловый process lock и в штатном сценарии не должны запуститься одновременно. Но при ручном старте старого release с иным `statePath` или при чужом nonce writer PostgreSQL lock их не блокирует. Это **операционная возможность обхода**, не факт, что сейчас работают два sender. Не утверждать, что PG advisory lock гарантирует эксклюзивность любого процесса, которому доступен приватный ключ.

**Рекомендации:**

- Проверить live systemd units/drop-ins, timers, cron, старые launchers, права к keystore/password и реальные пути state, перечислить **единственные авторизованные источники отправки**. Убрать/запретить auto-активацию старого writer без удаления проверенного rollback release.
- В production wrapper иметь обязательный fence и fail-closed семантику для **всех его штатных send-paths**; локальные unit/fork fixtures не ломать глобальным запретом, нужны адресные guards и тесты.
- В runbook rollback: сначала гарантированно остановить новый, reconcile pending+nonce и файлы, только затем разрешать старый. Не переключать через копирование старого state и не откатывать работающие obligations.
- Если тестируете два процесса, проверяйте отсутствие **разных** signed payload для одного (chain, sender, nonce) и отсутствие двух активных финансовых writers. Не запускайте два настоящих sender на live.

**Acceptance:** демонстрация, что стандартный и аварийный сценарии запуска не приводят к двойному writer. Если невозможность ручного обхода без аппаратной custody недостижима, явно оставить ограничение и защитить права OS/секреты, а не писать «exactly once доказано PostgreSQL lock».

## P2 — после handoff ещё нет production-доказательства нового финансового действия

**Источник:** [docs/QIANQI_PLATFORM_HANDOFF_REPORT.md](QIANQI_PLATFORM_HANDOFF_REPORT.md). Во время handoff nonce `85→85`, `pending=0`, `steps=0`, последующие новые real Short/Monthly/recognition не проверялись. Это **пробел доказательств, а не баг**. До миграции существовали реальные draws/payout, новый executor несёт legacy обязательства.

**Рекомендации:**

- Не форсировать торговлю, draw, jackpot или реальные выплаты ради теста.
- Построить read-only verification при естественном событии: observed tx/receipt/hash, canonical/finality, соответствие native journal и PG projection, credits с `creditedAt`, Short/Monthly cycle snapshots, закреплённый drand round/result, claimable → payout, отсутствие дубля, рост nonce ровно по фактическим отправкам.
- На стенде перед этим воспроизвести synthetic replay отказов именно **перенесённого QIANQI runtime**, а не только нового LocalShort 31337.
- Monitoring должен показывать разницу между `healthy idle/waiting` и `stalled/blocked/unresolved`. `waiting: prizeFunding` само по себе не ошибка.
- Отдельно уточнить время первой реальной проверки и командный evidence; не подменять «сервис active» доказательством реальной выплаты.

## Что Codex должен сделать первым

**Один узкий пакет:** `native backup failure detection + операторский alert`. До реализации проверить уже имеющиеся QIANQI notifier/systemd зависимости, затем исправить preflight/failure state и добавить адресные fault-tests. Не делать рестарт executor без подтверждения консистентности. После узкого пакета — короткий отчёт: изменённые файлы, commit, tests и результаты, какие риски закрыты, что осталось. Следом — paired restore/runbook, затем inventory/тесты single-writer и наблюдение следующего естественного financial cycle.

Не нужны сейчас: переход QIANQI scanner в PostgreSQL, переделка денежной модели, новые роли/on-chain upgrade, полный stress-test, смена RPC или косметический рефакторинг. В review/проверках сохранять политику `AGENTS.md`: точечные тесты + значимые соседи, без автоматического full suite на каждый маленький коммит.

## Оценка серьёзности

- **Высокий операционный риск:** backup failed-after-stop → оставленные stopped services **(подтверждённый кодовый сценарий)**.
- **Высокий операционный риск:** нет доказанной end-to-end тревоги при длительной остановке/невыполненном backup **(monitor.py сам не уведомляет; наличие другого notifier ещё проверить)**.
- **Средний риск:** две независимые линии сохранения/restore без единого cross-checkpoint **(архитектурный риск)**.
- **Средний риск:** старый sender runtime вне PG lease **(потенциальный обход при ручном/нештатном запуске)**.
- **Не дефект:** отсутствие нового реального draw/payout после handoff; требует наблюдения следующего естественного события.

**Важно:** пользователь поручил Codex править, но это не разрешение мне прямо сейчас выполнять опасные live-операции. Автор этого ревью поменял только этот markdown-файл. Системные изменения/запуски на VPS вести штатным безопасным процессом проекта.
