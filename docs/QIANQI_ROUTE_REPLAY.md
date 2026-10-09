# QIANQI: проверка маршрутов выборки53

09.10.2026. Следующий пакет после [accounting shadow](QIANQI_TICKET_SHADOW.md).
Плательщик, получатель и сумма53 покупок теперь вычисляются проверяющими модулями
из calldata, опубликованного trace и canonical receipt. API используется для
сравнения, не как источник суммы или payer. Проверка read-only, financial executor
по-прежнему закрыт (`executionEligible=false`).

## Реализация

`src/qianqi/route-replay.mjs` закрепляет профиль существующего QIANQI/USDG,
проверяет original tx/receipt/log positions, включение tx в block, parent hash,
исторические runtimes и вызывает узкие route verifiers.
`replayVerifiedCohort` самостоятельно вычисляет entries/carry по порогу100USDG,
берёт первую creditedAt из проверенных commitments, пересчитывает оба lanes.
Из API не заимствуются `entriesMinted`, статус ELIGIBLE, сумма или адрес плательщика
для этого пересчёта; предыдущий accounting shadow перепроверяется как исходная сверка.

`src/qianqi/routes/` содержит отдельную адаптацию чистых модулей из исходного
QIANQI. Новых native-файлов не было в vendor ae445254. Источник — commit
`11a050d995f17c2c810db1fe5c4e7a3ec1190ff3`, публичные runtime pins/edges и verifier
исходники; выбранные файлы были clean, остальной checkout dirty. SHA256 исходных
файлов и описание адаптации — `src/qianqi/routes/SOURCE.json`.
CLI исходников удалены, нет импорта production-конфигов, journals, secrets,
release manifests. Vendor и исходный checkout не изменены.
Это профиль QIANQI, не разрешение запускать новые токены с теми же pins/порогом.

Проверки маршрутов включают:

- 65050: canonical calldata, один terminal BUY, payer=recipient, wallet-net-debit
  для USDG либо фактический quote в curve для native, funding/fees/deadline;
- Park: ограниченные команды, фиксированные runtime/edges, native funding,
  получатель; отдельно допускается проверенный7702 self-call с известной implementation;
- native settlement: фиксированные selectors/edges/runtimes, полный trace/log
  match, quote settlement и доставка; только ранее проверенное исключение reverted
  Meta probe и разрешённый1wei dust, без общего fallback;
- v4 funding: caller input/output delta и settlement; оборот vault внутри hook
  не добавляется к цене покупки и билетам.

Все адреса в runtime evidence перечитываются на блоке покупки и предыдущем блоке
через RPC либо берутся из сохранённого проверяемого raw evidence. Hash code должен
совпасть и с committed proof, и с reviewed pins проверяющего маршрута. Проверяется
canonical historical head до и после прохода и его положение относительно finalized.

## Запуск и артефакты

```powershell
node scripts/qianqi-route-replay.mjs .local/test-results/qianqi-shadow-2026-10-09T12-12-21-030Z

# После прерывания можно переиспользовать сохранённые полные evidence rows:
node scripts/qianqi-route-replay.mjs <shadow-directory> <earlier-route-directory>

# Только локальные проверки и мутации сохранённых доказательств, без RPC:
node tests/qianqi/routes.mjs <successful-route-directory>
```

Без аргумента используется именно указанный исторический shadow, не неявный latest.
Пакет ограничен53 покупками. Каждая запись нового каталога содержит proof, tx,
receipt, block/parent и bytecode at/before. Отчёт хранит Git HEAD/dirty и SHA256
выполнявшихся файлов. Старые каталоги не перезаписываются.
RPC URL не сохраняется. Allowlist только chainId/block/transaction/receipt/code,
никаких signer, send или debug trace. Лимит3000 запросов/10мин,150мс между стартами
запросов; HTTP429/502/503 — максимум3 попытки. Другие ошибки останавливают проход.
Reuse не обходит verifier: каждое доказательство проверяется повторно и связывается
с committed proof исходного shadow. Финальный head перечитывается без кеша.

## Результат

**ROUTE_COHORT_MATCH**, 2026-10-09T12:33:18.288Z—12:34:17.203Z.
`.local/test-results/qianqi-routes-2026-10-09T12-33-18-288Z/report.json`.
Базовый HEAD885f8c5 + новый код в рабочем дереве; hashes проверяющих модулей
сохранены в report.sourceHashes. Последующие изменения runner касались записи
ошибки при плохом reuse и расширения списка sourceHashes; route logic не менялась.

Исходная сверка на block **84135771**:
`0x0838573c5fd2fad3760a931a8e109e3c02c069f0612628cc40c5efa02297f78c`.

| Проверка | Результат |
|---|---|
| Проверенные покупки | 53 из53 |
| 65050 / Park / native settlement | 29 /12 /12 |
| Кошельки | 48 |
| Сумма проверенных покупок | 4169.169694 номинальных USDG |
| Суммы, payer, per-purchase entries относительно API | Расхождений нет |
| Open Short / Monthly | 12 /26 |
| Consumed Short / Monthly | 14 /0 |

Первый проход12:31:28 сохранил38 проверенных rows и завершился INCOMPLETE после
HTTP429,864 RPC attempts. Повтор с ограничением частоты переиспользовал эти38,
закончил остальные15 и выполнил292 RPC attempts. Переиспользование отмечено
в report.reusedEvidence. Платные услуги/тарифы не подключались.

Тесты: **10 evidence tests +19 соседних shadow tests PASS**.
Проверены53 положительных примера, затем подмена original hash/parent/receipt,
ошибка исполнения, caller, authorization, selector, runtime и даже одновременно
поддельные matching proof hashes. Согласованная подмена trace+receipt для суммы
USDG или получателя тоже отклоняется. Отдельно7702 implementation и v4 caller delta.
Тест подменяет API сумму и подтверждает: verified balances не меняются, появляется
расхождение. Повтор одной покупки не допускается. Проверки не требуют обращения
к production и не запускают financial worker.

## Что этот результат ещё не доказывает

Trace взят из публичного commitment bundle, новый debug_traceTransaction не
запрашивался. Verifier связывает его с заново прочитанными tx/receipts/code и
проверенными формами исполнения, но сам trace остаётся утверждением publisher/RPC,
не криптографическим execution proof. Сохранены те же алгоритмы QIANQI: это
перенос и проверка доказательств, не независимый security audit протокола.
Code at/before не доказывает отсутствие временной смены внутри блока.

Выборка53 не равна полной истории токена. Общие snapshot hashes, первые обычные
покупки вне late cohort, полнота RPC selection, RNG и выплаты ещё не пересчитаны.
Существующие on-chain commitments не означают разрешение нашего financial executor.

Следующий пакет — собрать полную проектную BUY/lifecycle историю до того же
контрольного блока и воспроизвести snapshot hashes обоих завершённых Short,
включая покупателей вне поздних пакетов. Это требуется до репетиции переноса
состояния; QIANQI продолжает работать своим прежним worker.
