# Текущий контекст

Обновлено 07.10.2026.

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
