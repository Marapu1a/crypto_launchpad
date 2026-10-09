# QIANQI: read-only inventory и границы совместимости

09.10.2026. Первый пакет подготовки существующего проекта к общему бэку.
Это сверка публичного состояния, **не полный ticket shadow и не разрешение переключения worker**.

## Воспроизведение

`node scripts/qianqi-inventory.mjs`

Используется RPC нового проекта через `scripts/rpc-config.cjs`. URL не выводится.
Каждый запуск сохраняет новый каталог `.local/test-results/qianqi-inventory-<UTC>/`:
публичный API snapshot и report. Ошибка проверки завершает команду с ненулевым кодом.
Нет signer, импорта production-конфигурации, journals или release manifests.
RPC ограничен chainId, block, code и call. Все контрактные чтения закреплены
на блоке API; finalized проверяется отдельно, блок перечитывается в конце.
Runtime hashes обнаруженных контрактов — наблюдения, не доверенные deployment pins.

## Подтверждённый снимок

Проверка 2026-10-09T11:44:38.981Z—11:44:43.935Z, RPC из локальной настройки.
API: https://qianqi.site/v1/overview?limit=1.
Block/finalized **84120819**, hash
`0x544d397bde4c6975fb785d51952ef348a75b5a57d1c40ac848c75d6282e3b5ae`.
Артефакт: `.local/test-results/qianqi-inventory-2026-10-09T11-44-38-981Z/report.json`.

| Роль | Адрес |
|---|---|
| Token | `0x6ea39a23aa46e51ca6cd2d1cbc0b5bfb29ecb216` |
| Short | `0xa631f7845af257daee0b9f6ff744334294ce6846` |
| Monthly | `0x3ee0c608815ec5a621f330fb8899ed31fe682393` |
| Vault | `0x2e9e7412e19497b60f25d05b68717067a6b743d4` |
| RNG обоих контроллеров | `0x53c0d6f3e22fa34ce59daabc6327ad10732b14cf` |

USDG decimals6 и runtime hash совпали с API. Обратные связи обоих контроллеров
с vault проверены. API и on-chain reserves совпали:
Short79.782582, Monthly current93.241441, next46.620720, balance219.644743 USDG.
Reserved0, claimable0; сумма обязательств не превышает баланс.
Short earliestAt1791239285, Monthly1793648879, Monthly minimum100USDG совпали.
История API сообщает два завершённых розыгрыша; выплаты этой проверкой не replay-ились.
Нет утверждения о текущей доступности worker или отсутствии ожидающих RNG requests.

## Что переносится и что ещё требуется

| Область | Общая платформа сейчас | QIANQI / следующий адаптер |
|---|---|---|
| Хранение и изоляция | PostgreSQL, project/module scopes, journals | Отдельный existing-project profile; контрактные адреса сохранить |
| Чтение сети | Общие blocks/receipts, локальный fork | Mainnet finalized cursor и project-significant history; не загружать всю сеть без ограничения |
| Розыгрыши | Полный новый локальный Short | Два старых контроллера, Short policy epochs и Monthly; нельзя подставить новый preset |
| Билеты | Новая incremental ledger + local late adapter | Сохранить старую арифметику, оба lane, frozen/open/spent и creditedAt; независимый replay |
| Покупки | Проверенные local curve/opening routes | QIANQI pool/EntryPoint/0x/native reviewed routes; неизвестные формы не признавать автоматически |
| RNG | Новый локальный durable request flow | Два consumer одного adapter; восстановить старые request/context/unfinished состояния |
| Передача управления | Не реализована | Shadow comparison, отдельная согласованная репетиция состояния, затем one-worker handoff |

## Источники и пределы

Исходный checkout `D:/sites/rh_project`, HEAD
`11a050d995f17c2c810db1fe5c4e7a3ec1190ff3`, **dirty**, не изменялся.
Изучены CURRENT_CONTEXT, ROADMAP, PUBLIC_STATUS_API, NATIVE_ROUTES_2026-10-05,
scripts/public-observation.cjs и цепочка ShortControllerBase/ShortRulesEpochs/
ShortDatasetPreparation, MonthlySettlement, DualControllerPromoVault.
Документы исходного проекта являются источником для исследования, не текущим
production-доказательством. В частности, успешная отправка24 late confirmations
из его CURRENT_CONTEXT ещё не проверена нашим replay/indexing.
Первый пробный запуск inventory остановился на неверном getter promoVault;
у актуального Short нужен datasetVault. Ошибка исправлена по исходнику и live call.

Unit-проверки: запрет write RPC, два контроллера, wrong chain, stale API,
finality lag/hash conflict, неверная binding, пустой runtime, reserve drift,
reorg во время чтения. Полный финансовый suite не нужен: worker не изменён.
Результат: `node --test tests/unit/qianqi-inventory.test.mjs` — 10/10 PASS.
После добавления проверки finalized hash повторный live запуск также PASS:
`.local/test-results/qianqi-inventory-2026-10-09T11-46-11-306Z/report.json`.

Следующий пакет: read-only ticket/lifecycle adapter QIANQI с ограниченным
диапазоном истории, обеими ветками и late recognition, отчёт различий с публичным
API на совпадающем cutoff. Не подключать финансовый executor до сверки continuity.
