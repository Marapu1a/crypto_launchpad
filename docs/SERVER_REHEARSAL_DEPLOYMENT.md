# Серверная репетиция: установленное окружение и RPC-блокер

09.10.2026, SSH host201.51.22.244. Владелец разрешил серверный пакет сообщением
«действуй». Установка, отдельная БД/backup и будущий read-only watch входят в это
разрешение; повторного согласования этих действий после получения RPC не требуется.
Финансовый перенос QIANQI, публичные сайты и платные подписки сюда не входят.

**Состояние: окружение установлено, bootstrap/restore проверены; суточное live
наблюдение НЕ запущено.** Причина — недоступный источник `eth_getLogs` с сервера.

## Что сделано

- Из штатного Ubuntu repo установлен PostgreSQL18.6, 7 новых пакетов,
  без обновления существующих пакетов и без перезапуска QIANQI.
  Cluster18/main слушает только Unix socket (`listen_addresses=''`), внешнего5432 нет.
  max_connections20, shared_buffers128MB, work_mem4MB, max_wal_size256MB.
  Последний параметр не является жёсткой квотой WAL.
- Отдельный OS user `launchpad-shadow`, БД `launchpad_shadow`, роли lp_owner,
  lp_jobs, lp_api, lp_ingest, lp_executor. Только lp_jobs имеет LOGIN, остальные
  runtime-роли пока NOLOGIN. Peer map разрешает launchpad-shadow → lp_jobs.
  Попытка OS user qianqi войти этой ролью отвергнута. Credentials БД не копировались.
- Migrations001–009 применены. Проверенная история импортирована на84135771,
  68 покупок /52 wallet rows. Digest:
  `0x391dda65146c20a67505ea10c09d0c1defeb6ef91fedc25ef070ab0c8816eb9a`.
  Импорт63s, CPU31.65s, MemoryPeak190.3MiB под CPUQuota50%.
- Создан собственный backup, проверены SHA256 внешнего архива и его компонентов.
  Dump восстановлен в `launchpad_shadow_restore_20261009`; evidence извлечено в
  `/var/lib/crypto-launchpad/restore-check`, заново выполнен offline verifier.
  Payload и digest original/restore/evidence совпали; unscoped lp_jobs read возвращает0.
  Это восстановление в отдельную БД на том же сервере, не полная потеря хоста.
- Копия backup скачана в `C:/Users/Valentine/.crypto-launchpad-backups`, checksum
  проверен. Windows task `CryptoLaunchpad-Shadow-Backup` запускает скрытый pull
  ежечасно в течение двух дней, LastTaskResult0. SSH использует `-n` и существующий
  ключ; ключ никуда не копировался. Task требует включённого компьютера/interactive
  session владельца; это не независимое облачное хранилище.
- Подготовлены backup service/timer (раз в6h), monitor service/timer (раз в5min),
  bounded shadow service. Все три постоянных unit/timer **disabled**, watch не работает.
  Backup и monitor однократно выполнены успешно. После deadline monitor сохраняет
  WINDOW_ENDED_REVIEW_REQUIRED и отключает свой timer; backup после финального
  снимка отключает свой timer. Итоговый PASS устанавливает разбор результатов.

Релизы: первоначальный runtime `cda74f6`, текущий `/opt/crypto-launchpad/current`
→ `/opt/crypto-launchpad/releases/595cd94`. Исправление задаёт PONS_LOGS_RPC отдельно
от PONS_ARCHIVE_RPC и проверяет chainId4663 источника событий до первого getLogs.
Без явного значения остаётся прежний публичный endpoint; автоматической ротации нет.
Новые3 transport tests +8 соседних live PASS;3 transport и4 storage также проверены
на Linux. Ops изменения: ab2cfb5,73b7ed8,eb21f9e; актуальные ops взяты из595cd94.

В первом Linux backup выявлен CRLF при git archive с Windows autocrlf.
Фиксация LF для sh/service/timer/slice внесена в `.gitattributes` (73b7ed8),
backup повторён успешно. Первые неуспешные попытки не означают успешную репетицию.
systemd-analyze проверяет реальные Node/units на сервере; сообщения CPUAccounting
относятся к штатным xfs_scrub units, которые не менялись.

## Где остановились

Первый live-процесс и диагностический повтор дали NOT_ADVANCED; БД осталась
на84135771. Публичный `rpc.mainnet.chain.robinhood.com` возвращает HTTP403,
body `error code: 1010`, даже на eth_chainId. Triport также вернул403;
PublicNode дал HTTPError (код отдельно не сохранён). Защита не обходилась,
прокси/подмена клиента не использовались.
Текущий архивный Alchemy отвечает на обычные чтения, но getLogs широкого диапазона
возвращает HTTP400 и ограничение Free tier:10 блоков. Дробление всей догоняемой
истории на десятки тысяч запросов не включалось.

Источники endpoint discovery:
[официальные RPC Robinhood](https://docs.robinhood.com/chain/connecting/),
[PublicNode](https://robinhood.publicnode.com/),
[Triport](https://triport.io/docs/robinhood/public).
Фактическая доступность выше установлена запросами с нашего хоста, не обещаниями сайтов.

Владелец получил один запрос: положить рабочий оплаченный RPC для событий в
`.local/config/pons-logs-rpc.txt`. Значение не публиковать и не печатать.
Production-конфиг QIANQI не читали и не копировали: действует
[AGENTS.md](../AGENTS.md), «Не копировать ключи, кошельки, production-конфиги,
журналы и release manifests».

## Продолжение после RPC

1. Проверить chainId, известный block hash и getLogs нужного диапазона с сервера.
   URL перенести только в защищённый `/etc/crypto-launchpad/shadow.env` как
   PONS_LOGS_RPC. Архивный endpoint можно сохранить отдельно.
2. Сохранить текущий каталог неуспешного preflight как отдельный снимок; начать
   новую явно обозначенную репетицию в пустом state directory, сохранив старый.
   Не редактировать deadline в существующем rehearsal.json. Обновить согласованно
   env/ReadWritePaths/backup/monitor пути, если выбран другой основной путь;
   проще архивировать только нынешний preflight и оставить штатный `/shadow` новым.
3. Успешный одиночный цикл с disk guard, затем start/enable shadow и backup/monitor
   timers. Проверить несколько advanced heads, отсутствие расхождений и сохранение
   курсора при штатном restart. Обновить двухдневное окно Windows pull от реального
   начала наблюдения, чтобы оно охватывало последний backup.
4. 24 часа от новой инициализации: CPU/RAM/DB/WAL/disk, API QIANQI, head lag и
   новые события. При отсутствии новых BUY/recognition/draw соответствующие
   проверки остаются незакрытыми. Все метрики читать вместе с возможными плановыми
   backup/restart самого QIANQI — они не равны вмешательству платформы.

Backup кратко останавливает **только crypto-launchpad-shadow**, затем возобновляет
его с прежним deadline. В архив входят dump и evidence; конфиги/RPC/ключи исключены.
Backups автоматически не удаляются; предел размера каталога3GiB и free floor10GiB
проверяются перед началом. Это прикладной guard, не quota; учитывать размер очередного
архива и распакованной копии при оценке места. Existing QIANQI backup не изменён.

Откат текущего этапа: новые shadow/timers уже выключены; при дальнейших проблемах
останавливать только новые units. Сохранять БД/evidence для разбора. PostgreSQL
не удалять автоматически, QIANQI/nginx/firewall/SSH keys не менять.

Локальные артефакты: `.local/deployment-2026-10-09/` (SQL, identity, script copies,
release/bootstrap archives, metadata snapshots), исследование
`.local/notes/server-rehearsal-2026-10-09.md`. Секретный RPC хранится отдельно
в `.local/config` и `/etc/crypto-launchpad`, не в этих артефактах/репозитории.
