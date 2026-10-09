# Серверный shadow запущен

09.10.2026. Runtime `55694dc`; хост201.51.22.244, отдельная БД/OS user из
[отчёта установки](SERVER_REHEARSAL_DEPLOYMENT.md). Состояние: **наблюдение идёт**,
суточная репетиция ещё не завершена. QIANQI financial worker не переключался.

## RPC и запуск

Владелец создал отдельный QuickNode и записал URL в игнорируемый
`.local/config/quicknode-rpc-url.txt`. Значение передано только в защищённую
серверную конфигурацию. PONS_LOGS_RPC=QuickNode, архивные чтения остаются на
прежнем PONS_ARCHIVE_RPC. Ключи/production-конфиги QIANQI не использовались.

Проверено с сервера: chainId4663, hash контрольного блока84135771 совпал,
getLogs на10000 блоков работает;90000 блоков дают HTTP413. Поэтому добавлен
PONS_LOGS_MAX_BLOCKS=10000: транспорт читает последовательные включительные
диапазоны без пробелов/пересечений, сохраняет частичные доказательства и полную
логическую выборку для offline replay. При отказе страницы неполный результат
не возвращается. Общие лимиты2000RPC/300s/500events сохранены; скрытой ротации RPC нет.
4 transport +8 live tests PASS;4 transport также PASS на серверном Linux.

Предыдущий неуспешный preflight сохранён отдельно:
`/var/lib/crypto-launchpad/shadow-preflight-20261009T175545Z`.
Новый `/var/lib/crypto-launchpad/shadow` инициализирован **09.10 в17:55:47UTC**.
Deadline **10.10.2026 в17:55:47UTC /20:55:47МСК**. Перезапуски этот срок не меняют.
SHA256 неизменного rehearsal.json:
`ab0fcd3c14d5eeacc4cc5576858352d291b6dcf7a4758528c61f3c535bdec95e`.

## Подтверждённые результаты

| Проверка | Результат |
| --- | --- |
| Начальная догонка |84135771 →84339188, LIVE_SHADOW_MATCH,53кошелька |
| Ресурсы первого цикла |38.068s wall,2.884s CPU,106.2MiB peak |
| Новое состояние после перезапуска |84343143, LIVE_SHADOW_MATCH,53кошелька |
| Повтор прежней точки |UNCHANGED, без повторной записи |
| Actual compact-state restore |LIVE_RESTORE_MATCH в отдельной БД, unscoped lp_jobs read0 |
| Backup активного worker |Остановка → снимок → возобновление PASS, marker/deadline неизменны |
| Изоляция QIANQI |Прежние PID783196/783212 и active, перезапуска нами не было |

В проверенных интервалах BUY/SELL/recognition/lifecycle delta=0. Это проверка
догонки, сверки и эксплуатации; обработку новых финансовых событий за сутки
можно будет утверждать только при их появлении.

Первый live digest:
`0x1d5c99e867cddd9f44f650c57a504625f92dec23dd54385700232f6ae53b633e`.
Новый digest на84343143:
`0x5832bb2ac68c330d07e0187e3d6168fc460da5664038362fb0793b9695ab6a30`.

На старте встречались NOT_ADVANCED. Диагностика с полным sandbox сервиса
17:59:39UTC установила `Mixed live API generation`: QIANQI обновил поколение
данных во время сверки. Курсор сохранился; проверка generation/finality не
ослаблялась. Следующая успешная попытка подтвердила84343143. Причину каждой
ранней ошибки отдельно не установили; обобщать этот диагноз на все ошибки нельзя.
NOT_ADVANCED в будущем требует оценки длительности/причины, а не автоматического PASS.

Контрольные ручные restart в коротком интервале исчерпали StartLimitBurst3/300s:
backup18:01:24UTC создал валидный архив, но его resume получил start-limit-hit.
Оператор сбросил счётчик только crypto-launchpad-shadow, затем повторил active
backup/resume: Result=success, shadow active. Защита частых запусков не ослаблялась.
Этот короткий эксплуатационный перерыв относится к тестам, не скрыт из метрик.

## Эксплуатация на время репетиции

- `crypto-launchpad-shadow.service` enabled/active, runtime user launchpad-shadow,
  read-only release, отдельные writable paths, без signer. MemoryMax1GiB/CPUQuota50%
  относятся к Node slice; PostgreSQL имеет отдельное потребление.
- `crypto-launchpad-monitor.timer` enabled: метрики раз в5min до deadline.
  Записывает состояние новых сервисов и QIANQI, доступность API, RAM/load,
  размер DB/WAL/state и свободное место. Файлы `/var/lib/crypto-launchpad/metrics`.
- `crypto-launchpad-backup.timer` enabled: каждые6h консистентный dump+evidence.
  Backup кратко останавливает только новый shadow и возобновляет с прежним marker.
  После deadline делает последний снимок и отключает свой timer.
- Windows `CryptoLaunchpad-Shadow-Backup`: скрытый почасовой pull с проверкой
  SHA256, двухдневное окно обновлено от запуска. Работает при доступном компьютере
  и interactive session владельца. Backup20261009T175711Z уже скачан/проверен,
  LastTaskResult0; он содержит первый успешный compact head.

После проверки backup/resume скачан и подтверждён также `20261009T180252Z.tar.gz`
(18:04:15UTC), SHA256
`9c49113925c823ce683eb36d4dd1f932fe69b40e883f2ecbbdf1ba7a18a291aa`.

Точка84339188 восстановлена в `launchpad_shadow_restore_live_20261009` и проверена
под lp_jobs: exact head/digest, checksum тела и запрет unscoped read совпали.
Это отдельная БД на том же хосте. Полное восстановление после потери сервера
и устойчивость за24h ещё не доказаны. Пределы storage guard/WAL/общих DB roles
из [подготовки](SHADOW_SERVER_REHEARSAL.md) остаются в силе.

На deadline ожидается exit78 (намеренная остановка) без автоматического restart.
Monitor оставляет WINDOW_ENDED_REVIEW_REQUIRED, после чего отключается.
Это не итоговый PASS. Следующий пакет: прочитать метрики/журнал нового сервиса,
проверить lag, долю отказов, рост диска/WAL и последний off-server backup;
отдельно указать, какие новые события реально наблюдались.

Материалы: `.local/notes/quicknode-rehearsal-2026-10-09.md`,
`.local/deployment-2026-10-09/` и off-server archives в
`C:/Users/Valentine/.crypto-launchpad-backups`.
