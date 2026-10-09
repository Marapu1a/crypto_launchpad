# Единственный финансовый исполнитель QIANQI

Проверка 10.10.2026 (server UTC 09.10, 22:26–22:31), база runtime `d0a6840`.
Источники: live systemctl/show/list-timers, custody stat/namei/access check,
код executor/fence/native send paths; тесты ниже. Секреты не копировались.

## Инвентаризация

- Единственный активный sender: `qianqi-public-automation.service`, OS `qianqi`,
  `scripts/run-qianqi-executor.mjs --watch`. PostgreSQL lease привязан к chain/sender,
  не к statePath; native журналы `/var/lib/qianqi-public/automation.json{,.scheduler,.rng}`.
- `qianqi-checkpoint-recovery.service` и `qianqi-funding-first.service` — старые
  transient failed units, MainPID=0, Restart=no, TriggeredBy пустой. Это старые
  прямые launchers без PG fence. Их нельзя использовать для штатного restart.
- `qianqi-api`, `qianqi-stage-api`, `qianqi-stage-site`, public indexer и shared API
  имеют read-only/API/site entrypoints. Shadow и sandbox-check disabled.
- В просмотренных cron каталогах и /etc/crontab не обнаружены финансовые launchers.
  Активные QIANQI/platform timers — backup и monitor. Backup штатно возобновляет
  тот же automation unit, отдельный sender не создаёт.
- Custody: root:root directory 0700, файлы 0600; пользователь qianqi не может
  прочитать оригинальный keystore. systemd выдаёт credentials только сервису.
  Unit: ProtectSystem=strict, NoNewPrivileges=yes, KillMode=control-group.

## Изменение кода

Wrapper включает необратимое для процесса требование fence. Потерянный async
контекст теперь блокирует отправку. Прямой public CLI требует fence до чтения
custody. Public network send также требует fence; journal проверяет lease до
подписи и после сохранения signed intent перед broadcast. Локальные/fork modes
не требуют production lease; их прежние network guards сохранены.

Это защита штатного runtime, не аппаратная custody: root или обладатель ключа
может запустить другой код, включая архивный release. PG advisory lock сам по
себе не блокирует такого writer и не доказывает exactly-once. Между последней
проверкой lease и RPC broadcast нет общей атомарной транзакции; durable intent,
native process lock и reconciliation остаются обязательными.

## Проверки

- 7 unit tests adapter/fence: отсутствие контекста; прямой public CLI;
  lease loss до подписи (0 side effects) и после подписи (журнал сохранён,
  0 broadcast); scope через async callback; существующие adoption/API проверки.
- 16 сценариев отдельного PostgreSQL: два дочерних процесса с одним sender/nonce
  и разными payload — второй отклонён до подписи; чистый successor допускается
  после выхода первого. Kill PG session закрывает fence; restart, RLS и restore.
  Отчёт `.local/test-results/shared-2026-10-09T22-28-29-945Z/report.json`.
- 62 native tests прошли; после изменения public CLI адресно повторены 11
  public-execution tests из runtime cwd. Первый ручной запуск из корня дал
  MODULE_NOT_FOUND в cwd-dependent fixture, повтор из правильного cwd прошёл.
- Provenance: 184 файла, 10 явных adaptations. Ни production ключи, ни реальные
  RPC отправки в конкурентных тестах не использовались.

## Rollback / аварийный запуск

1. Остановить automation unit; убедиться MainPID=0 и нет другого sender.
   Не снимать lock с живого процесса. Не запускать старый transient launcher.
2. Сохранить текущие финансовые журналы и binding; проверить checksums,
   unresolved intent, latest/pending nonce и canonical receipts.
   При восстановлении backup использовать [paired recovery](QIANQI_PAIRED_RECOVERY.md).
3. При pending/unsigned intent, nonce mismatch или неоднозначности — STOP,
   reconciliation; никакого автоматического запуска архивной версии.
4. Менять только код/проверенный release manifest unit; не копировать старое
   state. Предпочитать прошлый platform wrapper с PG lease. Прямой legacy runtime
   требует отдельного ручного допуска и остановки всех platform senders.
5. Стартовать один automation unit, проверить первый завершённый pass, lease,
   nonce и отсутствие рестартов. Исторические release и custody сохранять.

## Production результат

Код `90328c4` опубликован до переключения. В 22:32:24 UTC 09.10 (10.10 МСК)
переключён только automation unit на отдельный release
`/opt/crypto-launchpad/releases/d0a6840-writer-90328c4`.
Это база d0a6840 + ровно 6 изменённых файлов из 90328c4; зависимости,
97 compiled contracts, API и indexer не обновлялись. Manifest проверяет 311 файлов:
`9c0ff7c4c3872c45d0e4aa8764c38f67fa9d5659363bdd133a89403f1ac17a46`.
`qianqi-current` по-прежнему указывает на d0a6840 для read-side.

Переключение под общим backup flock: stop одного unit → MainPID=0 → adoption,
latest/pending 85/85, pendingStates=0 → сохранение текущих журналов → новый unit.
Первый pass waiting, steps=0, failures=[], причина включает prizeFunding.
Nonce до/после 85; NRestarts=0; в PG один advisory lock и одна lp_executor session.

Контроль 22:33:18 UTC: все три unit active, публичный API HTTP 200/observed,
pendingStates=0, nonce 85/85. Scheduler/RNG byte-identical; основной state изменил
только cursor/checksum при штатном проходе, jobs/финансовые поля сохранены.
Никаких тестовых покупок/выплат не делали; это не доказательство нового payout.

Оба старых transient launcher сохранены в admin evidence и masked. После mask
systemd ещё держал failed transient definitions; адресный reset-failed и
daemon-reload завершили выгрузку. Итог LoadState=masked, inactive, MainPID=0;
старые release и журналы systemd не удалялись.

Приватные операторские evidence/preflight/state copies/drop-in before:
`/var/lib/crypto-launchpad/admin/single-writer-90328c4` (0700).
Санитизированные result/verification и scripts локально:
`.local/single-writer-2026-10-10/`. При rollback ориентироваться на абсолютный
WorkingDirectory automation, а не общий symlink read-side.

Открыты отдельно: внешний watchdog, контроль свежести off-server копий,
read-only проверка следующего естественного финансового события.
