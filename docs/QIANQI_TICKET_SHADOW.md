# QIANQI: read-only сверка учёта билетов

09.10.2026. Продолжение [inventory](QIANQI_READONLY_INVENTORY.md).
Новый адаптер пересчитывает carry, начисления и lifecycle Short/Monthly для
выборки кошельков из публичных confirmation bundles. Отчёт имеет статус
`ACCOUNTING_MATCH`, **не** full independent BUY replay: API всё ещё задаёт
допуск покупки, payer и сумму. `executionEligible=false`, `independentBuyReplay=false`.

## Что реализовано

- `src/qianqi/ticket-shadow.mjs`: целочисленный учёт двух lanes, carry, freeze,
  terminal, сверка API, проверка привязки поздних подтверждений к публичному bundle.
- `src/qianqi/shadow-reader.mjs`: ограниченное чтение публичных API/RPC, receipt/
  block/cutoff проверки, сбор выборки из on-chain confirmations и неизменяемых bundles.
- `scripts/qianqi-ticket-shadow.mjs`: запуск без signer и без записи в общий backend.
  Новые артефакты каждого запуска, Git HEAD/dirty flag и SHA256 исходников в отчёте.

Запуск: `node scripts/qianqi-ticket-shadow.mjs`.
Обычный API/indexer/финансовый worker запускать не требуется.
Снимки сохраняются в `.local/test-results/qianqi-shadow-<UTC>/`.
Это новые публичные наблюдения; production-конфиги, journals, manifests и ключи
не копируются. Исходный `D:/sites/rh_project` и vendor не изменены.

Все страницы и кошельки должны иметь одинаковые head/hash, manifestHash и ledgerHash.
Смена поколения во время сбора останавливает запуск; автоматического смешивания нет.
API может обновиться после сбора: историческая проверка остаётся на исходном блоке.
Inventory проверяет его относительно finalized. Receipts, cutoff headers, anchor
и head сверяются через архивный RPC; использованные исторические headers читаются повторно.

Количество билетов вычисляется из raw amounts, не копируется из `entriesMinted`:
API entries и итоговые balances используются для сравнения. `creditedAt` поздней
покупки связан с реальным `PurchasesRecognized`, оригинальным receipt и bundle hash.
Для повторного включения покупки сохраняется первая позиция подтверждения.
Покупка до cutoff с подтверждением после cutoff не попадает в старый freeze.
Оба terminal outcome, включая NO_WINNER, списывают frozen набор; claim не участвует.

Адаптер поддерживает genesis epoch1. Изменение/объявление политики либо другой
current/draining epoch прекращает проверку, а не объединяется с epoch1.
В отчёте сравниваются carry, minted/open/consumed, frozen ranges и byEpoch.

## Реальная проверка

2026-10-09T12:12:21.030Z—12:12:49.753Z, **ACCOUNTING_MATCH**,206 RPC calls.
Отчёт: `.local/test-results/qianqi-shadow-2026-10-09T12-12-21-030Z/report.json`.
Исходный HEAD `8f56a79f13bae6c24d191fe21e91a633b64631ad` + новый пакет в рабочем дереве;
точные SHA256 четырёх выполнявшихся исходников сохранены в report.sourceHashes.
После добавления строгой проверки соответствия RPC receipt/hash и запрета
creditedAt раньше original внутри блока финальный код повторно обработал эти же
сырые артефакты **офлайн**, без новых RPC: ACCOUNTING_MATCH,
`.local/test-results/qianqi-shadow-offline-2026-10-09T12-16-31-014Z/report.json`.
SHA256 финальных модулей есть в offline report. Локальный helper:
`node .local/notes/replay-qianqi-shadow.mjs <каталог-живого-прогона>`.

Anchor79377859:
`0xfa6872fc31c8a7cb329ca96586107cc7a9659ced22f21eb903ab47ec8a11af49`.
Общий блок API **84135771**:
`0x0838573c5fd2fad3760a931a8e109e3c02c069f0612628cc40c5efa02297f78c`.
Manifest hash:
`0x353b3183e0a2759b27be1236c30f1f5e418224eff70d0e98cc6d69ce5eefe3e3`.

| Проверенная выборка | Результат |
|---|---|
| Кошельки | 48 |
| Покупки / late credits | 53 / 53 |
| Confirmation batches | 4 |
| Lifecycle events | 2 Short freeze + 2 Short terminal |
| Начислено Short / Monthly | 26 / 26 |
| Открыто Short / Monthly | 12 / 26 |
| Использовано Short / Monthly | 14 / 0 |
| Расхождения по кошелькам | 0 |

Это итоги **выборки**, не утверждение об охвате всех покупателей токена.
Живого Monthly terminal в этом интервале нет; его списание и NO_WINNER покрыты fixtures.

| Блок подтверждения | Покупок | Bundle hash |
|---|---:|---|
| 80763356 | 1 | `0x42e9f3c1853400d0159015e125ab9a32b7fa387151db8af46f92c8627c78f144` |
| 80812495 | 27 | `0xb7eaee75b96a81d46a85765d5f46150f7abe139cf847df4fa6e2ad9bcf296d39` |
| 82238968 | 24 | `0xdd36dc998be9f70b724c343a304bf76e8fe8ce43544c5300b44b96c9327e1672` |
| 82285289 | 1 | `0x1e718e590e45a98c9939172b9bedba995486f5d55c9ad2558c937f75132e3e5f` |

Файлы получены с `https://qianqi.site/evidence/purchases/<bundleHash>.json`;
проверены canonical JSON Keccak, chain/token/instance/count, принадлежность каждой
исходной tx, receipt подтверждения и первая creditedAt. Доказательства trace
в этих файлах **не переисполнялись** и не считаются проверенными только по хешу.
Пакет24 от07.10 уже присутствует в finalized/API-учёте данной выборки:
проверка не ограничилась receipt успешного confirm. Дополнительно найден пакет1
на82285289. Оба появились после второго Short и не переписали его списания.

Первый, более узкий результат сохранён отдельно:
`.local/test-results/qianqi-shadow-2026-10-09T12-06-55-762Z/report.json`,
24wallets/28purchases, block84132102, Short open0 / Monthly open14.
Он не подменён расширенным снимком.

## RPC и незавершённые попытки

Архивные call/receipt/header — локальная RPC-настройка платформы, URL в отчёт не попадает.
На09.10 endpoint возвращал HTTP400/-32600 для getLogs шире10блоков (free tier).
Историю выбирает публичный `https://rpc.mainnet.chain.robinhood.com`, а найденные
receipts и block hashes сверяются через настроенный архивный RPC.
Публичный RPC ограничивал OR-фильтры100000блоками; итоговый сборщик использует
по одному адресу и topic за запрос. Общий диапазон ограничен6млн блоков,
100confirmation batches,200кошельками,1000 lifecycle events,2000RPC/5мин на запуск.
Не читает и не сохраняет каждый пустой блок. Это наблюдённые лимиты, не SLA.

Сохранены INCOMPLETE-прогоны12:05:14 (первоначальный широкий запрос к free RPC),
12:06:23 (OR range),12:09:02 и12:10:02 (публичный RPC HTTP403).
Причина403 не установлена; после сокращения числа запросов повтор12:12:21 прошёл.
Оплата/смена тарифа не выполнялись. При недоступности источника нет fallback,
который заменяет отсутствующие события нулями или выдаёт ACCOUNTING_MATCH.

## Тесты и границы доверия

- 16 unit accounting/evidence: carry, late cutoff, две ветки, frozen сохранение,
  оба outcome, дубли, first credit, конфликт original branch, pagination/generation,
  raw log/receipt, source/domain, epoch rejection и запрет write RPC.
- 3 collector tests: полный синтетический контур, mismatch, API generation drift,
  unavailable logs и mid-read reorg.
- Соседи:10 inventory +8 платформенных ticket tests — PASS.

Всего37 тестов; финансовый worker и DB не изменялись, полный suite не повторялся.

Успех доказывает совпадение **учёта при данном наборе признанных покупок**.
Не доказывает payer/amount/eligibility каждого маршрута, отсутствие пропущенных
API/RPC событий, глобальный snapshot hash, честность RNG, бюджет или выплату.
Контрактные runtime hashes остаются наблюдениями из inventory, не admission pins.
Кошельки выбираются по trace.from в публичных bundles; это способ выбора адресов
для проверки API, не универсальный способ определить владельца сложного маршрута.

Источники механики: `vendor/qianqi` reference commit
`ae4452547b7df09124af3bcb72261120725d5aba`, scripts/attempt-lifecycle.cjs,
purchase-recognition.cjs/direct-buy.cjs; текущие документы исходного QIANQI
USER_STATUS_API, ATTEMPT_LIFECYCLE, PURCHASE_RECOGNITION, NATIVE_ROUTES_2026-10-05
(checkout HEAD11a050d, dirty, только чтение).
Реализация новая, находится вне vendor и не импортирует его runtime.

Следующий пакет: независимый BUY/route verifier для этой же выборки — суммы и payer
из canonical receipt/calldata/trace, сверка reviewed runtime pins. Затем расширение
на полную проектную историю и проверка snapshot hashes; только после этого обсуждать
перенос состояния и one-worker handoff. Подключение QIANQI к financial executor ещё закрыто.
