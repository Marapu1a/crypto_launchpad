# Подготовка сервиса v2

Эти файлы — выключенный пакет для установки, не выполненный deployment.
`runtime.example.json` содержит пустой реестр и `allowPublicTransactions:false`.
Одна служба поддерживает до8 отдельных v2-проектов; ключи и журналы у каждого свои.
QIANQI остаётся на своём адаптере и существующем release.

## Пути

- Код: `/opt/crypto-launchpad/draw-current` → отдельный проверенный release.
- Encrypted keys и health: `/var/lib/crypto-launchpad/draw`.
- RPC, DB URL, key passwords, Telegram credentials: `/etc/crypto-launchpad/draw-secrets`.
- Конфигурация: `/etc/crypto-launchpad/draw-runtime.json`, проекты выключены.
- OS user: `launchpad-draw`, DB role: `lp_executor` без superuser/bypassrls.
- Owner UI при размещении рядом с PostgreSQL слушает только127.0.0.1:4190;
  с компьютера доступен через SSH-forward, без публикации административного UI.

`prepare-owner-production.mjs` создаёт отдельный закрытый каталог с новым
профилем и новыми ключами. При размещении переносить encrypted role directories
в каталог state, пароли — только в secrets, затем обновить абсолютные ссылки
`keyFile/passwordFile`. Не помещать весь подготовительный каталог в state:
`backup.sh` архивирует state, а пароли должны иметь отдельную защищённую копию.
Для Linux каталог подготовки задаётся вторым аргументом, например новый каталог
под `/etc/crypto-launchpad/draw-secrets/preparation/`; нельзя указывать существующий.
QIANQI keys/configs не используются как источник.

## Перед установкой

Снять существующий согласованный backup общей БД. Проверить restore отдельно,
checksum миграций и применение недостающих011–015 на копии. Не заменять боевую
БД восстановленной копией. Изменения015 расширяют тип модуля,011–014 добавляют
новые журналы/кошельки/owner launch/публичные снимки; действующий QIANQI не переносится.
Точный набор отсутствующих миграций получить из `launchpad.schema_migrations`.

Owner server проверяет наличие015 и не запускает форму на старой схеме.
Для реального owner UI используйте отдельного OS user и роль `lp_owner_ui` из
[owner-access.sql](owner-access.sql), оставляя `lp_owner` NOLOGIN. Эта роль
проверяет конфликты проектов/публичных адресов и вставляет projects/modules с RLS;
API и executor сохраняют свои роли. Применять SQL один раз после backup,
проверять доступ на восстановленной копии. Текущая установка IGW описана в
[IGW_OWNER_REVIEW_20261012](../../docs/archive/reports/IGW_OWNER_REVIEW_20261012.md).
`databaseFiles` должны ссылаться на реальные защищённые файлы подключения.
PG наружу не открывать: локальный owner UI можно прокинуть через SSH, оставив
owner server на VPS с доступом к его Unix socket/локальным credentials.

Проверить права пользователя, наличие release и writable paths, затем установить
unit-файлы без enable/start до готовности конкретного профиля. Экспорт owner handoff
всегда выключен и не регистрирует публичный hostname. Поддомен отдельно внести
в project_domains, подготовить DNS/TLS и направить публичный site/API на этот проект.

`crypto-launchpad-draw-notify.service` использует тот же реестр и отдельное
состояние доставки. Он сообщает о газе; остановку всего VPS должен замечать
существующий внешний наблюдатель на компьютере владельца. Боевые уведомления
подключаются отдельно; тестовое сообщение согласуется при проверке канала.

## Backup и возврат

Для периодических копий установлены `crypto-launchpad-draw-backup.service` и
`crypto-launchpad-draw-backup.timer` (каждые шесть часов). Скрипт устанавливается
с LF в `/usr/local/lib/crypto-launchpad-draw-backup.sh`, root:root, mode0700.
Текущее состояние IGW и границы проверки: [IGW_AUTONOMY_20261012](../../docs/archive/reports/IGW_AUTONOMY_20261012.md).

`backup.sh` останавливает только новый draw worker, делает `pg_dump` общей БД,
архивирует encrypted keys/state и конфигурацию, сохраняет checksum/release,
затем возвращает службу, только если она работала. Существующие QIANQI backup
и службы не останавливает. Перед запуском убедиться, что owner deployment завершён
или его backend остановлен: signer и owner journal должны быть восстановимы вместе.

Восстанавливать сначала в новую БД с отправками выключенными. Сверить policy,
owner history, sender journal, роль/RLS, актуальные nonce и on-chain bindings.
Старая копия не разрешает откатить журнал поверх более новых отправок.
Откат кода — вернуть предыдущий отдельный draw release; не откатывать общую БД
и не переиспользовать служебные адреса другого токена.
