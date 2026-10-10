# Проверка с компьютера и свежесть off-server копий

10.10.2026. Владелец выбрал проверку с этого компьютера. Отдельный постоянно
включённый сервер/uptime provider не подключён. Код первоначального пакета d7cf1c5.

## Что установлено

Windows task `CryptoLaunchpad-Local-Watchdog`: раз в 5 минут и при входе Valentine,
Interactive/Limited, StartWhenAvailable, IgnoreNew, лимит 3 минуты. Запускается
через wscript без консоли. Финансовые worker/RPC/ключи не используются.
Существующие QIANQI-Offserver-Backup и CryptoLaunchpad-Shadow-Backup сохранены.

Исходники: `ops/watchdog/`; конфигурация, launcher, status и dedup state:
`C:\Users\Valentine\.crypto-launchpad-watchdog\`.
Установка: `powershell.exe -NoProfile -File ops/watchdog/install-windows.ps1`.
Повторная установка поверх существующей конфигурации запрещена; сначала осмотр.

Проверки:

- Публичный HTTPS API `qianqi.site/v1/overview?limit=1`: успешный HTTP и известный
  JSON status. `stale` означает доступность API, а не актуальность финансового
  состояния; freshness API уже проверяет серверный monitor.
- Последний готовый локальный архив QIANQI — не старше 30 часов; platform —
  9 часов (расписание 6 часов + запас на скачивание).
- Последний успешный pull — не старше 3 часов. Свежий last-pull не освежает
  дату архива. После долгого сна до завершения синхронизации возможна тревога.
- SHA256 всего последнего архива, соответствие имени в checksum, непустой файл,
  отсутствие изменения во время чтения. Проверяются обе существующие схемы имён
  checksum и Windows BOM в JSON. Повреждённая последняя копия не подменяется старой.

Это проверка возраста/целостности архива, не повторное восстановление БД каждые
5 минут. Парное восстановление описано в [paired recovery](QIANQI_PAIRED_RECOVERY.md).

## Уведомления и действия

Тревога Windows после двух неуспешных проверок подряд (обычно 5–10 минут),
новая причина уведомляется отдельно, напоминание через 6 часов. После устранения
всех причин — recovery. Ошибка уведомления не отмечается как успешная доставка.
Серверный Telegram observer остаётся на месте; его токен сюда не копировался.

При тревоге открыть status.json и проверить:

1. API недоступен: также проверить интернет/DNS компьютера; это не доказательство
   полного отказа VPS. Затем штатный SSH/systemd осмотр.
2. Pull устарел/failed: результат двух backup tasks и SSH доступ. Не удалять старые
   копии/partial-файлы; исходный QIANQI checkout не редактировать.
3. Архив старый: убедиться, что новый backup создан на сервере и скачан.
4. SHA256 не совпадает: сохранить повреждённую копию для расследования;
   не восстанавливать её поверх live и не переписывать checksum для «исправления».

Ограничения: Windows выключена/спит или пользователь вышел — проверки нет.
При потере интернета нет и проверки API. Windows может скрывать toast режимом
«Не беспокоить»; успешный вызов API не подтверждает прочтение человеком.
Независимый круглосуточный dead-man и Telegram извне VPS остаются открытыми.
Сбой самого локального watchdog виден в LastTaskResult; второго наблюдателя за ним нет.

## Проверки и evidence

- 5 backup tests: две схемы файлов, свежий pull со старым архивом, повреждение,
  отсутствие файлов, future timestamp, invalid date и чужое имя checksum.
- 4 monitor tests: HTTP failures/invalid payload, задержка первой тревоги,
  reminders/recovery, повтор после ошибки уведомления, понятный текст.
- Реальный Windows toast API принял явно помеченный тест. Task Scheduler запуск
  завершился LastTaskResult=0; PT5M, IgnoreNew, PT3M проверены.
- Первые реальные проверки: API доступен; SHA256 native
  `20261009T213451Z.tar.gz` и platform `20261009T213742Z.tar.gz` подтверждены.
  Последние sanitized snapshots сохраняются в `.local/watchdog-2026-10-10/`.

## Исправление состава platform backup

При проверке обнаружено: `qianqi-current` остаётся на read-side d0a6840, а
automation после предыдущего пакета использует d0a6840-writer-90328c4. Backup
сохранял только runtime общего symlink. В d7cf1c5 добавлены
`qianqi-executor-release.txt` и `qianqi-executor-runtime.tar.gz`, полученные из
реального WorkingDirectory automation unit и включённые в SHA256SUMS.
Прежний read-side архив сохранён; custody/node_modules не добавлялись.

Изменение ops опубликовано перед установкой; предыдущее backup.sh сохранено в
`/var/lib/crypto-launchpad/admin/offserver-d7cf1c5/backup.sh.before`.
Shell syntax PASS. Реальный backup `20261010T020700Z.tar.gz`: unit success/exit 0,
наружный SHA256 и все 13 внутренних checksum PASS. Из архива извлечён executor
runtime и проверены 311 файлов по закреплённому manifest SHA
`9c0ff7c4c3872c45d0e4aa8764c38f67fa9d5659363bdd133a89403f1ac17a46`.
Executor/indexer/API остались active, финансовые службы не перезапускались.

Штатная Windows задача скачала этот архив 02:08:09 UTC, LastTaskResult=0.
Повторный local watchdog healthy, новый platform archive verified; SHA256:
`16240bc8b4fe42a5860bb2baeb4c2387982f1c0dc74fba0d2208fb48524578c7`.
Снимки проверки — `verified-after-new-backup.json` и `platform-pull-result.json`
в локальной evidence-директории выше. Внешняя недоступность production не
инсценировалась: сетевые отказы/dedup проверены тестами, Windows доставка —
отдельным явно помеченным test toast.

## Отключение

`Disable-ScheduledTask -TaskName CryptoLaunchpad-Local-Watchdog`.
Не удалять backup tasks, архивы, SSH ключ или историю watchdog. Для возвращения
использовать Enable-ScheduledTask. Новый Windows watchdog не останавливает
никакие службы и не запускает recovery/финансовые действия автоматически.
