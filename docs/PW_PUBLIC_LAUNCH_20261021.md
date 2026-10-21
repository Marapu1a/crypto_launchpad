# PW: сайт, хаб и бот после выпуска

21.10.2026. Владелец разрешил обновить все три поверхности после подписания
девяти транзакций PW. Контракт:
`0xe0c6b2040624dde42c3ce55cfbf818d8b79035b7`.

На бесплатном мониторе перед footer добавлен отдельный блок PW: поддержка
проекта, Pons, Telegram, адрес и распределение полученных creator fees
60% холдерам / 20% месячному розыгрышу / 20% развитию. Эти доли не относятся
к полной сумме покупки; creator fee 3%. Текст RU/EN/中文.

В хабе новая карточка Pattern Watcher с существующей эмблемой, сайтом,
реальным контрактом, Pons и Telegram. Для монитора не создаётся старый
USDG draw iframe. В общем каталоге PW переведён из prelaunch в launched;
botOnly снят. Бот использует этот же каталог и три перевода.

Статус обслуживания: подключается. Публичный выпуск не объявляет завершённым
финализированный handoff, funding или запуск финансовых служб. Финансовый
runtime не входит в этот пакет.

В пакет включены ранее согласованные локальные изменения сайта и языка бота:
тихое автообновление, выделение выбранного показателя, возраст токенов от
текущего времени, исправление тестового push и меню RU/EN/中文. Языковая
схема уведомлений применяется отдельно в monitor_web с резервной копией;
существующие подписки, очередь, offset и секреты не заменяются.

Проверки: 12 unit bot/bridge PASS; monitor-free PASS (БД, язык, дедупликация,
доставка и отмена); pons-monitor browser PASS (1440/390/320px); локальный
просмотр PW и хаба RU/EN/中文, реальные ссылки, desktop/mobile без overflow
и JS ошибок. Screenshots `.local/pw-launch-20261021/site-token-mobile.png`,
`hub-pw-desktop.png` просмотрены. Превью: monitor :4237, hub :4240, bot :4198.

Новых отправок Telegram/Push для проверки не делали.

## Опубликовано

21.10.2026, 23:38 МСК. Код `5dc32d1` отправлен в origin/main.
Monitor/gateway/bot release:
`/opt/pons-monitor/releases/public-pw-5dc32d1-20261021`.
Hub: `/var/www/qianqi-hub/releases/public-pw-5dc32d1-20261021`.
Указатели current переключены атомарно; прежние release сохранены.
Полный manifest: 54 файла, SHA-256
`06298b5c74713534cab8ce690440e4e2919f81661c715f1e33151a076a6fb32d`.

Backup и план: `/root/pw-public-5dc32d1-20261021`.
БД monitor_web сохранена до изменения языка; dump SHA-256
`3081e92e3c3f9e384c9f96201a5c9c164de3e3c3cf9e1b1338cd8af01409226f`.
После остановки единственного poller сохранён его state; offset после запуска
не уменьшился. Выполнена штатная резервная копия данных монитора. Миграция
только добавляет языковые таблицы/поле, старые подписки и очередь сохраняются.

Все четыре проверенные службы — monitor, gateway, bot и Pons runtime — active,
NRestarts=0. Bot log: `Project bot ready: @qianqi_hub_bot`.
HTTPS monitor/hub — 200. Реальный Chromium: главная, wallets и hub PASS,
390px без overflow/JS ошибок, Pons/Telegram/контракт присутствуют;
monitor windowEnd=1792614900, stale=false на момент проверки.
Push/Telegram endpoints включены; тестовых сообщений не отправляли.

Откат: остановить monitor/gateway/bot, вернуть оба previous symlink из plan.json
и запустить службы. Текущие БД, очередь и bot state не откатывать.
Финансовый runtime PW не активирован этим выкатом; требуется завершить
finality/handoff/funding отдельно. Перед закрытием owner console вернуть
RPC reserve=1000, см. PW_BROWSER_LAUNCH_20261021.md.
