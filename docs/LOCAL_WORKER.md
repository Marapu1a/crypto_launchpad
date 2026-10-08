# Постоянный исполнитель Short — 08.10.2026

Локальный исполнитель обслуживает уже развёрнутый токен: индексатор, sweep/collect,
split, freeze, drand prove/deliver, settle и claim. Один проход отправляет не более
одной транзакции. `--watch` продолжает проходы, `--once` удобен для диагностики.
Production admission и deployment из UI в этот пакет не входят.

## Что перенесено из QIANQI

Прочитаны исходники `D:/sites/rh_project` на HEAD
`11a050d995f17c2c810db1fe5c4e7a3ec1190ff3`:

- `scripts/pons-transaction-journal.cjs`: durable intent, сверка receipt/nonce/
  calldata/отправителя/блока, подписанный payload перед broadcast.
- `scripts/pons-automation.cjs`: отдельный конфиг экземпляра, runtime/binding guards,
  единая граница отправок, ограничение газа, сверка прошлой транзакции перед новой.
- `scripts/drand-delivery-worker.cjs`: фиксированный request, независимое продолжение
  prove/deliver, запрет замены случайности.
- `scripts/local-scheduler-state.cjs` и `run-pons-automation.cjs`: exclusive lock,
  checksum, fsync+rename, ограниченные проходы и явная остановка при неоднозначности.

Исходный checkout имеет собственные незакоммиченные изменения; они не переносились
и не изменялись. Сервер и production QIANQI не проверялись. Наблюдения относятся
к исходникам, а результаты ниже — к новой платформе.

## Граница отправки и восстановление

`src/worker/journal.mjs` подписывает запрос локальным тестовым Wallet и сохраняет
полные signed bytes, hash, nonce, sender, target и calldata **до broadcast**.
После обрыва повторяется тот же raw transaction, а не создаётся новый nonce.
Если квитанция уже есть, проверяются транзакция и канонический блок, после чего
запись становится history. Подписанные bytes удаляются из разрешённого намерения.

Состояние с pending не допускает новую отправку. Чужой занятый nonce, несоответствие
квитанции, runtime/config drift или reorg останавливают работу. Revert записывается
как failure и требует разбора; исполнитель не пытается исправить его новой
случайностью или новым составом. Ожидание дорогого газа/недостатка ETH не создаёт
намерение. Отправка native value запрещена; газовые лимиты задаются явно.

Журнал сохраняется через временный файл, fsync и rename; checksum проверяется при
каждом чтении. Он защищает от повреждений, не от злонамеренного владельца файлов.
Lock программы и отдельный lock отправителя не допускают двух исполнителей
одновременно **в одном stateRoot**. Для узла требуется один общий stateRoot и
выделенный кошелёк executor без посторонних отправителей nonce. Распределённого
lock между несколькими хостами или независимыми stateRoot пока нет.

Снимок участников записывается до freeze. Если процесс завершился между записью
индексатора и worker state, он восстанавливается по сохранённому cycle/label.
При уже запущенном цикле отсутствие собственной истории — ошибка, а не повод
заново выбрать участников. Подтверждённые выплаты проверяются по rewards в контракте.
Каждый следующий проход заново читает состояние, поэтому завершённый шаг не
повторяется только из-за устаревшего локального номера стадии.

## Запуск

Конфиг создаётся `createWorkerConfig(provider, { profile, collector, executor, limits })`.
Он закрепляет сеть/fork instance, ticket profile, адреса и runtime hashes,
quote/program/collector/splitter/adapter bindings. Контракты должны уже существовать,
collector должен быть привязан; оператор Short должен совпадать с executor.

```
node scripts/run-local-worker.mjs config.json stateRoot local-test-key.txt http://127.0.0.1:PORT --once bundles
node scripts/run-local-worker.mjs config.json stateRoot local-test-key.txt http://127.0.0.1:PORT --watch bundles
```

RPC разрешён только loopback HTTP и fork4663 с chainId31337; проверка происходит
до чтения ключа. Используется отдельный сгенерированный ключ тестового executor,
не QIANQI key. Конфиги, ключ и журналы хранятся в игнорируемой `.local/`.
CLI выводит hash/status/action, а не private key или raw signature.

Watch делает короткие проходы и ждёт между ними. Ошибки RPC с кодами NETWORK_ERROR,
TIMEOUT и SERVER_ERROR оставляют состояние и приводят к ожиданию следующего прохода.
Прочие ошибки останавливают CLI. Недоступный beacon оставляет прежний request;
неверная подпись/раунд не принимаются. Ждать drand не мешает погашать уже доступные
доли. На локальном Hardhat время блоков нужно продвигать майнингом; worker сам
не подменяет часы и не выполняет `evm_increaseTime`.

## Аварийные locks

При нормальном выходе locks снимаются. После kill/падения ОС файлы могут остаться.
Как в QIANQI, устаревший lock не удаляется по возрасту. Сначала остановить все
launchers этого экземпляра, затем выполнить отдельную команду:

```
node scripts/run-local-worker.mjs config.json stateRoot local-test-key.txt http://127.0.0.1:PORT --recover-locks
```

Она проверяет конфиг сети и владельца каждого lock: тот же host, корректный PID,
процесс действительно отсутствует. Живой/неизвестный владелец — отказ. Проверяются
sender, worker и ticket locks. Файлы старого формата без владельца требуют ручного
разбора. Повреждённый state, reverted transaction и reorg эта команда не исправляет.
После неё обычный запуск сначала сверяет pending, затем продолжает работу.

## Проверка

`npm run test:worker` создаёт изолированный исторический fork82000000, новый токен
и отдельный тестовый ключ, затем завершает тестовую сеть. Владелец локального
ключа — случайно сгенерированный executor, деньги — только локальные fixtures.

8 интеграционных сценариев PASS, включая запуск Pons и:

- реальный выход дочернего процесса до broadcast и после broadcast;
- восстановление тем же hash и nonce, отсутствие второй отправки после receipt;
- прерывание на receipt и RPC timeout без перезаписи pending;
- конкурентный запуск/живой lock/повреждённый checksum;
- автоматический fee flow, поздние подтверждения и snapshot → freeze;
- недоступный beacon и прерывания prove/deliver/settle с новым процессом при возобновлении;
- выплата, повторные проходы без второй выплаты и halt после reorg.

Live round **21318996**, выплата **67,5 USDG**. Условия первого токена 24 часа/50 USDG/
10 USDG/80-15-5 сохранены. В этой репетиции покупок на 3125 USDG, поэтому сумма
отличается от предыдущего прогона с дополнительными 10 USDG второго покупателя.
12 unit-сценариев PASS: 4 новых journal + 8 соседних ticket.

Отчёт `.local/test-results/first-token-2026-10-08T16-45-44-732Z/report.json`,
рядом worker config/state, snapshots/bundles, локальный ephemeral key. Исторический
отчёт содержит унаследованную строку limits про manual no-winner fixture; в
`workerMode:true` эта фикстура не исполнялась и использован только live drand.
Финальный reorg намеренно делает test state непригодным для продолжения.

Пока не покрыты: mainnet signer/deployment/finality/clock policy, неизвестные
маршруты и pool sweep, непрерывная эксплуатация службы на сервере, distributed
locks, автоматический ремонт locks/state и управление заменой застрявшей транзакции.
Этот пакет добавляет восстанавливаемый локальный исполнитель, не разрешение mainnet.

После добавления owner metadata в ticket locks выполнен соседний test:tickets:fork:7/7 PASS, .local/test-results/tickets-2026-10-08T16-49-52-832Z/report.json.
