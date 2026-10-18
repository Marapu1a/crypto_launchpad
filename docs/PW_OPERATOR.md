# PW: подготовка рабочего запуска и обслуживание

19.10.2026. Код подготовлен и проверяется локально. PW не запущен,
production-службы и существующие QIANQI/IGW не изменены.

## Что добавлено

- Отдельный `pw-production-profile-v1`: chain 4663, канонический finalized anchor,
  проверенные Pons factory/router/escrow/hook/helper, согласованный hash сборки,
  отдельные owner/executor/publisher, получатель проектной доли и явные газовые лимиты.
- Coordinator сохраняет прежний fork-режим, но теперь имеет production-путь.
  `quote` оценивает ближайший исполнимый шаг через RPC и добавляет 20% запаса газа
  в пределах выбранного лимита. Это технический запас оценки, не новая комиссия
  и не выбранный месячный бюджет. Зависимые шаги оцениваются после предыдущих.
- Подписанные байты сохраняются до отправки. Повторная отправка использует тот же
  hash; неизвестный результат не разрешает создать следующую транзакцию.
  После перезапуска проверяются receipts, каноническая ветка и адреса контрактов.
- После finalized запуска можно передать holder-программу в БД: реальные адреса,
  launchAt, 30-дневный график, минимальная выплата, источники комиссий и правила снимка.
  Повторная регистрация не сбрасывает историю и не подменяет конфигурацию.
- Отдельный holder-оператор: оценка стоимости конкретной операции, сохранение
  подписи, отправка, восстановление receipt, сканирование выплат и сверка истории.
  Нет постоянного опроса, автоматической консолидации мелочи или встроенных ключей.

## Сверка без предела общего числа транзакций

Миграция `020_holder_reconciliation.sql` добавляет изолированный по проектам
курсор. `resumeHolderReconciliation` проверяет до `maxItems` записей за вызов
(по умолчанию 50, максимум 2 000); это размер порции, а не предел всей истории.
Позиция, суммы и промежуточные публикации сохраняются вместе с checksum.

Все порции связаны с одним finalized-блоком и fingerprint исходных журналов.
Ошибка RPC откатывает только текущую порцию; другой процесс продолжает сохранённую.
Reorg останавливает проход. При изменении журналов нужно явно начать новый проход
с `restart:true`. Результат `progress` не означает успешную сверку и не разрешает
отправлять деньги. Только `reconciled` содержит проверенные итоговые суммы.

Совместимый `reconcileHolderExecution` начинает новый ограниченный проход;
продолжать его нужно через `resumeHolderReconciliation`, а не повторять старт.
Fingerprint вычисляется по всей истории в PostgreSQL: объём RPC ограничен порцией,
но это ещё не постоянная по времени проверка БД. Исторический finalized-state
должен оставаться доступен на RPC до завершения прохода.

## Запуск оператора

`npm run pw:operator -- --help` показывает команды. Формат:

```text
npm run pw:operator -- /absolute/private/operator.json launch-prepare input.json
npm run pw:operator -- /absolute/private/operator.json launch-quote
npm run pw:operator -- /absolute/private/operator.json launch-read
```

Приватная конфигурация имеет `schema: "pw-operator-v1"`, `profile`, `holders`,
`rpcFile`, `databaseFiles` (`executor`, `jobs`, `admin`) и
`allowPublicTransactions: false`. Пути к credentials абсолютные; в Linux файлы
должны иметь приватные права. В конфигурации хранятся пути, не ключи или RPC URL.
У executor должна быть роль `lp_executor`, у jobs — `lp_jobs`; admin используется
только явной командой регистрации проекта. Нужны миграции по 020 включительно.

`profile` содержит:

- `schema: "pw-production-profile-v1"`, `mode: "production"`, `executionEnabled: false`;
- `id`, `chainId: 4663`, `buildHash`, `anchor: {number, hash}`;
- `owner`, `executor`, `publisher`, `project`;
- `externals` из `PW_EXTERNALS` в `server/owner-launch/pw-profile.mjs`;
- `timing: {lead, clockLag, clockAhead, finalizedLag, beaconLag}`;
- положительные строковые `maxGasLimit`, `maxFeePerGas`, `totalNativeLimit`,
  `nativeFloor` (денежные значения в wei).

`holders` содержит явно выбранные `tokenCodeHash`, `exclusions`, `maxHolders`,
`maxRpcCalls`, `maxAgeSeconds`, `maxGasLimit`, `maxFeePerGas`, `nativeFloor`.
Runtime токена должен быть проверен, а не просто скопирован из неизвестного контракта.
Список исключений обязательно включает curve; остальные служебные адреса, burn
и известные pools должны быть перечислены и показаны владельцу перед регистрацией.
Чужие контракты автоматически не исключаются.

После проверки quote внешняя подпись передаётся файлом в `launch-record`
(`{"rawFile":"/absolute/private/signed.txt"}`); затем `launch-broadcast`,
`launch-resolve`. Эти действия не вызываются автоматически. Запись production-подписи
и отправка требуют отдельного серверного `allowPublicTransactions:true`.
Параметр запроса не включает этот переключатель. Подписывать/публиковать без
отдельного решения владельца нельзя.

После запуска: `handoff-preview`, затем `handoff-register`. Регистрация создаёт
проект со статусом `test`, holder-программу и execution policy; не запускает daemon.
Для ежемесячного обслуживания есть `holder-funding`, `holder-snapshot`,
`holder-admit`, `holder-plan`, `holder-quote`, `holder-record`, `holder-broadcast`,
`holder-resolve`, `holder-advance`, `holder-scan`, `holder-reconcile`.
Payload соответствует аргументам функций в `server/shared/holder-preparation.mjs`
и `holder-execution.mjs`; `provider` и scope берутся из приватной конфигурации и
проверенного launch-журнала. `rawFile` используется вместо приватного ключа.

## Граница готовности

Это рабочий оператор запуска и holder-обслуживания по запросу, не готовая кнопка
публичного запуска и не включённая автоматическая финансовая служба.

До реального старта остаются:

1. Выбрать тикер, реальные адреса, budget/reserve, snapshot limits и исключения;
   проверить доступный RPC на конкретном token runtime и finalized-блоке.
2. Подключить owner UI/подпись. Сбор комиссий и draw теперь имеют отдельный
   [PW service adapter](PW_SERVICE.md); регистрация службы выполняется после
   holder-handoff, отдельно от её активации.
3. Проверить страницу PW, полный эксплуатационный цикл и провести финальное ревью.
4. Отдельно разрешить реальные отправки и развёртывание служб.

Расчёт газа на большие списки: [HOLDER_GAS_BENCHMARK](HOLDER_GAS_BENCHMARK.md).
Месячная частота, минимальные суммы и доли 60/20/20 не изменены.

## Verification evidence

Source: HEAD `2b5d3d1` plus the current uncommitted PW package, 2026-10-19 Moscow.

- `.local/test-results/pw-launch-2026-10-18T21-35-39-351Z/report.json`: PASS; nine real-Pons fork steps, quote and reserved-byte broadcast, restart recovery, finalized holder handoff, idempotent registration and changed-profile rejection. 182 bounded remote reads, no public sends.
- `.local/test-results/pw-rehearsal-2026-10-18T21-38-13-882Z/report.json`: PASS; two holder periods and skipped calendar period, local draw, on-demand holder operator, paged reconciliation resumed by a fresh process, reorg/input-change/RPC-failure guards, and incomplete reconciliation cannot advance the period.
- `node --test tests/unit/pw-production.test.mjs`: 4 PASS. Relevant owner-production/schedule neighbours: 8 PASS.
- Syntax checks, changed documentation links and `git diff --check`: PASS.

The production gates are tested locally; no live deployment, real-wallet signature, production migration or service activation occurred. Fixture budgets and addresses are not production selections.
