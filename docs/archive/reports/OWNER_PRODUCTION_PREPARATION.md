> Исторический отчёт: результаты и ограничения относятся к дате проверки в тексте. Текущее состояние — в [CURRENT_CONTEXT](../../CURRENT_CONTEXT.md).

# Production-профиль первого запуска

11.10.2026. Пакет подготовлен поверх `878cdd6`. Публичных отправок нет;
VPS проверялся только чтением, QIANQI и его release не менялись.

## Готово

Отдельный production admission проверяет сеть4663, finalized anchor, время,
пять runtime hashes Pons и адрес владельца. Подпись остаётся в расширении;
fixture signer недоступен. По умолчанию `allowPublicTransactions:false`:
сервер отклоняет arm/retry, интерфейс блокирует подпись. Черновики production
и rehearsal разделены. Перед подписью кошелёк повторно проверяет сеть и pins.

Исправлена проверка повторного просмотра: снижение оценки газа больше не
инвалидирует шаг. Отправляется ровно рассмотренный запрос; рост расходов,
изменение calldata, value или nonce требуют нового просмотра.

Для владельца `0x098afA6731239a00CE0aff669aaefD16b7C72114` подготовлен
закрытый локальный каталог `.local/production-preparation/2026-10-11T02-17-48-208Z/`.
Profile digest: `a487696477a7a35dcf6b328870509c197b9b6a5131dc53f135adff40cb9d047e`.
Два новых зашифрованных ключа проверены расшифровкой и сверкой адресов:

- executor: `0x6A20332b8936D172aBcD783a2D4d0C243864dAfc`;
- publisher: `0x8248015BdAbe5699B33C8385b0FcC13c59968BFf`.

Каталог закрыт Windows ACL, в Git не входит. Ключи не пополнялись.
Предварительные, ещё не утверждённые расходы: общий потолок0.05ETH,
executor0.01ETH, publisher0.001ETH. Это лимиты/пополнения, не оценка цены запуска.
Название, team/operations и публичный домен ещё не заданы. Экономика в конфиге —
черновой пресет, подлежит просмотру владельцем перед запуском.

## Живая проверка

Report в указанном каталоге: `PREPARED_DISABLED`, `canLaunch:true` для владельца.
Pons block85481685, hash `0x1f889dfcc1827d8e1e27a2f5e799ef158c0277ea81c16f4a60e01214ccf37843`:
launch fee0.0005ETH, base fee1%, creator cap10%, USDG6decimals,
graduation8090USDG. Все пять pins совпали. Finalized85470225;
отставание около19минут. Это снимок, перед запуском условия проверяются заново.

## Проверки и пределы

14 отдельных unit checks PASS; production fork проходит9 deployment steps,
восстановление journal после рестарта и pg_dump/restore в отдельную БД
без нового nonce, unscoped rows0. Production browser boundary PASS:
выключенная кнопка, отдельный draft, отказ кошелька без arm/attach.
Соседние4 owner fork и5 owner stand сценариев PASS; build PASS,
синтаксис backup.sh проверен bash -n.

Локальные отчёты в `.local/test-results/`:

- `draw-owner-production-2026-10-11T02-15-27-298Z/report.json`;
- `owner-production-ui-2026-10-11T02-14-28-780Z/report.json`;
- `draw-owner-2026-10-11T02-15-27-551Z/report.json`;
- `draw-owner-stand-2026-10-11T02-15-27-870Z/report.json`.

Первый неудачный production fork из02:08 сохранён: выявил изменение gas estimate
между просмотрами; исправление проверено последующим прогоном. Fork исторический,
clientVersion/finality моделируются явно. Настоящее расширение владельца и
публичный deployment ещё не проверялись; browser test использует mock кошелька.

## Следующий пакет

На VPS отсутствуют owner_launches, production_senders, production_wallets,
short_public_views; lp_executor/lp_api без superuser/bypassrls. Источник —
`.local/notes/owner-production-server-readonly-2026-10-11.json`.

Нужны backup общей БД, restore и миграции на копии, затем недостающие миграции
на VPS; отдельный v2 release и выключенные службы, DB credentials, уведомления,
публичный домен. Подготовлены [шаблоны установки](../../../ops/draw-runtime/README.md),
но они ещё не установлены. Owner server требует schema15 и слушает loopback;
доступ с компьютера возможен через SSH-forward без открытия PostgreSQL наружу.

Команды оператора: `npm run owner:production:prepare -- REQUEST.json` создаёт
новый закрытый каталог (не повторять для уже созданного профиля);
`npm run owner:production -- CONFIG.json` поднимает owner UI после подключения
БД. Текущий disabled config ещё содержит ссылки на отсутствующие DB credentials
и localhost-домен, поэтому не является готовым серверным deployment.

После подготовки инфраструктуры — просмотр точных настроек и отдельная отмашка
владельца на реальные подписи. Этот пакет её не заменяет.
