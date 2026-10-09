# Полный локальный worker с PostgreSQL

09.10.2026, пакет поверх `ffc1d3d`. Реализация:
`server/shared/postgres-worker.mjs`, миграция `006_postgres_worker.sql`.
Команда сквозной проверки: `npm run test:shared:worker`.

Полный локальный Short worker теперь использует общий raw reader, инкрементальный
ticket ledger и финансовый журнал PostgreSQL. Прежний файловый путь сохранён:
`runLocalWorker` получает необязательный backend, алгоритм выбора финансового
действия остаётся общим. Production и QIANQI не переключались.

## Что объединено

- Pons curve → sweep → escrow/collector → splitter → призовой фонд/команда/газ;
- общие блоки и receipts → отдельный ledger → покупки и поздние начисления;
- фиксация cutoff/consumed/участников → freeze → фиксированный будущий drand request;
- prove → deliver → settle → claim, с повторным запуском каждого шага.

DB worker не читает и не пишет файловые worker/ticket journals и lock-файлы.
Файлы bundles по-прежнему являются входом publisher; после проверки доказательства
сохраняются в ledger. Private keys не сохраняются новым backend.

## Оркестрация и восстановление

`worker_states` имеет составной project/module FK к финансовому исполнителю,
FORCE RLS, неизменный config hash и проверяемый state checksum. Только lp_executor
имеет доступ; jobs/API не читают orchestration state. Состояние содержит ссылки
на циклы, RNG, текущую операцию и подтверждённую историю.

Session lock worker охватывает выбор действия, snapshot и сохранение state.
Session lock финансового журнала отдельно охватывает commit подписи/broadcast.
При смерти процесса обе блокировки освобождаются PostgreSQL. Канонический lower
case UUID используется в ключах блокировок, чтобы регистр не создавал второй lock
для той же строки БД. Потерянная DB-сессия запрещает дальнейшее продвижение.

До финансового журнала сохраняется `operation` со стабильным `step-N`, точными
action/calldata. После receipt сначала завершается запись financial_operations,
затем привязка результата в worker state. Обрыв между ними оставляет прежний
operation ID: повтор получает сохранённый receipt, без второй отправки.
Состояние с финансовой историей нельзя автоматически пересоздать с нуля.

Перед snapshot сохраняется `snapshotIntent`: cycle, label, cutoff, прочитанные
на фиксированном блоке consumed ranges и admission block/hash. Даже при обрыве
после записи ledger snapshot следующий проход использует прежний cutoff.
Текущие cycle/pending/consumed и каноничность admission проверяются повторно.
Snapshot обогащается program/cycle, hash соответствует прежнему файловому формату.

После on-chain freeze worker сохраняет request ID, round и context до prove.
Изменение ранее сохранённого request отклоняется; недоступность beacon не выбирает
новый round. Reorg подтверждённой истории останавливает процесс, не меняет cycle
или RNG. Условия интервала, минимального фонда и отсутствие гарантии победителя
остаются прежними.

## Несколько контрактов

Финансовый журнал получил отдельную схему `local-short-financial-journal-v1`.
Она закрепляет полный проверенный worker config: runtime hashes и getters всех
связанных контрактов, профиль, executor, anchor и gas limits. Модуль БД по-прежнему
привязан к program. Разрешены только пары target/action из проверенной конфигурации:

| Target | Методы |
| --- | --- |
| program | freeze, settle, claim |
| collector | collect, forward, sweepCurve |
| splitter | deliver |
| adapter | prove, deliver |

Calldata декодируется и канонически перекодируется по ABI. Нельзя назвать действие
program.claim и отправить его quote/чужому контракту. Произвольные selectors из
настроек не расширяют этот список. Старый одноконтрактный transport сохранён.

## Регистрация и запуск

Внутренние функции: `registerPostgresWorker`, `runPostgresWorker`,
`readPostgresWorker`. Caller предоставляет отдельные executor/jobs/ingest pools,
provider/signer, project/module/source IDs и проверенный worker config.
Source заранее зарегистрирован и содержит историю до валидного профиля.

Регистрация предназначена для нового локального program с cycle0. Точный повтор
может закончить частичную регистрацию, но не заменить существующий профиль/source
или executor config. Это не способ автоматически принять существующий QIANQI.

На проходе worker ограниченно догоняет общий reader и собственный ledger (до
500 блоков). При отставании возвращает index-catchup, не выбирает новый draw по
неполной истории. Уже сохранённая финансовая операция сначала восстанавливается.
Runtime/getter/canonical RPC-проверки сохранены. Основная сеть не допускается.

## Сквозная проверка

Harness создаёт отдельный PostgreSQL и отдельный fork Robinhood Chain от блока
82000000 на свободном localhost-порту; существующий fork не сбрасывается.
Запускается настоящий Pons TOKEN/USDG с creator2% + base1%, split80/15/5,
порогом покупки10 USDG, фондом от50, интервалом86400 и одним призовым местом.

Проверены привязки, запрет чужого target, RLS, фактическое завершение дочернего
процесса после signed prepare, receipt/state gap, повреждение state checksum,
snapshot gap с новым блоком после cutoff, RNG-save gap, отсутствие beacon,
обрывы после prove/deliver/settle/claim и восстановление прежних hash.
Прямую покупку подтверждает отдельный late publisher; в snapshot312 попыток.
Используется live drand BLS, без ручного seed/reroll.

Backup/restore сравнивает source, raw blocks, все ledger-таблицы, worker_states
и financial_operations. Это восстановление точной копии, не разрешение запускаться
с устаревшего backup без сверки цепочки. Отдельно проверяются прежний файловый
worker и одноконтрактный финансовый журнал как значимые соседи.

## Что ещё не закрыто

Это локальный сквозной путь, не серверный rollout. Нет production finality/clock,
переноса неизвестных маршрутов и pool/native, сервисов/мониторинга/ключевого
хранилища или процедуры восстановления с устаревшего backup. Orchestration state
пока хранится JSON-текстом; его cycles/history требуют политики ограничения и
архивирования для долгой эксплуатации. События/credits и финансовые операции
уже отдельные записи, полного replay покупок на каждом шаге нет.

Роли shared runtime по-прежнему могут выбирать project scope: RLS не заменяет
изоляцию скомпрометированного процесса по credentials. Один сквозной DB worker
проверен здесь; независимость двух финансовых исполнителей покрывает соседний
financial suite, не два одновременно работающих полных draw worker.

Следующий предлагаемый этап — read-only inventory/compatibility и shadow для
QIANQI: определить соответствие его контрактов/маршрутов и сравнить расчёт,
сохранив единственным действующим исполнителем прежний production worker.

## Итог 09.10.2026

- **8/8** сквозных сценариев worker (включая Pons launch), live drand **21341556**,
  выплата **67.5 тестовых USDG**, cutoff82000024; fork4663@82000000/local31337.
- **11/11** сценариев общего harness, включая вызов сквозной репетиции и restore.
  Отчёт: `.local/test-results/shared-2026-10-09T11-33-21-872Z/report.json`.
  Детальный worker: `.local/test-results/first-token-2026-10-09T11-33-33-191Z/report.json`.
- Прежний файловый worker **8/8 PASS**:
  `.local/test-results/first-token-2026-10-09T11-31-56-498Z/report.json`.
- Одноконтрактный financial harness **17/17 PASS**:
  `.local/test-results/shared-2026-10-09T11-31-56-478Z/report.json`.
- `node --test tests/unit/worker-journal.test.mjs` — **4/4 PASS**.

Сквозная репетиция входит одним сценарием в 11 harness-проверок; эти числа нельзя
складывать как полностью независимые тесты. Первый прогон также сохранён;
последний повтор проверил окончательные config/save guards и повтор регистрации.
