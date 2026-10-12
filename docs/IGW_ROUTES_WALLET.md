> Технический документ с результатами отдельных пакетов. Датированные статусы и «следующие шаги» ниже — история; актуальная готовность — в [CURRENT_CONTEXT](CURRENT_CONTEXT.md), очередь работ — в [ROADMAP](ROADMAP.md).

# IGW: маршруты покупок и личные билеты — 12.10.2026

**Дополнено 12.10.2026:** ниже сохранён первый пакет. Его ограничение с остановкой scanner на недоступной трассе устранено для новых запусков общим [механизмом отложенного распознавания](DEFERRED_PURCHASE_RECOGNITION.md). Неизвестные маршруты теперь ожидают в отдельной очереди; прежний текст о блокировке относится только к старому policy без `purchaseAccounting`.

Согласованный пакет: закрыть найденную покупку Pons и добавить кабинет IGW.
Исходная точка: c50337a; изменения этого пакета пока локальные.
Контракты, кошельки и production QIANQI не изменялись. Реальных отправок нет.

## Распознавание

Новые owner-launch-v2 сохраняют профиль `pons-65050-batch-20261012-v1`
в неизменяемой identity запуска и policy. Старые журналы/политики без этого
поля сохраняют прежние правила; автоматического пересчёта истории нет.

Кроме прежних direct USDG/opening buy, профиль включает:

- USDG approve+buy self-batch с проверкой EIP-7702 authority и закреплённого executor;
- роутер `0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc`, текущий модуль
  `0x7e7d82b72797821f94dffed7d5e77e24c7532f30`, один USDG→token шаг;
- тот же роутер: ETH→WETH→USDG через закреплённый pool, затем покупка на curve.

Проверяются canonical calldata, receipt/trace logs, sender=recipient, полные
движения quote/token, native payments, code hashes исполненных адресов на
исходном и предыдущем блоках. Token/curve берутся из policy конкретного проекта.
Trace — доверенное свидетельство RPC, не криптографическое доказательство.

База USDG-покупки — полное списание USDG с кошелька, включая явную комиссию
роутера, как в исходном wallet-net-debit подходе. Для ETH — фактические USDG,
переданные кривой после обмена; ETH не пересчитывается по внешней цене.
Продажи, transfer, чужой получатель, непроверенное исполнение не дают билетов.
Неполная/недоступная трасса вызывает retryable `route-evidence-unavailable`:
durable cursor не проходит такую покупку, health показывает проблему.

Park, другие native aggregators, и торговля после graduation этим профилем
не покрываются. Нельзя рекламировать поддержку любых покупок Pons.

## Проверенный исходный пример

Публичная транзакция:
`0xf316b1a272f708379d5ba96f086ea1a1205225390ec920c5aa9c3d8044b6c52c`,
блок86149336, hash
`0x8683a659c9c87c3ddf6f3e3c45f19f0c810dc76860eb8b85f04dfce16121779d`.
Token `0x52bdd86374121dbf8b7fe1f8f399249e5f622ca3` — чужой токен для read-only
проверки, не IGW. Покупка теперь ELIGIBLE:12485319 raw USDG, т.е.12.485319USDG.
При пороге10USDG это один билет и2.485319USDG остатка; в production никому
не начислялось. Это один реальный пример, не статистика распространённости.

Fixture: `tests/fixtures/draw-router-86149336.json` (публичные данные,
служебные адреса pure-decoder harness условные). Полная исходная трасса/runtime:
`.local/igw-launch-prep/route-evidence.json`. Повторное живое чтение:
`.local/igw-launch-prep/route-live-check.json`, PASS2026-10-11T22:18:16Z.

Основной RPC из подготовки не поддерживает `debug_traceTransaction` (-32600).
Read-only трасса с отдельного QuickNode и исторические code reads с основного
RPC совместно прошли проверку. Runtime v2 принимает optional `traceRpcFile`
(абсолютный путь к отдельному приватному файлу). Через него идёт только debug trace;
отправки и остальные чтения сохраняют основной provider. Проверяются обе chain4663.
**Перед включением серверной службы нужно установить этот файл и параметр.**
В этом пакете серверный конфиг не менялся, служба остаётся выключенной.

## Кабинет

`GET /api/wallet/0x…` использует hostname проекта и существующий PostgreSQL RLS.
Общий `/api/draws` не возвращает карту кошельков; личный endpoint возвращает
только запрошенный адрес. Нет выбора проекта через query/header.

Проекция строится на одном canonical finalized checkpoint из подтверждённого
ledger и contract reads на том же блоке. Для каждого Short/Monthly отдельно:
накопленные покупки, выпущенные/использованные/замороженные/доступные билеты,
остаток покупок, неоплаченная награда **последнего** цикла. Это не полный архив
наград и не сумма задолженности всех старых циклов. Неподтверждённая покупка ещё
не увеличивает счётчики. Отсутствие wallet projection показывается как отсутствие
данных, не как нулевой баланс.

IGW: подключение injected wallet или просмотр по адресу; только
`eth_requestAccounts`, без signatures/approvals/sends. Смена аккаунта, disconnect,
ошибка API и запоздавший ответ не оставляют чужие цифры. Устаревшие снимки помечены.
До проверенного deployment форма недоступна. Торговля и prelaunch-статус не
активируются от наличия нового интерфейса.

Локальный просмотр: http://127.0.0.1:4197/#account — **симулированные данные**,
помечены жёлтой полосой; используется отдельный fixture server, не production API.
Сайт на публичном домене этим пакетом ещё не обновлялся.

## Проверки

- Real native fixture + подмены runtime/parent/logs/sender/token/calls: PASS.
- Synthetic USDG route и неверная сумма router fee: PASS.
- Self-batch и legacy attribution/signature regression:4PASS.
- Wallet counters, frozen hash/ranges, late tickets, exact remainder/API filtering:2PASS.
- Runtime/config/trace dispatch:6runtime +1dispatch PASS.
- Public projection modes/canonical guards/route identity:4PASS; legacy PG projection:4PASS.
- Shared site/API/RLS, включая новый wallet endpoint:5PASS.
- Chromium IGW wallet:7сценариев PASS,320/390/1440px; prelaunch/live regression PASS.
- Owner deployment on private fork:4PASS после фиксации route profile в journal identity.
- QIANQI:53реальные исторические покупки,10positive/negative regression tests PASS.
- `npm run build`:PASS; сборка Vite не включает статический IGW — он проверен отдельно.

Отчёты: `.local/test-results/igw-wallet-2026-10-11T22-20-48-015Z/`,
`short-site-2026-10-11T22-16-58-826Z/`, `draw-owner-2026-10-11T22-20-00-299Z/`,
`short-projection-2026-10-11T22-22-23-654Z/` под тем же test-results.
Сквозной worker-cycle:3PASS, отчёт
`.local/test-results/draw-worker-2026-10-11T22-15-55-616Z/report.json`.
Проверены три режима, recovery/gas wait, ожидание finalized регистрации,40билетов
в frozen cycle +1поздний доступный; после settlement40использованных +1доступный,
reserved0, liabilities0 и отсутствие повторных выплат. Финальные проверки frozen
hash/range дополнительно прошли unit; сохранённые4реальных frozen hashes harness
сверены отдельным read-only чтением его временной БД.

Дальше: окончательные metadata/IPFS и газовые резервы, публикация нового кода,
установка trace RPC, затем owner signing и явная регистрация/активация IGW.
