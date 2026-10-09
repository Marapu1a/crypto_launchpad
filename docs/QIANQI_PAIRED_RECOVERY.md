# QIANQI: согласованное восстановление native + PostgreSQL

Пакет 10.10.2026. Продолжение [backup safeguards](QIANQI_BACKUP_SAFETY.md)
и [ревью после handoff](GPT_REVIEW_RESPONSE.md). Это операторский инструмент
восстановления на отдельных копиях, не новый финансовый runtime.

## Что считается набором backup

`scripts/recover-qianqi.mjs INPUT OUTPUT` создаёт новый JSON-отчёт с manifest
`qianqi-backup-set-v1`. Он связывает SHA256 native tar.gz и database.dump,
контрольные суммы всех native файлов, binding/config/profile/index hashes,
runtime artifact hash, instance IDs, оба index head/hash и PG view hash.
Сетевые наблюдения включают canonical anchors, latest/finalized head,
latest/pending/ожидаемый nonce, intents, Short/Monthly jobs и RNG-контекст,
проверку выплат и recognition commitments.

В manifest явно стоит `atomic: false`: времена архивов различаются. Nonce
и обязательства перечитываются **во время проверки восстановления**; это
не выдуманная запись того, какими они были во время старого backup.

Вход — `qianqi-recovery-input-v1`: stagingRoot, nativeRoot, bindingFile и его
SHA256, compiledFile и закреплённый compiledSha256, runtimeCommit, database,
два artifacts `{kind, file, sha256, capturedAt}`. `kind` — `native-archive`
и `database-dump`. RPC поступает только через systemd `LoadCredential=rpc-url`.
Ключ/пароль исполнителя инструменту не передаются.

## Предохранители

- CLI принимает только отдельную БД `launchpad_recovery_*` и копии внутри
  `/var/lib/postgresql/qianqi-recovery-*`. Соединение использует
  `default_transaction_read_only=on`, snapshot читается в repeatable-read
  READ ONLY. Отчёт создаётся с `wx`, без перезаписи предыдущего.
- SHA256 архивов, извлечённых manifest/config и каждого state проверяется;
  лишние файлы, symlinks, locks/tmp, повреждение configHash/checksum запрещены.
  Путь чтения переносится, но исходные конфигурации и их hashes не переписываются.
- SQL identity, signer binding, PG view checksum и head проверяются отдельно.
  Одинаковая высота не означает одинаковую ветку или одинаковые credits/rewards.
  После переиндексации могут отличаться время наблюдения и метрики прохода;
  эти поля не финансовые. Остальные данные, включая `creditedAt` и evidence mode,
  должны совпадать. `byteIdentical` отдельно показывает буквальное совпадение.
- RPC разрешает только перечисленные методы чтения; sign/send/admin методов нет.
  Запросы сериализованы, максимум 5/с; HTTP 429/502/503/504 имеют ограниченные
  повторы. Ошибки не печатают endpoint, credentials, signed transaction или
  произвольный текст провайдера.
- Проверяются parent/child lastResolved receipts, canonical block, sender,
  nonce, target, calldata, value и status. Любой pending intent блокирует
  восстановление независимо от наличия receipt; preflight его не очищает.
- Проверяются runtime pins, USDG implementation slot/code, historical reward
  storage и public reserves, текущие prizes/reserves/timing, frozen draw/RNG,
  сохранённые jobs/terminal blocks и опубликованные recognition bundles.
- Нельзя признать старый индекс актуальным только по неизменному nonce:
  проверяются события проекта после native head. Более 50 000 блоков отставания
  требует catch-up вместо неограниченного сканирования. Новые события блокируют
  допуск до переиндексации, даже если их отправил не наш executor.

## Результаты и смысл допуска

`BLOCKED` (exit 2) содержит конкретные причины. `READ_ONLY_RECONCILED` (exit 0)
означает, что проверенная пара и сетевые наблюдения не выявили конфликтов.
**В обоих случаях `executionAllowed: false`.** Отчёт не является токеном допуска,
не запускает службы, не снимает locks и не разрешает старому signer работать
параллельно с новым. Неполные проверки/RPC error дают BLOCKED.

Клиентская библиотека позволяет подменить RPC/observers в синтетических тестах.
Операторский CLI использует только реальные native validators и HTTP RPC;
флага пропуска проверок у него нет.

## Последовательность восстановления

1. На настоящем восстанавливаемом хосте остановить/запретить financial writer.
   Во время репетиции рабочие службы вообще не трогать. Создать новые staging
   directory и БД, проверить outer/inner SHA256, восстановить dump через
   `pg_restore --exit-on-error`. Не восстанавливать старое поверх live.
2. Проверить происхождение dump: CLI проверяет SHA256 файла и состояние БД,
   но сам `pg_restore` не выполняет и не доказывает, кто наполнил эту БД.
   Сохранить операторский сценарий и результат restore как evidence набора.
3. Запустить preflight отдельным systemd transient unit от `postgres`:
   `ProtectSystem=strict`, только staging в `ReadWritePaths`, custody и рабочие
   `/var/lib/qianqi-public`, `/etc/qianqi/public` закрыты через `InaccessiblePaths`.
   Передать только RPC credential. Unit не содержит команд запуска финансового
   executor. Поставить ограничение времени/памяти; остановка — BLOCKED, не success.
4. Если **PG новее native**, не понижать PG head и не переписывать checksum.
   `scripts/reindex-qianqi-recovery.mjs INPUT BLOCKED_REPORT` строит новую копию
   native state, догоняя индекс до canonical PG head. Применяется тот же native
   `indexOnce` и неизменённый config. Target должен быть предком реального
   finalized head; максимум 16 проходов по 1000 блоков, reorg rollback запрещён.
   Три финансовых файла обязаны остаться побайтно прежними. Исходный архив/PG
   остаются нетронутыми; создаются derived archive, lineage report и новые inputs.
   Исторический rebuilt snapshot помечается `recoverySnapshot`, чтобы свежий
   момент replay не выдавал старую высоту за актуальный API. После прерванной
   попытки `--resume` проверяет сохранённую копию, не удаляет locks и пишет
   новые отчёты с timestamp; исходные отчёты не заменяются.
   Если понадобились отсутствующие recognition bundles или чтения не прошли,
   процесс останавливается; не подменять признанные credits догадками.
5. Если **native новее PG**, сначала пройти canonical/nonce/obligation reconciliation.
   Отдельно убедиться, что `chain.issues` пуст и единственный pair blocker —
   `PG_BEHIND_REPUBLISH_AFTER_RECONCILIATION`. Затем в восстановленной БД опубликовать более новую native projection
   через `publishSnapshot` с ролью lp_jobs. Monotonic/branch guard не отключать.
   Не редактировать projection вручную. Повторить preflight до совпадения пары.
6. При конфликте nonce/pending/выплаченной reward/recognition требуется отдельное
   восстановление истории по receipts и canonical events. Этот пакет намеренно
   не «чинит» финансовые журналы и не воспроизводит отправку из старого архива.
7. После согласования копий поднять **только индексатор**, догнать актуальную
   finalized историю, опубликовать projection и проверить API. Затем снова
   проверить native/chain и отсутствие другого writer, и только после этого
   запускать единственный executor через его штатные adoption/lease/send fence.
   Pending signer nonce или необъяснённая история блокируют этот шаг.

При полной потере хоста отдельно нужны custody/credentials и роли/peer mappings.
Они не входят в публичный manifest. Recovery CLI не изменяет production service
units и не делает новую миграцию БД. Старые архивы и отчёты не удаляются.

## Проверки

Точечный набор: `node --test tests/unit/qianqi-recovery.test.mjs
tests/unit/qianqi-adapter.test.mjs tests/unit/qianqi-native-backup.test.mjs`.
Синтетические случаи: несовпадение поколений/ветки, поздний credit/покупка,
уже выплаченная reward, pending intent, nonce gap, stale index, отказ RPC,
запрет send/sign, сохранение native intent и отсутствие дубля broadcast при
потере lease. Это не утверждение о реальной выплате после миграции.

## Реальная репетиция 10.10.2026

Серверный stage: `/var/lib/postgresql/qianqi-recovery-20261010-a`, отдельная БД
`launchpad_recovery_20261010_a`. Исходные native/archive и database.dump скопированы
из проверенных backups. Все 11 внутренних SHA256 платформенного backup прошли,
`pg_restore --exit-on-error` завершился успешно. Live DB/файлы/units не заменялись.

1. Исходная пара заблокирована: native head **84466933**, PG **84470690**.
   Ожидаемый/latest/pending nonce — **85**. На первом ограничении 10 000 блоков
   также сработал catch-up bound. Для окончательного инструмента предел —
   50 000 с явной проверкой project logs, а не пропуском проверки старой истории.
2. Штатный native indexer на новой копии прошёл четыре порции до **84470690**,
   hash `0xba8dcffb9956aa58d08f4ac52eb7b9160bbc3576665d9f489b7ed59adbf4b85a`.
   PostgreSQL не переписывался. SHA256 трёх финансовых файлов остались прежними.
3. Производный архив `20261009T221241Z.tar.gz`, SHA256
   `9a7a5c2a0cd8cc221779a232ad400d1ff696703f75f981e8c82c475d3f0fb07c`.
   Родитель: `20261009T213451Z.tar.gz`, SHA256
   `cf050689fc8ae66a22c98ee7e2cf8bc1acac45159160bd2263d9f87dce02343c`.
   Dump SHA256 `ad189e484d8a2c5b1e1ba197d42d5d88755ee5b71a3526a5a1ef7cab958b9234`.
4. `report-4.json`: **READ_ONLY_RECONCILED**, issues пуст, generation equal,
   nonce expected/latest/pending **85**. Checked 09.10, 22:14:17 UTC
   (10.10, 01:14 МСК), observation head **84500192**,
   hash `0xf5e0374047282817079508bde1a4b21e241cc97946a0c0c9796d7507b6c2cb00`.
   Проверены два controller lane, два сохранённых job, пять rewards,
   четыре recognition commitment. Active frozen draws отсутствовали.
   `byteIdentical: false` ожидаем из-за replay timestamps/metrics и stale status;
   финансовое/public содержимое и evidence mode совпали.
5. HTTP API восстановленной БД на временном loopback-порту дал 200 + `stale`
   на head 84470690. Настоящая `lp_api` роль: unscoped SELECT возвращает 0 строк,
   таблица executor запрещена, POST → 405, неизвестный Host → 421.
   API и финансовый sender на production не переключались.

В репетиции выявлены и исправлены две особенности инструмента: RPC 429 при
слишком частых чтениях (добавлены сериализация/ограниченные повторы), и необходимость
использовать native `indexerFormat` при записи stale-маркера compact snapshot.
Промежуточные отчёты и архивы сохранены; ошибки не запускали финансовое исполнение.

Локально прошли **12 recovery-тестов**, плюс **4 соседние проверки** adapter/native
backup. Последующие защитные проверки запрещённого output root и отсутствующей
reward coverage проверены адресно. On-chain данные репетиции относятся к указанному
окну; после него требуется новая проверка. Live units в конце active, у индексатора
0 ошибок; он штатно догонял очередной finalized target.

Реальная репетиция покрыла ветку **PG новее native**. Обратная ветка и конфликтные
события проверены синтетически; её публикация использует существующий monotonic
`publishSnapshot`, а не новый обход SQL guard. Новый реальный draw/payout не
форсировался. Финансовый startup после полной катастрофы и custody recovery здесь
не выполнялись — это не декларация автоматического disaster recovery.
