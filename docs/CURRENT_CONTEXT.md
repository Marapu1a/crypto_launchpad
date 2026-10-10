# Текущий контекст

Обновлено 10.10.2026. **QIANQI переведён на runtime платформы.**

10.10.2026: вернулись к новым токенам. [New token studio](NEW_TOKEN_STUDIO.md)
соединяет UI → contracts/Pons launch → регистрацию в общем PostgreSQL →
поздние билеты → автоматический Short worker → сайт на slug.localhost.
Проверены два изолированных токена, продолжение той же подписи после обрыва,
обе ветки розыгрыша и отсутствие повторной выплаты. Стенд оставлен на порту 4185,
демо-проект завершил цикл и после настоящего перезапуска панели. Это сеть 31337,
исторический fork; QIANQI/production не менялись. Следующий пакет — production
профиль USDG/Short, затем реальный кошелёк/IPFS и репетиция точных artifacts для 4663.

Дополнение 10.10.2026: [локальный watchdog/off-server freshness](LOCAL_WATCHDOG.md)
установлен по выбору владельца: проверка с компьютера каждые 5 минут, Windows
уведомления, возраст архива отдельно от pull и SHA256. При сне/выходе пользователя
проверки нет; независимый 24/7 observer ещё не подключён. Platform backup теперь
содержит также отдельный реальный executor release (`d7cf1c5`), проверено
извлечение 311 файлов. Финансовые службы в этом пакете не перезапускались.

Актуальное дополнение 10.10.2026: [single writer](QIANQI_SINGLE_WRITER.md)
проверен и развёрнут (`90328c4`). Automation использует отдельный
`d0a6840-writer-90328c4`: обязательный fence, отказ прямого public CLI,
проверки до подписи/перед broadcast. Старые аварийные units masked.
API/indexer остаются на d0a6840. Первый pass waiting без ошибок, nonce 85/85,
pending=0; API 200/observed. Предложенный тогда watchdog/freshness реализован
с компьютера (см. выше); реальную активность не форсировать.

Актуальное дополнение 10.10.2026: [paired recovery](QIANQI_PAIRED_RECOVERY.md)
реализован и проверен на отдельных реальных копиях. Исходный native/PG mismatch
обнаружен; native-копия переиндексирована до PG head без изменения финансовых
журналов или понижения PG. Итог READ_ONLY_RECONCILED, nonce 85/85/85, API копии
честно stale. Recovery не стартует sender и не меняет production. Следующий
предложенный тогда пакет inventory/тесты writer уже выполнен; watchdog/freshness
с компьютера также выполнены. Независимый круглосуточный observer остаётся открытым.

Дополнение 10.10.2026: [backup failure detection и операторская тревога](QIANQI_BACKUP_SAFETY.md)
реализованы и установлены (`70b68c6`, HTTP probe fix `f1097a3`, текст тревоги `c967d00`). Проверены 6 Linux
fault-tests и 6 monitor tests, штатные native/platform backup и реальная доставка
тестового Telegram-сообщения. После ошибки backup нет безусловного resume:
durable status блокирует повтор до ручной reconciliation. Предложенный тогда
native+PG restore/preflight уже выполнен следующим пакетом (см. выше).

Актуальный результат: [отчёт о переключении](QIANQI_PLATFORM_HANDOFF_REPORT.md).
Публичный API работает через PostgreSQL и порт 4180; индексатор и единственный
финансовый исполнитель использовали runtime `d0a6840` на момент handoff;
последующее обновление только исполнителя указано выше. Операционные исправления —
по `4a1f211`. Состояние и экономика QIANQI сохранены. Backup обеих систем,
восстановление отдельной копии и скачивание архивов на компьютер проверены.
Shadow отключён; backup/monitor работают постоянно. Ожидать 24 часа не требуется.

Граница этого этапа: приватные финансовые журналы и scanner пока native,
через existing-project adapter. Их полная унификация — отдельный будущий пакет.
Повторять переключение не нужно. Новых финансовых транзакций за проверенный
интервал не было; реальную покупку/розыгрыш не форсировали.

Ниже сохранена история с 07.10.2026. Старые формулировки «сейчас», запреты
переключения и сроки shadow относятся к своим этапам, а не к текущему состоянию.

Владелец поручил изучить GitHub `Marapu1a/rh_project`, забрать нужную основу,
создать локальное место для заметок и связать проект с `Marapu1a/crypto_launchpad`.
Новая удалённая репа на момент подготовки была пустая; локально создана ветка `main`,
`origin` указывает на неё. Исходный brief сохранён без изменений.

В `vendor/qianqi/` импортирована выбранная база с транзитивными зависимостями,
Solidity-фикстурами и офлайн-регрессиями. Версия и контрольные суммы — `UPSTREAM.json`.
Копия исходной GitHub-репы для изучения находится рядом, в
`D:\sites\crypto_launchpad_source_review`; для работы нового проекта она не нужна.

Новая механика ещё не реализована. Последнее решение владельца: сначала
[базовая версия запуска Pons](PONS_BASELINE.md) со всеми доступными возможностями,
проверками и отчётом; затем зафиксировать рабочую версию и добавлять наши модули.
Первый рабочий пакет базы готов: [матрица покрытия](PONS_COVERAGE.md),
[отчёт](PONS_BASELINE_REPORT.md). UI на Vite/ethers: `npm run dev`, порт 5173.
14 unit, 13 fork и 5 browser-проверок прошли; основная сеть только read/simulate,
отправки реализованы на localhost fork. IPFS upload/полный wallet flow и остаток
матрицы ещё впереди; полный baseline tag не создан.
Alchemy RPC из `.local/config/pons-rpc.txt` проверен: 8/8 read-only проверок
и 13/13 интеграционных сценариев на историческом блоке 82616126. URL не хранить
в docs/коде/выводе. `npm run check:rpc` повторяет короткую проверку, `npm run fork`
читает endpoint при запуске. Ранее запущенный fork сам на новый RPC не переключается.
Доли победителя/команды настраиваются ползунком при создании; 50/50 — только
начальное значение. Изменения после запуска пока не согласованы.
Уточнение владельца: продукт — собственный UI прямого запуска через Pons с
дополнительными финансовыми модулями; розыгрыш — первый из возможных модулей.
Первичная сверка документации и истории QIANQI — [PONS_DISCOVERY](PONS_DISCOVERY.md).
Первый пакет исследования завершён: [карта возможностей](PONS_CAPABILITIES.md),
датированный read-only снимок Pons и повторная проверка launch QIANQI.
Пакет 2 завершён в границах доступных источников: [путь комиссий](PONS_FEE_FLOW.md),
[проект графа запуска](DEPLOYMENT_BLUEPRINT.md). Escrow/router/factory/deployer/hook
сверены с Sourcify и RPC. Holders frontend-путь и proxy/beacon установлены,
но исходник активной логики не получен: необратимость не подтверждена.
Обнаружен устаревший CREATE deployer в GitHub против действующего CREATE2.
Collector/program/RNG и финансовые решения отложены до проверенной базовой
интеграции Pons; предложения графа сохранены для будущего этапа. Локальный указатель находок:
`.local/notes/RESEARCH_INDEX.md`.
Решение владельца 07.10.2026: сначала Pons; PAIR остаётся запасной будущей
интеграцией, в первый пакет не входит. Публичного deployment нет.

Личные рабочие материалы: `.local/drafts/`, `.local/notes/`, `.local/logs/`.
Проверки подготовки и ограничения — [BOOTSTRAP](BOOTSTRAP.md).

08.10.2026: выполнен пакет [валидации](VALIDATION.md): общие frontend/server
правила, Node API, ошибки полей и блокировка переходов. 20 unit/API + 13 fork
+ 6 browser, build успешен. IPFS-публикация и основной кошелёк остаются впереди.

## Следующий шаг — 08.10.2026

По указанию владельца текущая версия сохранена в GitHub: 631c33e,
`pons-checkpoint-2026-10-08`. Полное покрытие Pons ещё не достигнуто.
Разрешено постепенно начать надстройку на основе механик QIANQI.
Первый отдельный пакет — [DRAW_MODULE](DRAW_MODULE.md): настройки и расчёт корзины,
5 новых тестов прошли. Следом интерфейс настройки/предпросмотра; финансовое
исполнение и оставшиеся функции Pons пока впереди.

08.10.2026, пакет2 надстройки: готов отдельный экран `/draws.html` с сохранением,
валидацией, экспортом настроек и предпросмотром Short-корзины. Сборка + 3 новых
и 2 соседних браузерных теста прошли. Денежных операций и связи с deploy нет.
Подробности — DRAW_MODULE. Следующий пакет — алгоритм результата Short.

Удобство весов: крупные призы вводятся кратко (7:4:2), хвост до64мест
автоматически заполняется единицами; ручной режим оставлен. 4 UI-теста и build
прошли. Изменение только конструктора, денежная арифметика прежняя.

Расширенная проверка конструктора: 6 unit + 7 UI passed, все1–64мест,
экспорт совпадает с предпросмотром, граничные суммы/ошибки/storage проверены.
Подробный результат — DRAW_MODULE, runtime не менялся.

Пакет3 выполнен08.10.2026: локальный Short-симулятор на `/draws.html`,
допуск/отбор/призы QIANQI, генераторы участников, тестовый seed, отдельные
контексты проекта/цикла. 11unit+9UI+build PASS,24набора совпали с JS reference.
Нет транзакций/RNG/истории покупок/lifecycle. Границы — DRAW_MODULE.

08.10.2026: выполнен локальный денежный цикл Short, см. LOCAL_SHORT_EXECUTION.
Collector→fund→freeze→Solidity result→claims→следующий цикл.7сценариев прошли,
включая24Solidity/JS вектора. Только in-process31337 и mock escrow/ERC20;
оператор вручную задаёт тестовый seed. Split/Monthly/realPons/RNG/индексатор
не подключены; локальный бюджет не утверждает финансовые правила токена.

08.10.2026: добавлен LocalFeeSplitter: настраиваемые призы/команда/обслуживание,
фиксированные получатели, cumulative округление, независимые выплаты.
10контрактных сценариев PASS, включая escrow→collector→split→Short→claims.
См. FEE_SPLIT. UI deployment/Monthly/realPons/indexer/RNG ещё не подключены.

08.10.2026: пакет покупки→билеты выполнен для USDG curve и launchAndBuy наfork.
Порог параметризован, остатки сохраняются, scan durable с checksum/lock/atomic save,
freeze snapshot, расходованные билеты читаются из программы.4unit+6fork PASS,
участники из покупок переданы в Solidity freeze/settle. См.TICKET_INDEXER.
Pool/native/batch и production finality не реализованы; при reorg остановка.
Далее RNG и эксплуатационное подключение, оставшиеся маршруты отдельным пакетом.

08.10.2026: LocalDrandShortProgram+LocalDrandAdapter проверяют evmnet BLS;
freeze атомарно закрепляет будущий раунд, ручной seed не принимается.
4offline+4live контрактных сценария,2unit,10соседних PASS. Live round21316976.
Подробности DRAND_SHORT. Прежний LocalShortProgram остаётся ручной тестовой
фикстурой. Clock/finality/keeper/deployment mainnet не готовы.

08.10.2026: условия первого TOKEN/USDG согласованы в [FIRST_TOKEN_REHEARSAL](FIRST_TOKEN_REHEARSAL.md). 24 часа от settle, первый отсчёт от создания программы; один призовой слот без гарантии победителя. Найден обязательный пробел: позднее распознавание QIANQI использует creditedAt, текущий индексатор платформы его ещё не поддерживает. Перенос и проверка нужны до сквозной репетиции.

08.10.2026: локальный перенос позднего начисления выполнен — [LATE_RECOGNITION](LATE_RECOGNITION.md). Отдельный source/publisher, проверка исходной покупки, creditedAt, immutable originals/snapshots, durable bundles и reorg halt. 8 unit + 7 fork сценариев PASS (включая прежние 6). Проверена намеренно отложенная прямая покупка Pons; trace-adapter неизвестных роутеров ещё не перенесён. Полная репетиция первого токена с live RNG/24 часами остаётся следующим интеграционным пакетом.

08.10.2026: сквозная репетиция первого TOKEN/USDG PASS — [FIRST_TOKEN_REHEARSAL_REPORT](FIRST_TOKEN_REHEARSAL_REPORT.md). 9 сценариев + 10 соседних контрактных, live drand round21318348. Pons launch → реальный curve fee sweep → escrow → collector → split80/15/5 → билеты/late credit → freeze → drand → settle/claim. Выплата 67.716 USDG в локальном fork82000000. Добавлен LocalPonsFeeCollector: однократная проверенная привязка и sweep от fee recipient. 24 часа и отдельная no-winner фикстура проверены. Mainnet/keeper/UI deployment/неизвестные маршруты остаются незакрытыми.

08.10.2026: добавлен [LOCAL_WORKER](LOCAL_WORKER.md): локальный постоянный исполнитель уже развёрнутого Short, signed intent до broadcast, восстановление по hash/nonce, отдельные locks, runtime/binding guards, fee flow/indexer/freeze/drand/settle/claim. Сверен с исходниками QIANQI в D:/sites/rh_project, HEAD11a050d, без изменений источника. 8 интеграционных worker +12 unit +7 соседних ticket fork PASS; live round21318996, выплата67.5 тестовых USDG. После аварийного kill требуется явная проверка/снятие dead-owner lock. Mainnet, неизвестные маршруты, distributed locks и серверная эксплуатация ещё не готовы.

09.10.2026: владелец уточнил две исходные цели — свои правила распределения creator revenue и экономия общей инфраструктурой (поддомены, общий бэк, изоляция токенов). QIANQI тоже должен в перспективе обслуживаться общим бэком. Подготовлен [SHARED_BACKEND_REVIEW_BRIEF](SHARED_BACKEND_REVIEW_BRIEF.md) для независимого совета GPT. Архитектура пока обсуждается; переключение production не разрешено этим документом.

09.10.2026: выполнен первый пакет общего бэка — [SHARED_BACKEND_BASELINE](SHARED_BACKEND_BASELINE.md). PostgreSQL projects/modules/cursors/jobs, составные FK и FORCE RLS, read-only API с Host allowlist, независимые проектные транзакции и тестовый claim jobs. 5 интеграционных сценариев PASS на отдельном PostgreSQL17.2, включая backup/restore. QIANQI, on-chain состояние и финансовый worker не переключались. Следующий пакет — shared read pipeline с независимыми cursors.

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
