# Этапы

10.10.2026: [сквозной локальный запуск нового проекта](NEW_TOKEN_STUDIO.md)
готов: форма → Pons и Short contracts → PostgreSQL registration → automated
worker → отдельный localhost-сайт. Реальный browser, два токена, restart/replay,
late recognition, обе ветки drand/settle, повтор без выплаты проверены.
Дальше предложен production профиль первого USDG/Short и закрытие реальных
подписей/IPFS/finality; существующий QIANQI не переделывать ради нового токена.

10.10.2026: [watchdog с компьютера](LOCAL_WATCHDOG.md) установлен по выбору
владельца: API и возраст/SHA256 off-server архивов, Windows alerts. Постоянная
внешняя точка пока не предоставлена; при спящем компьютере проверка не работает.
Заодно platform backup дополнен актуальным отдельным executor runtime;
реальный backup и его извлечение проверены. Финансовое исполнение не менялось.

10.10.2026: [single-writer inventory/защита](QIANQI_SINGLE_WRITER.md) закрыт
и установлен (`90328c4`): два процесса на отдельной БД, fail-closed public fence,
masked legacy launchers, успешный первый pass без отправок. Следующий
предложенный пакет — внешний watchdog и off-server freshness; проверка
естественного финансового события остаётся отдельным доказательством.

10.10.2026: [paired native + PG recovery](QIANQI_PAIRED_RECOVERY.md) закрыт
как read-only операторский пакет: реальная отдельная БД, блокировка старой пары,
переиндексация копии, сверка с chain и проверка API. Автоматический финансовый
startup не включён. Предложенный тогда single-writer пакет закрыт выше.

10.10.2026: узкий пакет [backup failure detection + alert](QIANQI_BACKUP_SAFETY.md)
закрыт и развёрнут. Следом предложен paired restore/runbook; внешний watchdog,
контроль off-server freshness и расширенный single-writer audit остаются открыты.

Актуально на 09.10.2026: **переключение QIANQI выполнено** —
[результаты, проверки и оставшиеся границы](QIANQI_PLATFORM_HANDOFF_REPORT.md).
Публичный API и исполнитель работают на платформе; backup/restore проверены.
Приватное хранение и scanner пока сохранены через native adapter. Дальнейшую
унификацию или запуск нового токена согласовать отдельным пакетом. Повторный
handoff и ожидание суточной активности не нужны.

Ниже — история этапов; поздние решения уточняют ранний план.

Последовательность уточнена владельцем 07.10.2026: сначала базовая интеграция
запуска Pons, затем собственные финансовые модули.

1. Готово: импорт основы, заметки, GitHub, 105/105 офлайн-тестов исходной базы.
   Исследование: [возможности](PONS_CAPABILITIES.md), [комиссии](PONS_FEE_FLOW.md).
   Эти результаты не означают готовность нового приложения.
2. Сейчас: [базовая версия Pons](PONS_BASELINE.md). Зафиксировать полную матрицу
   доступных функций запуска и критерии проверки, реализовать собственный UI
   и интеграцию без наших финансовых модулей.
   Первый пакет выполнен: [матрица](PONS_COVERAGE.md), форма и local fork launch,
   [14 unit / 13 fork / 5 browser проверок](PONS_BASELINE_REPORT.md).
   Полнота базовой версии ещё не достигнута; остаток перечислен в матрице.
3. Проверить базовую версию, записать результаты и ограничения; сохранить
   отдельный commit/tag как точку возврата к рабочему коду.
4. Согласовать открытые финансовые правила из [спецификации](PRODUCT_SPEC.md).
   Реализовать розыгрыш с настраиваемыми долями как дополнительный модуль.
5. Проверить цикл и изоляцию двух экземпляров: покупки, комиссии, билеты,
   фиксация фонда/участников, RNG, результат, выплаты и восстановление.
6. Подключить модуль к конструктору и пройти полный путь запуска и обслуживания,
   сохранив обычный режим Pons. Другие механики — последующие модули.
7. Публичный запуск и реальные расходы — отдельная задача владельца.

PAIR остаётся возможной будущей интеграцией. План собственного collector/RNG
из DEPLOYMENT_BLUEPRINT сохранён для этапа 4, не предшествует базовой версии.

08.10.2026: к этапу 2 добавлена [валидация frontend/API](VALIDATION.md).
Результаты: 20 unit/API, 13 fork, 6 browser; сборка успешна.

Уточнение владельца 08.10.2026: после checkpoint631c33e начать надстройку
постепенно, не дожидаясь закрытия всего остатка Pons. Первый пакет
[DRAW_MODULE](DRAW_MODULE.md) — модель и расчёт корзин, без финансового исполнения;
5 тестов прошли. Следом UI предпросмотра. Остаток базовой интеграции сохраняется.

Пакет2 надстройки: UI настроек и предпросмотра реализован (`/draws.html`),
3 новых и 2 соседних UI-теста прошли, build успешен. Следом отдельная проверяемая
реализация результата Short по QIANQI; финансовое исполнение пока не подключено.

Пакет3 завершён: локальный Short-симулятор,11unit/9UI/build PASS.
Дальше независимая Solidity-сверка и модель цикла с freeze; live RNG/выплаты
не подключены. Monthly остаётся отдельным пакетом.

Пакет локального исполнения Short завершён: [LOCAL_SHORT_EXECUTION](LOCAL_SHORT_EXECUTION.md).
7интеграционных сценариев, независимая Solidity/JS сверка24векторов.
Дальше требуется согласовать split/маршрутизацию и подключать индексатор/RNG/Pons;
текущий local-only контракт не предназначен для production.

Пакет split завершён: [FEE_SPLIT](FEE_SPLIT.md),10контрактных сценариев PASS.
Локальный Short теперь получает заданную призовую долю; остальные доли выплачиваются
отдельно. Дальше подключение реальных данных покупок/индексатора и RNG, затем
production deployment; Monthly отдельный модуль.

Покупки→билеты: готов локальный USDG curve/opening-buy профиль,4unit+6fork PASS,
проверены сохранение/перезапуск/два токена/snapshot→Short. [TICKET_INDEXER](TICKET_INDEXER.md).
До mainnet: authenticated RNG, publisher/keeper/finality и дополнительные маршруты
после graduation; завершение единого deployment. Monthly отдельно.

RNG-пакет: [DRAND_SHORT](DRAND_SHORT.md) — BLS drand, атомарный future-round request,
prove/deliver/retry, fresh round21316976 проверен. Следом единая локальная
репетиция launch→indexer→freeze→drand→claims и долговечная автоматика;
production clock/finality и deployment требуют отдельной готовности.

Первый TOKEN/USDG: [условия и проверки](FIRST_TOKEN_REHEARSAL.md). До сквозной репетиции перенести поздние подтверждения покупок с отдельной позицией начисления, неизменными snapshots и защитой от повторного начисления. Затем проверить полный цикл с интервалом 86400 секунд, фондом от 50 USDG и одним призовым слотом без гарантии победителя.

Позднее начисление, локальный пакет: [LATE_RECOGNITION](LATE_RECOGNITION.md), 8 unit + 7 fork PASS. Дата подтверждения управляет cutoff, повторы не начисляют повторно, повреждения/reorg останавливают обработку. Ближайшая интеграция — сквозная репетиция первого токена; покрытие неизвестных маршрутов/trace-adapter и production admission остаются отдельными незакрытыми пунктами.

Первый токен: сквозная локальная репетиция завершена, [отчёт](FIRST_TOKEN_REHEARSAL_REPORT.md), 9/9 + 10/10 PASS. Команда npm run test:first-token, профиль config/rehearsals/first-token.json. Следующие границы: долговечная оркестрация и восстановление полного цикла, интеграция deployment надстройки в UI, trace-adapters и production finality/clock/keeper. Запуск основной сети этим пакетом не разрешён.

Пакет локального восстановления исполнителя выполнен: [LOCAL_WORKER](LOCAL_WORKER.md), 8 worker/12 unit/7 ticket fork PASS. Сквозной процесс возобновляется с сохранённой подписанной транзакции и прежнего RNG request; ошибки/reorg не вызывают reroll. Следом — перенос проверенных QIANQI trace-adapters для реальных маршрутов и подготовка production finality/clock/deployment; server service и UI deployment остаются отдельными незакрытыми задачами.

09.10.2026: перед дальнейшей реализацией общего бэка подготовлен [архитектурный brief для GPT](SHARED_BACKEND_REVIEW_BRIEF.md). Новый приоритет — совместное обслуживание нескольких изолированных проектов, включая QIANQI. Выбор БД, процессов и подписантов не утверждён; следующий архитектурный пакет уточняем по результатам разбора. Ранее отмеченные mainnet/route-пробелы остаются открытыми.

Первый многопроектный пакет согласован и реализован 09.10.2026: [SHARED_BACKEND_BASELINE](SHARED_BACKEND_BASELINE.md). PostgreSQL/RO API/изоляция двух синтетических проектов, 5 DB+HTTP+restore сценариев PASS. Следом общий reader и отдельные применения данных к проектам; далее DB financial journal и read-only QIANQI shadow. Общая инфраструктура пока локальная, migration production не выполнялась.

09.10.2026: выполнен [SHARED_READ_PIPELINE](SHARED_READ_PIPELINE.md): общий raw reader, отдельные проектные inbox/cursors, атомарное применение, RLS и durable reorg halt. На синтетическом RPC 21 вызов вместо 42 для двух проектов; применение без RPC. Ticket adapter/late confirmation bindings ещё не подключены, финансовый worker и QIANQI не переключались. Следующий пакет — адаптер билетов и shadow-сравнение поверх общей истории.

09.10.2026: выполнен [SHARED_TICKET_SHADOW](SHARED_TICKET_SHADOW.md): билеты и late recognition поверх полных общих receipts, отдельное PostgreSQL-состояние каждого модуля, immutable profile и frozen shadow snapshots. На локальном fork сверено с прежним scanTickets: 15 интеграционных сценариев +8 ticket unit PASS. Защитные RPC-проверки сохранены; полные receipts повторно не читаются. Это shadow, финансовый worker и QIANQI не переключались. Далее нормализованное хранение событий/начислений и инкрементальная обработка вместо целого JSON-состояния; финансовый журнал отдельным пакетом.

09.10.2026: выполнен [INCREMENTAL_TICKET_LEDGER](INCREMENTAL_TICKET_LEDGER.md): отдельные events/credits/wallets/commitments/snapshots и курсор PostgreSQL, обработка только новых блоков, адресные proofs для late credit. Результаты совпали с прежними JSON shadow и scanner; 16 integration +8 ticket unit PASS. Проверены полный rollback при сбое записи курсора и backup/restore всех новых таблиц. Финансовое исполнение и QIANQI не переключены. Следующий предлагаемый пакет — финансовый журнал PostgreSQL и восстановление локального исполнителя.

09.10.2026: выполнен [POSTGRES_FINANCIAL_JOURNAL](POSTGRES_FINANCIAL_JOURNAL.md): отдельная lp_executor, immutable signed intent до broadcast, стабильный operation ID, session lock и восстановление того же hash. Два локальных payout-контракта/кошелька;17 integration +4 journal unit PASS, включая реальный kill процесса, DB disconnect, lost RPC response, revert/reorg и backup. Это транспорт одной операции; полный Short worker пока не переключён. Следующий пакет — многоконтрактные bindings и интеграция полного локального worker с durable cycle/snapshot/RNG.

09.10.2026: выполнен [POSTGRES_LOCAL_WORKER](POSTGRES_LOCAL_WORKER.md): полный локальный Short использует общий reader, incremental tickets, многоконтрактный financial journal и durable worker state. Проверены kill процесса, receipt/state gap, snapshot gap, фиксированный RNG request, prove/deliver/settle/claim и reorg halt. 8 сквозных worker +11 DB/HTTP/restore сценариев PASS; соседние file worker8, financial17 и journal unit4 PASS. Выплата67.5 тестовых USDG, live drand21341556. QIANQI/production не переключены. Следующий предлагаемый этап — read-only compatibility/inventory и shadow QIANQI.

09.10.2026: выполнен первый read-only [QIANQI_READONLY_INVENTORY](QIANQI_READONLY_INVENTORY.md): публичный API сверен с контрактами на finalized84120819, оба контроллера/vault/RNG обнаружены, резервы и timing совпали. 10 unit PASS. Это inventory, не ticket replay и не переключение production. Следующий пакет — read-only ticket/lifecycle adapter обоих lane с late recognition и сравнением на общем cutoff.

09.10.2026: выполнен [QIANQI_TICKET_SHADOW](QIANQI_TICKET_SHADOW.md): read-only accounting shadow на finalized/API84135771, 48 кошельков и53 late purchases из4 confirmation batches. Carry, Short/Monthly balances и lifecycle совпали; open12/26, consumed14/0. Пакет24 от07.10 уже виден в API. 19 новых +18 соседних тестов PASS. Admission/суммы покупок пока из API, route proofs не replay-ились; executionEligible=false. Далее независимый BUY/route verifier, полная история и snapshot hashes; QIANQI worker не переключать.

09.10.2026: выполнен [QIANQI_ROUTE_REPLAY](QIANQI_ROUTE_REPLAY.md):53/53 покупки из late cohort проверены по calldata/published trace/canonical receipts и историческому bytecode; payer и4169.169694USDG вычислены без API-сумм. 29/12/12 маршрутов65050/Park/native settlement,48кошельков; open12/26 и consumed14/0 совпали. 10 evidence +19 shadow tests PASS. Trace остаётся publisher/RPC evidence, это не полный BUY replay проекта и не admission executor. Далее полная история и snapshot hashes двух Short; production не переключён.

09.10.2026: выполнен [QIANQI_HISTORY_REPLAY](QIANQI_HISTORY_REPLAY.md): на блоке84135771 выбраны68BUY/54SELL,66покупок квалифицированы,2неизвестных маршрута ждут recognition. Оба Short snapshot hash и точные published participant ranges совпали. 8 evidence +19 соседних unit PASS. PostgreSQL/RNG/выплаты/handoff не проверялись этим пакетом. Далее предлагается изолированный импорт этой истории в общий PostgreSQL и проверка восстановления.

09.10.2026: выполнен [QIANQI_POSTGRES_IMPORT](QIANQI_POSTGRES_IMPORT.md): offline evidence перепроверяется перед атомарным импортом в отдельный adapter общего PostgreSQL. 68 покупок/52 кошелька/два Short snapshot на84135771, повтор и concurrent delivery без дублей; RLS, rollback, новый процесс и dump/restore проверены. 17 integration +8 history evidence PASS. Это immutable historical shadow, не live reader/executor. Далее предлагается read-only сверка RNG и финансовой непрерывности; production не переключён.

09.10.2026: выполнен [QIANQI_FINANCE_SHADOW](QIANQI_FINANCE_SHADOW.md): на84135771 два Short/RNG request связаны с sealed snapshots; BLS через historical contract verify, seed пересчитан, пять выплат60.079580USDG подтверждены Transfer. Claimable/reserved0, vault219.644743USDG совпал со свободными резервами, active/pending подготовки отсутствуют. 8 новых +8 history tests PASS. Winner selection пока читается из контроллера; не independent outcome replay и не live readiness/handoff. Далее актуализация shadow на новых блоках.

09.10.2026: выполнен [QIANQI_LIVE_SHADOW](QIANQI_LIVE_SHADOW.md): новые события читаются после отдельного PostgreSQL cursor; verified state/history неизменяемы, API generation/finality/branch и53 wallet balances сверяются. Реальные циклы достигли84275104, повтор UNCHANGED; новый интервал без BUY/SELL/recognition/lifecycle. 21 integration + отдельный restore PASS,8 live +8 history +19 unit PASS. Подготовлен --watch, серверный service не запускался. Расчёт пока full in-memory replay и payload snapshot на head; growth оценить до длительной эксплуатации. Далее independent Short outcome replay, затем server rehearsal/проектные права.

09.10.2026: выполнен [QIANQI_OUTCOME_REPLAY](QIANQI_OUTCOME_REPLAY.md): оба Short на84135771 независимо пересчитаны из проверенных participants/seed/rules; policy/basket/context и dataset resultHash совпали,1/4 победителя и все5 сумм подтверждены. 7 новых (24вектора) +8 finance tests PASS. BLS остаётся historical contract verify, RPC completeness trusted; не Monthly/live full-audit/handoff. Далее read-only server inventory и конкретный план shadow-окружения.

09.10.2026: выполнено read-only обследование сервера и подготовлен [SHARED_SERVER_PLAN](SHARED_SERVER_PLAN.md). На хосте работают production QIANQI и staging; доступно ~3 GiB RAM/29 GiB диска, PostgreSQL отсутствует. До установки: проверить PostgreSQL18 (локально был17.2), вынести writable paths, ограничить рост captures/DB и подготовить отдельные service templates. Текущий shadow может сохранять ~1.22 GiB capture/сутки при ежеминутном advanced head. Сервер не изменялся; следующий предлагаемый пакет — локальная подготовка ограниченной серверной репетиции, без financial handoff.

09.10.2026: локальная подготовка серверного shadow выполнена — [SHADOW_SERVER_REHEARSAL](SHADOW_SERVER_REHEARSAL.md). PostgreSQL18.6: migrations/import/RLS, compact body/head, rollback/restart/kill и dump/restore проверены; PG17 baseline10 PASS. Migration009 дедуплицирует состояние; captures gzip/SHA256 сохраняются отдельно от release. Бюджет3GiB state+DB, floor10GiB, срок24h с сохранением deadline при restart; exit78 без автоматического повтора. Portable bootstrap CLI и systemd/env templates готовы, на сервер не установлены. Следующий пакет — согласованная ограниченная серверная репетиция с отдельной БД/правами/backup; QIANQI financial worker не переключать. Пределы измерений и состав прогонов в отчёте.

09.10.2026: серверный пакет разрешён владельцем и частично выполнен — [SERVER_REHEARSAL_DEPLOYMENT](SERVER_REHEARSAL_DEPLOYMENT.md). PostgreSQL18.6 Unix socket, отдельные OS user/DB/peer role, migrations001–009; verified bootstrap84135771 и отдельный restore/evidence replay MATCH. Собственный backup + off-server checksum + скрытый Windows pull task проверены. Runtime595cd94 установлен, logs RPC вынесен в PONS_LOGS_RPC. СУТОЧНЫЙ WATCH НЕ ЗАПУЩЕН: публичный RPC с хоста403, текущий Alchemy getLogs ограничен10блоками. Нужен URL в .local/config/pons-logs-rpc.txt; запрос владельцу отправлен. После URL проверить endpoint, сохранить failed preflight и запустить новую ограниченную репетицию; разрешение на этот этап уже получено. Shadow/backup/monitor timers disabled; QIANQI PID/service/API сохранены. Финансового handoff нет.

09.10.2026: RPC-блокер снят, [SERVER_REHEARSAL_RUNNING](SERVER_REHEARSAL_RUNNING.md). Отдельный QuickNode владельца: chain/block MATCH, getLogs по10000блоков; paging реализован в55694dc и развёрнут после push. Live84339188→84343143 MATCH,53кошелька, событий в интервалах нет. Shadow/backup/monitor enabled; deadline10.10.2026 17:55:47UTC (20:55МСК), после restart/backup marker неизменен. Actual compact backup восстановлен/проверен в отдельной БД, off-server pull работает. Mixed API generation корректно оставлял cursor; после повторной попытки MATCH. Ручные частые restart вызвали start-limit, счётчик только нового сервиса сброшен, повтор active backup/resume PASS. Суточный результат ЕЩЁ НЕ ГОТОВ: следующим пакетом разобрать метрики/lag/события и финальный backup. QIANQI PID/service сохранены, financial handoff не выполнялся.

09.10.2026: владелец разрешил переезд QIANQI после проверки кода, без ожидания суток/новых покупок. Проверка выявила незакрытую реализацию: общий worker ограничен новыми LocalShort/chain31337, API содержит только /api/project; существующий QIANQI executor и /v1 ещё не подключены. См. [QIANQI_HANDOFF_READINESS](QIANQI_HANDOFF_READINESS.md). Следующий пакет — рабочий existing-project adapter, совместимый API и перенос исполнительного состояния, затем разрешённый handoff. Прежний суточный shadow не является gate; серверные таймеры пока не изменены, QIANQI работает прежними службами.

09.10.2026: реализован [QIANQI_EXISTING_ADAPTER](QIANQI_EXISTING_ADAPTER.md): актуальный native Short/Monthly runtime с finality fix, signer lease/fence, adoption существующих журналов, общий /v1 API из PostgreSQL public projection. 3 unit, 15 PostgreSQL18 integration/restore, 66 native/contract tests PASS. Приватные журналы и scanner пока native; это явно переходный adapter. Далее серверная проверка binding/state и разрешённый handoff, без ожидания активности.
