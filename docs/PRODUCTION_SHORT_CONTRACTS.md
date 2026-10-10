# USDG/Short: контракты 4663, PostgreSQL sender и ключи

10.10.2026, пакет после `6509b60`. Отдельный production-кандидат; публичного
deployment, миграции production БД и отправок реальных транзакций не было.
QIANQI, его исходники/ключи/конфиги и работающий локальный studio не изменены.

## Проверка предположения о времени

Повторный read-only отчёт:
`.local/test-results/production-observation-2026-10-10T07-56-01-446Z.json`.

- Разница **между timestamp latest и finalized**: 1121–1129 секунд.
  В этой величине часы ПК вообще не участвуют.
- Latest 84839354–84839433; finalized 84828508,
  hash `0xb556bf3b5743bb61393102f9c151efa7ea96280c2c421e3e33642e261a36a0c2`.
- `w32tm /stripchart /computer:time.windows.com /samples:3 /dataonly`
  в 10:56:11–10:56:15 MSK показал +0.1110289, +0.1149352, +0.1176081 секунды.
  HTTP Date RPC также укладывается примерно в секунду относительно ПК
  (точность самого HTTP Date — одна секунда).

Следовательно, наблюдаемые ~19 минут не объясняются локальными часами.
Это снимок данного RPC, не доказательство верхней границы финальности сети.
Системное время не менялось. Скрипт `npm run check:production` теперь отдельно
сохраняет chainFinalityLagSeconds и HTTP clock observations.

## Контрактный шаблон

Новая папка `contracts/production/`, старые Local* сохранены:

| Контракт | Назначение |
| --- | --- |
| ShortProgram | Фонд, snapshot, неизменный checkpoint, один раунд, призовые обязательства, claim |
| ShortDrandAdapter | Один consumer, evmnet BLS, доказательство и доставка отдельно, без отмены/замены раунда |
| FeeCollector / PonsFeeCollector | Фиксированные escrow/destination/factory; единственная необратимая привязка token/curve |
| FeeSplitter | Настраиваемые неизменные доли, накопление дробных остатков, отдельная доставка каждой доли |
| PurchaseRecognition | Append-only commitments покупок; publisher, project instance, notice 24 часа как в QIANQI |

Все конструкторы ограничены сетью 4663. ShortProgram создаёт собственный
adapter; instance/context не пересекаются между программами. Интервал,
минимальный фонд, минимальная единица приза и до 64 весов задаются при создании.
Проверен preset 24 часа / 50 USDG / один слот, split 80/15/5.
Asset задаётся в конструкторе: именно USDG и его 6 decimals должен закреплять
deployment-профиль, а не предположение по названию контракта.

Первый таймер идёт от создания программы, следующие — от завершения settle.
Freeze связывает participantsHash, бюджет, instance, cycle и checkpoint
(номер/hash/timestamp блока и ledgerHash) в контексте RNG. Номер checkpoint
берётся из RPC; Solidity block.number на Orbit не используется как L2-счётчик.
Повторные диапазоны билетов, старый checkpoint и чужой seed отклоняются.
Поздний фонд остаётся вне frozen бюджета; поздний recognition не меняет snapshot.
Settle читает только подтверждённый adapter seed и не принимает seed от оператора.

**Граница доверия:** checkpoint является утверждением оператора, а не
on-chain доказательством RPC finality. Admission обязан независимо проверить
каноничность, finalized cutoff и полноту ledger. Контракт не удостоверяет
истинность произвольного ledgerHash и сам не раздаёт билеты по evidence.
Полный planner ещё не подключён (см. следующий шаг).

Если исполнитель вернулся после публикации выбранного раунда, используется
тот же раунд и snapshot. Проверена доставка с задержкой 2 часа. Нет reroll,
reset или discretionary withdrawal. Это не устраняет риск реорганизации
нефинализированного freeze: до запуска нужен gate будущего раунда и контроль
финальности commitment; поздняя доставка не является доказательством finality.

## Воспроизводимая сборка

`npm run build:production` сохраняет новые artifacts/manifest в `.local/builds/`.
Compiler, настройки, исходники и транзитивные зависимости входят в build hash.
CRLF нормализуется в LF, чтобы Windows checkout не менял сборку.

Проверенная сборка:
`0x7198bee87bb4c2817be98210349578bc3c518941fab9c411b812d05e3fe00497`.
Manifest: `.local/builds/production-2026-10-10T08-07-52-648Z/manifest.json`.
Runtime ShortProgram 11786 байт, adapter 10844; ограничения размеров пройдены.
В тестах runtime сверяется с **этими же artifacts**, с учётом immutable slots.
runtimeTemplateHash не подменяет hash фактически развёрнутого runtime.

## Общая БД и ключи

Миграция `011_production_senders.sql` добавляет отдельную таблицу, не меняет
старые журналы. Обязательные RLS/project+module, уникальный (chain,sender),
неизменная policy, checksum и CAS revision. API/jobs не могут читать подписи.
Регистрация разрешена только новой программе cycle=0 с ожидаемым operator.

`server/shared/production-sender.mjs` держит session advisory lock для
**chain + sender** через durable writes и broadcast. Состояние перечитывается
после взятия lock. Потеря сессии или изменение revision запрещает продолжение.
Подписанный raw сохраняется до broadcast; восстановление использует тот же hash.
Это внутренний транспорт, не публичный API и не автоматический planner.
Как и прежде, общий DB role потенциально может менять project context: RLS
защищает запросы в выбранном контексте, а не от скомпрометированного runtime.

`executor-keystore.mjs`: отдельный encrypted JSON V3 файл на UUID проекта,
создание без перезаписи, без сохранения plaintext key/пароля/mnemonic.
Разблокировка сверяет адрес с policy. Пароль должен храниться отдельно от БД
и keystore; API его не получает. POSIX modes указаны, Windows ACL и хранение
пароля/backup на будущем production host ещё нужно настроить отдельно.
В тесте создавались только эфемерные ключи. Реальных ключей нового токена пока нет.
Автоматической ротации operator или восстановления потерянного пароля нет.

## Проверки

- `npm run test:production-contracts`: 8 сквозных сценариев на отдельном
  in-process Hardhat с chain ID 4663 и настоящем отдельном PostgreSQL.
  Публичного RPC в этом тесте нет; Pons — контрактная fixture.
- Настоящая историческая BLS подпись evmnet round 9337227; поддельная подпись,
  неправильный раунд и snapshot отвергаются. Рассчитан/выплачен тестовый приз
  80 USDG. Заморозка следующего цикла ждёт интервала от settle.
- Отказ получателя сохраняет долг; обрыв после подписи восстанавливается из
  файла; моделируемая finality задерживает завершение без повторной выплаты.
- Реальная БД: concurrent sender получает busy; pg_terminate_backend после
  durable prepared запрещает broadcast; новый проход использует тот же hash.
  Повтор не платит ещё раз; чужой проект/API/jobs не читают журнал;
  повторная привязка одного executor к другому проекту отвергается.
- 9 unit tests (8 policy/journal/timing + encrypted keystore) PASS.
- `npm run test:shared`: 10 соседних сценариев routing/RLS/chain-read/reorg/
  backup-restore PASS на схеме с 11 миграциями.
  Report `.local/test-results/shared-2026-10-10T08-06-50-558Z/report.json`.
- Ранние отчёты сохранены: отдельный контрактный pass `08-00-42-811Z`,
  failed `08-04-08-475Z` (test harness создавал schema в БД не того владельца),
  pass с PostgreSQL `08-04-48-989Z`. Harness исправлен отдельной test DB,
  production-разрешения не расширялись. Финальная сборка повторно проверена
  после нормализации исходников для воспроизводимости.
  Финальный PASS: `.local/test-results/production-contracts-2026-10-10T08-07-53-462Z/report.json`.

## Что дальше

Следующий пакет — подключить **полный planner нового шаблона**: проверку
bindings/economics и source, finalized ledger, точный freeze calldata,
актуальные clock/drand bounds, неизменный request при восстановлении,
recognition publisher и его отдельный sender. Сейчас тестовые admit callbacks
проверяют конкретные операции, но не заменяют весь production planner.

Затем репетиция на fork Pons с теми же artifacts и уже полным циклом через
PostgreSQL, подключение кошелька владельца, IPFS и production onboarding.
Timing 3600/30/30/1800/30 в контрактных тестах — только тестовый набор;
боевые параметры ещё не выбраны. Migration/keys/службы на VPS не применялись.
