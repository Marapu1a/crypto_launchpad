# Этапы

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
