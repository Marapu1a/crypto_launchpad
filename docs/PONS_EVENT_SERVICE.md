# Обслуживание по изменениям Pons

2026-10-14 follow-up: [event-driven wake policy](PONS_EVENT_WAKE.md) removes the flat 30-minute RPC check for proven-idle tokens. Activated on the server as e2731ea at 15:37 UTC; both projects entered event-only sleep with nextCheckAt=null. Alchemy remains the sole allowed RPC host. Earlier periodic-control descriptions below describe the previous policy.

14.10.2026, рабочее дерево поверх e3585b6. Локальная реализация общей
[модели токенов](TOKEN_SERVICE_MODEL.md). VPS и платный RPC не запускались.

## Реализованный цикл

`server/shared/pons-service.mjs` — общий supervisor одного токена.
Один tick читает готовый отчёт Pons без RPC. После полного подтверждённого idle:

- обновился только `checkedAt`, сделки и профиль прежние — worker и projection
  не вызываются, возвращается `service-sleep` с временем последней проверки;
- изменилась покупка, продажа или профиль — worker вызывается сразу на следующем
  tick, включая сбор комиссий и проверку обязательств;
- наступило известное время проверки draw либо прошло 30 минут — контрольный
  проход даже без новых торгов (например, для поступившего извне пополнения);
- незавершённая транзакция/RNG, неизвестное состояние или неполные данные не дают
  разрешения на длительный сон; дальнейшую частоту задаёт active/backoff cadence;
- рестарт сбрасывает только разрешение на сон: первый проход сверяет реальные
  обязательства из существующего durable journal;
- одновременный второй tick того же экземпляра возвращает busy, не запускает
  второго исполнителя. Существующие DB leases/журналы и guards не заменяются.

Проверка источника: возраст до 660 секунд, status current, без review/error,
согласованность tradeCount/activity. Рабочий fingerprint включает профиль и все
строки activity, включая продажи; `checkedAt` не считается финансовым событием.
Полную проверку профиля и корректности учёта по-прежнему выполняет worker.
Ошибка или stale источника не маскируется как отсутствие торговли.

`createPonsDrawService(input, options)` подключает v2, а
`createPonsSchedulerSupervisor(input, options)` — QIANQI. Они используют один
supervisor и сохраняют прежние финансовые пути. `now` задаётся в миллисекундах
supervisor, в секундах прежним worker. `publish` вызывается только после реального
worker pass; при ошибке публикации разрешение на сон не сохраняется.

Сборщик Pons по-прежнему независим от RPC: tick можно вызывать при новом отчёте
или часто читать локальный файл. Supervisor не создаёт собственный HTTP poller,
таймер, credential или production service. Старые production entrypoints не
переключены: новый путь пока ограничен Hardhat rehearsal.

## Публикации QIANQI без диапазонных логов

`server/adapters/qianqi/pons-publications.mjs` сохраняет ссылки на публикации
DatasetChunk/MonthChunk из подтверждённых receipts в checksum-защищённом журнале.
Прежний validator получает события из этих известных receipts вместо `getLogs`.
Проверяются canonical block, успешность receipt, адрес/позиция события; прежние
проверки calldata, chunk hash, root/count и всего списка участников остаются.

Неизвестная сторонняя публикация не ищется по цепи: неполный список не пройдёт
прежнюю проверку. Для явного восстановления можно передать известные receiptHashes.
Это относится к новому Pons scheduler; старый indexer/legacy entrypoint всё ещё
содержит прежние log readers и не должен включаться как будто уже мигрирован.

## Что это меняет в расходах

Нулевой RPC возможен между контрольными проверками при подтверждённом простое.
Начальный/контрольный проход по-прежнему выполняет полный набор проверок;
стоимость активного draw и повторные проверки внутри v2 не оптимизированы этим
изменением. Это не подтверждение месячного Free-бюджета при любой активности.

Период контроля 30 минут — новый локальный default, а не изменённый production
config. Снимок сайта при пропуске работы не обновляется и не получает фиктивный
`Last verified`. Нынешний TTL 660 секунд может пометить его stale до следующей
проверки. Отдельная свежесть Pons/контрактов и UI должны быть согласованы перед release.

## Проверки

16 unit-тестов: одинаковая политика адаптеров, изменение source/heartbeat,
контрольный срок и draw deadline, незавершённая работа, плохой источник, рестарт,
ошибка публикации, изоляция проектов, конкуренция и изменённые receipts — PASS.
V2 передаёт явное `serviceIdle`: ожидание RNG в одной lane не может быть скрыто
причиной «нет участников» из другой lane. Без этого признака supervisor не спит.
Полные контрактные сценарии обоих адаптеров проверяют начальный проход и следующий
tick с неизменившимся источником: он не должен сделать ни одного RPC.
В QIANQI-тесте `getLogs` запрещён вообще, включая собственные публикации.

Итоговые контрактные прогоны — PASS:

- QIANQI: `.local/test-results/qianqi-pons-2026-10-14T09-26-04-908Z/report.json`,
  8 сценариев; начальный контроль supervisor 87 RPC, повторный неизменившийся tick 0,
  публикационные log ranges 0.
- v2 dual: `.local/test-results/pons-draw-worker-2026-10-14T09-29-55-077Z/report.json`,
  4 сценария; полный цикл после добавления явного all-lanes idle evidence,
  повторный неизменившийся tick 0 RPC. Это стенд движка с двумя модулями, не live IGW.

```powershell
node --test tests/unit/pons-service.test.mjs tests/unit/pons-publications.test.mjs tests/unit/service-cadence.test.mjs tests/unit/economy.test.mjs tests/unit/qianqi-economy.test.mjs
node --test tests/contracts/qianqi-pons-scheduler.test.mjs
node tests/contracts/pons-draw-worker-cycle.mjs --dual-only
```

Остаётся production wiring со свежим состоянием, общий throughput/CU-бюджет,
ограниченные повторы и квалификация бесплатного endpoint. Остановленные службы
и QuickNode в этом пакете не включались.
