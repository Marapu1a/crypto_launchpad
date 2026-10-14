# Pons → исполнитель: локальная интеграция и перенос истории

13–14.10.2026, рабочее дерево поверх e3585b6. Продолжение
[учёта Pons](PONS_PURCHASE_ACCOUNTING.md). Production не запускался, QuickNode
не опрашивался. Экспортированы только публичные policy/read evidence, frozen sets
и результаты replay; ключи и подписанные transaction journals не копировались.

## Реализация

- [Адаптер](../src/tickets/pons-accounting.mjs) проверяет источник/свежесть отчёта,
  token/quote/порог, уникальные сделки и расчёт суммы. Не доверяет готовому
  report.totalTickets: заново считает из нормализованных действий.
- [Worker](../server/shared/draw-worker.mjs) имеет только внутренний параметр
  ponsRehearsal. Он требует hardhat_metadata с локальным EDR/Hardhat chain4663;
  в production config, HTTP API и start.mjs этот параметр не предоставляется.
  Это стендовая интеграция, не готовый production toggle и не защита от поддельного
  произвольного provider, переданного самим вызывающим кодом.
- В этом режиме scanDrawHistory и recognitionPlan не вызываются. Комиссии,
  freeze, drand prove/deliver, settle, claim и транзакционный журнал используют
  существующий исполнитель. On-chain подтверждения покупок не публикуются.
- Старый ledger не переписывается. Отдельный runtime.ponsAccounting связывает
  source profile с policy digest и хранит происхождение каждой покупки.
- Старые подтверждённые покупки имеют приоритет по txHash/logIndex: прежние
  кошелёк и сумма сохраняются, совпавшая запись Pons не получает второй credit.
  Расхождение заносится в legacyDifferences с preserve-existing-credit.
- Новые покупки считаются по trader/quoteAmount Pons. Коррекции после импорта,
  исчезновение строки, unknown venue или смена profile блокируют новый импорт.
- Short/Monthly вычитают свой consumedThrough. Frozen sets не переписываются.
  Новые snapshots хранят accountingRevision: даже поздняя API-запись в том же
  finalized-блоке не меняет ранее зафиксированный состав.
- Старые frozen snapshots продолжают проверяться старым способом, включая
  pending freeze; новый accountingSource ставится только новым snapshots.
- [Проекция](../server/short-runtime/draw-projection.mjs) показывает источник Pons,
  checkedAt/revision, issued/used/reserved/available; API-данные не названы
  доказанной on-chain историей. Сами состояния фондов читаются на finalized блоке.

## Проверка сохранённых данных действующих проектов

Источник: read-only SSH/SELECT и чистый локальный replay на VPS, без RPC.
Файлы `.local/pons-accounting/migration/source-public-state.json`,
`qianqi-lifecycle.json`, итог `comparison.json`.
[Повторяемый расчёт](../scripts/rehearse-pons-accounting.mjs) не содержит сети.
Checkpoint в этом сравнении не предназначен для отправки в контракт: для отбора
API-данных используется время отчёта, а не утверждение о timestamp старого блока.

IGW: в сохранённом runtime нет cycles, pending executor tx и purchase confirmations.
Сравнительный gross результат 38 билетов, старых подтверждённых credits 0.
Это не актуальная on-chain сверка всех действий третьих лиц.

QIANQI: 68 ранее признанных покупок, 2 исторических draw, 5 наград со статусом paid
в сохранённой проекции; replay показывает pending SHORT/MONTHLY=null.
В 6 покупках Pons trader отличается от прежнего payer/recipient; ещё в одном
примере различается сумма 198/200 USDG. Эти 7 расхождений открыто сохранены.
Семантика всех trader-маршрутов Pons по этому исследованию не гарантируется;
новая модель сознательно принимает адрес, указанный Pons, для новых начислений.

| Расчёт QIANQI | Начислено | Использовано | Зарезервировано | Остаётся |
|---|---:|---:|---:|---:|
| Short, сохранены прежние credits | 28 | 16 | 0 | 12 |
| Monthly, сохранены прежние credits | 28 | 0 | 0 | 28 |

Чистый пересчёт Pons давал 27. После переноса старого учёта получаем прежние
28 и те же открытые остатки; исторический расход не потерян. Это две независимые
линии расходования, нельзя складывать их в 40 общих билетов.
Legacy rules epochs, draws и rewards сохранены в сравнительном результате.
Последующее [продолжение QIANQI](QIANQI_PONS_MIGRATION.md) реализует локальное
распределение новых credits по текущим эпохам при принятии; синхронизация
изменений контроллеров и подключение scheduler ещё остаются отдельной задачей.
Универсальный v2 worker не объявляется заменой прежнего исполнителя.

## Проверки

13 unit tests PASS: новый адаптер и соседняя public projection. Включены
перезапуск/дедупликация, grandfather credits с другим адресом, late source revision,
consumed ranges, невозможный расход, stale/corrected/missing/duplicate source,
profile binding и отказ non-local provider до обращения к sender.

Контрактный [новый harness](../tests/contracts/pons-draw-worker-cycle.mjs):
4 сценария PASS в трёх режимах Short/Monthly/оба; после добавления source revision
повторён режим оба — 4 сценария PASS. Проверены отсутствие getLogs/debug_trace
и recognition-транзакций, восстановление подписанного намерения, неизменность
frozen sets, prove/settle/claim и перезапуск без повторных выплат.
Стенд использует отдельный PostgreSQL и локальные контракты chain4663,
сохранённый BLS vector; публичных отправок нет.
Отчёты: `.local/test-results/pons-draw-worker-2026-10-13T20-42-33-949Z/report.json`
и `.local/test-results/pons-draw-worker-2026-10-13T20-50-10-958Z/report.json`.

Прежний `draw-worker-cycle.mjs`: 3 сценария PASS, включая три режима,
recognition/finality, независимые проекты, четыре frozen cycles, поздние credits
и выплаты без повторов после перезапуска. Отчёт:
`.local/test-results/draw-worker-2026-10-13T20-46-59-970Z/report.json`.
Проверка документации: 725 локальных ссылок, 0 отсутствующих файлов;
`git diff --check` без ошибок. Локальный `/migration.html` отвечает HTTP 200.

```powershell
node --test tests/unit/pons-accounting.test.mjs tests/unit/draw-projection.test.mjs
node tests/contracts/pons-draw-worker-cycle.mjs
node tests/contracts/pons-draw-worker-cycle.mjs --dual-only
node scripts/rehearse-pons-accounting.mjs
```

## Остаётся до production

1. Версионированная source-policy/граница миграции и storage import с сохранением
   identities, действующих consumed/frozen, legacy credits и эпох QIANQI.
2. Адаптер старого QIANQI executor, а не подмена его v2 контрактами.
3. Production wiring collector → worker, freshness/error UI, RPC только для фондов,
   случайности и отправок; отдельный smoke/release с бесплатным endpoint.
4. Оптимизация повторных policy/projection чтений из аудита остаётся отдельной:
   отсутствие trace/getLogs для покупки не делает текущий worker дешёвым в покое.

Ни один из этих пунктов не выполнен фактом локального стендового теста.
