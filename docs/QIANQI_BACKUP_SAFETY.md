# QIANQI: backup failure detection и операторская тревога

Пакет 10.10.2026 после [ревью GPT](GPT_REVIEW_RESPONSE.md).
Не меняет runtime финансового исполнителя, контракты или экономику.

## Поведение

- `ops/qianqi/backup-public.sh` запускает `backup.py`. Сохраняются прежние timer,
  native helper, архивный формат и `/run/lock/qianqi-public-backup.lock`.
- До остановки: helper SHA256, ожидаемые JSON/пути, pinned config hashes,
  проверка файлов release, writable destination, минимум 1 GiB свободного места
  или четырёхкратный размер исходников backup (что больше), минимум 1000 inodes.
  Проверка manifest здесь обнаруживает повреждение файлов; доверенный digest
  release по-прежнему закреплён отдельно в `ExecStartPre` финансовых служб.
- Перед stop сохраняется `/var/lib/qianqi-backup-status/status.json`:
  этап, время, `wasActive`, `stopRequested`, предыдущий `lastSuccess`.
  Запись атомарна, fsync файла и директории. В статусе нет содержимого журналов,
  credentials, подписанных транзакций или URL RPC.
- После ошибки **нет автоматического resume**, в том числе индексатора.
  При partial resume индексатор уже может работать; статус не утверждает,
  что обе службы обязательно остановлены. Последняя фаза и `wasActive`
  сохраняются. Повторный timer блокируется до ручной reconciliation.
- SIGTERM даёт failed; SIGKILL оставляет последнюю сохранённую фазу.
  Монитор видит незавершённую фазу и неработающий backup unit. При ENOSPC,
  мешающем записать сам failed, действует та же проверка незавершённой фазы.
- `lastSuccess` меняется только после проверки gzip/tar, SHA256/sidecar
  и возврата ранее активных служб. Пропуск занятого lock не обновляет успех.
- Плановая остановка подавляет ожидаемые service/API симптомы максимум 15 минут
  и только пока backup unit реально выполняется. Уже объявленный инцидент
  не получает ложное recovery во время planned stop.

Существующий `qianqi-public-monitor` остаётся единственным Telegram observer.
Расширение проверяет native backup status/возраст последнего успеха (30 часов),
реальные ActiveState исполнителя/индексатора/общего API и public API status.
Прежние проверки operator/indexer и задержка indexer-not-ready сохранены.
Используются прежние credentials и dedup state: новая тревога сразу, напоминание
раз в 6 часов, recovery после исчезновения всех причин. Ошибка доставки оставляет
инцидент неподтверждённым для повторной попытки. `waiting: prizeFunding` не тревога.

## Если backup завершился ошибкой

1. Прочитать sanitized status, `systemctl show` backup/indexer/automation и journal.
   Сохранить status с временной меткой. При `stopRequested=true` не перезапускать
   executor и не удалять native locks/pending intents ради запуска.
2. Устранить причину: место/inodes, права, повреждение runtime/config либо ошибку
   helper. Не заменять рабочие состояния старым backup. Незавершённый архив
   оставить как evidence; это не verified backup.
3. Проверить PID/владельцев locks, native checksum/configHash всех financial files,
   index canonical head, pending intents и latest/pending nonce. При pending,
   расхождении chain/config/обязательств требуется отдельная reconciliation;
   этот пакет **не реализует** безопасное автоматическое восстановление sender.
4. После доказанной согласованности оператор может восстановить только службы
   из `wasActive`: сначала indexer, проверить health/API и актуальность проекции,
   затем единственный executor. Проверить его pass и отсутствие второго writer.
5. Только после этой проверки сохранить копию status в отдельный audit-файл и
   явно отметить текущий статус `phase: acknowledged`, `stopRequested: false`,
   сохранив `lastSuccess` и добавив время/основание ручного решения. Само
   подтверждение не обновляет `lastSuccess`. Запустить штатный backup; проверить
   новый success и recovery уведомление. Не делать такой reset по timer.

## Проверки и границы

- `python3 tests/ops/test_qianqi_backup.py` на Linux под `nobody`: реальные helper,
  cp/tar/checksum и staged restore в TemporaryDirectory; systemctl подменён.
  Проверены helper/cp/tar/checksum/resume failures, нехватка места/inodes,
  повреждение helper, повторный timer, lock skip, SIGTERM/SIGKILL. Production
  state, ключи и настоящие financial send-paths не используются.
- `node --test tests/ops/qianqi-monitor.test.cjs`: planned stop/crash/overdue,
  недоступный API, missing/stale backup, dedup/reminder/recovery/delivery failure.
- Существующий notifier найден на сервере и до изменения успешно работал;
  `OnFailure` у backup отсутствовал. Эта проверка была read-only.

Не закрыто этим узким пакетом: внешний dead-man на потерю VPS, автоматическая
проверка возраста/целостности off-server копии, общий checkpoint native+PG,
полный on-chain recovery preflight, расширенный аудит обхода signer fence.
Доступность пользовательского компьютера не блокирует native backup. Монитор
на VPS не способен сообщить о полной потере самого VPS. Существующий platform
metrics collector остаётся сборщиком JSON; operator alerts идут через QIANQI monitor.

## Откат кода пакета

До установки сохранить прежние ops-файлы и drop-ins в отдельную директорию.
Для отката вернуть их, убрать только новый monitor drop-in, daemon-reload.
Не восстанавливать native state и не сбрасывать failed status при откате кода.
При post-stop failure сначала выполнить reconciliation выше; старый backup
не содержит нового предохранителя, поэтому его timer нельзя включать до решения.

## Развёртывание и результат

10.10.2026 по Москве (09.10, 21:34–21:38 UTC): код `70b68c6`, исправление
HTTP probe `f1097a3` установлены на сервер. Дополнение `c967d00` добавляет этап
отказа и ссылку на runbook прямо в тревогу. Финансовый runtime остался `d0a6840`.
Исходные ops и unit сохранены в
`/var/lib/crypto-launchpad/admin/backup-safety-20261010`.

- 6 Linux-тестов под `nobody` прошли, включая подслучаи пяти post-stop failures,
  реальные SIGTERM/SIGKILL, partial resume и сохранение предыдущего lastSuccess.
  6 Node-тестов мониторинга/доставки прошли. Config preflight на сервере PASS.
- Реальный native backup: `20261009T213451Z.tar.gz`, SHA256
  `cf050689fc8ae66a22c98ee7e2cf8bc1acac45159160bd2263d9f87dce02343c`.
  Unit success/exit 0; durable status success, обе ранее активные службы запущены.
- При первой live-проверке Node fetch не передал Host для loopback API,
  получился 421 и ложная тревога. Probe исправлен на публичный HTTPS hostname.
  После исправления monitor success, recovery доставлен. Этот эпизод не был
  недоступностью публичного сайта. Старый observer также успел сообщить
  об остановке во время первого backup до установки нового drop-in.
- Отдельное явно помеченное тестовое сообщение: Telegram API подтвердил
  `TEST_DELIVERY_CONFIRMED`, systemd transient test unit success/exit 0.
  Затем штатный minute timer: `suppressed; operational checks healthy`.
  Это подтверждение доставки API, не утверждение, что человек прочитал сообщение.
- Platform backup `20261009T213742Z.tar.gz`, SHA256
  `da3edca4ffbb60502f034df77268ae4f0efce32fede911d9f8f171c353d2c363`.
  Все 11 внутренних SHA256 PASS. Включены новые ops, monitor drop-in и durable
  backup status; custody/credentials не добавлялись.
  Архив соответствует ops до дополнения текста тревоги `c967d00`; оно сохранено
  в Git и попадёт в следующий штатный platform backup.
- Platform off-server pull: `VERIFIED`, 21:38:49 UTC, SHA256 совпадает.
- Native off-server pull: `verified`, 21:40:36 UTC, скачан новый архив,
  всего 8 архивов; задача вернулась в Ready. Старые копии сохранены.
- На контрольной проверке API/indexer/executor active; indexer ready,
  lag 0, 12 успешных проходов / 0 ошибок, processedBlock 84470690.

Fault-injection выполнялся только на изолированных временных файлах, с
подменённым systemctl. Production ошибки не инсценировались, реальные
финансовые действия не форсировались. Полный paired restore этим пакетом
не проверялся и остаётся следующим отдельным этапом.
