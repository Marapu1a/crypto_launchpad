# Покупки Pons → билеты Short — 08.10.2026

Пакет: настраиваемый порог, остатки покупок, durable scan и snapshots, передача
участников локальному Short. USDG6decimals, локальный fork31337 от4663.
Это ещё не production admission и не индексатор всей торговли после graduation.

## Реализация

`src/tickets/direct-curve.cjs` адаптирован из QIANQI ae445254
scripts/pons-curve-buy.cjs: логика проверки прямой покупки сохранена, старый
manifest с hardcode100USDG заменён новым профилем/проверками scanner.mjs.
`recognition.mjs` добавляет launchAndBuy router: canonical calldata, buyer/recipient,
Launched и CurveBuy, фактические ERC20 transfer legs, refund до инициатора.
База билетов — списание quote за вычетом возврата; launch fee в ETH не учитывается.
Равенство payer/recipient обязательно для этих двух маршрутов.

Профиль привязан к токену, кривой, программе, factory/router/hook, USDG, порогу,
anchor и экземпляру Hardhat. Запоминаются runtime code hashes; при чтении
проверяются chain/instance/anchor/runtime/factory/curve/router/program bindings.
Профиль — явно доверенная локальная конфигурация, не доказательство честности RPC.

Scanner читает блоки подряд и receipts всех транзакций, до500блоков за проход.
Хранит headers, решения распознавания и исходные transaction/receipt для кандидатов.
Пересчёт билетов из истории детерминирован, повторный проход не начисляет заново.
Запись: exclusive lock, checksum, временный файл+fsync+rename. Повреждённый state,
другая конфигурация, regressed/changed branch останавливают работу без перезаписи.
После аварии оставшийся .lock требует ручной проверки; автоматического снятия нет.

Состояния решений: ELIGIBLE; SELL; неоднозначные/неподдержанные вызовы с причиной;
transfer без поддержанной покупки помечается TOKEN_TRANSFER_WITHOUT_SUPPORTED_BUY.
Продажи не отменяют билеты, transfer сам по себе не даёт билетов. Агрегаторы,
smart-wallet batch, покупки другому получателю, nativeETH, V4/pool после graduation
не поддержаны в этом пакете. Считать их покупками по одному Transfer запрещено.

Snapshot привязан к profileHash/cutoff block/hash/program/cycle и participantsHash.
Лейбл и цикл нельзя заменить другим снимком. Покупки после cutoff идут следующему
набору. Использованные диапазоны читаются из consumedThrough контракта, не из
доверенного вручную локального счётчика. Сверка settlement проверяет settled и
participantsHash нужного цикла. Сам freeze контракту отправляет тестовый сценарий:
production publisher/keeper и journal исполнения сюда ещё не входят.
Снимок без участников допустим как отчёт; LocalShortProgram не запускает пустой draw.

## Запуск

- `npm run fork` — уже настроенный локальный fork (RPC из игнорируемого файла).
- `npm run test:tickets:fork` — создаёт тестовые токены/программы только на fork.
- `node scripts/index-tickets.mjs profile.json state.json cutoffBlock [snapshotLabel]`
  — один проход/перезапуск. Профиль создаётся через createProfile; пример сохраняет тест.
- `node --test tests/unit/tickets.test.mjs` — offline проверки начисления и распознавания.

Порог хранится в rawUSDG:10000000 означает10USDG. Единицы quote не конвертируются в
USD по внешней цене. Каждому токену нужны отдельные программа и файл состояния.
Профиль привязывает программу явно; глобального deployment registry пока нет.

## Пределы и проверки

4 unit-сценария: порог/остатки/дубликаты/непокупки, cutoff и consumed диапазоны,
прямой buy с refund и неверными свидетельствами, opening refund с отсутствующим
обратным переводом. Refund сценарии синтетические, не fork graduation.
6 fork-сценариев: opening6+direct4 при пороге10; второй покупатель25→2+остаток5;
transfer/sell; повторный scan и перезапуск отдельным Node-процессом, checksum;
поздние покупки/неизменный snapshot; Solidity freeze/settle по индексированному
списку, новые билеты следующему циклу; второй токен/порог/программа; reorg halt.

Fork стартовал с блока83388335. Использованы только тестовые отправки наlocalhost,
USDG получен через impersonation в локальной копии. QIANQI/vendor не менялись.
Полная финализация mainnet не реализована: cutoff локальный, assertLocalFork
запрещает основную сеть. При reorg автоматического replay/отката frozen state нет:
остановка и разбор. Один RPC не доказывает полноту истории, snapshot checksum
не является подписью. Настоящий RNG/индексатор-сервис/мониторинг — следующие пакеты.

Итоговый fork report: `.local/test-results/tickets-2026-10-08T14-42-54-458Z/report.json`,
6/6 PASS;4/4 unit PASS. Последний reorg-сценарий намеренно делает сохранённый
тестовый state неканоническим; он остаётся доказательством halt, не рабочим state
для продолжения. Для нового прогона используются новые каталог/токены/программы.

Уточнение 08.10.2026: поздняя покупка после cutoff в существующих тестах — не позднее распознавание старой покупки. Механизм QIANQI creditedAt ещё не перенесён. Правила и обязательные проверки: [FIRST_TOKEN_REHEARSAL](FIRST_TOKEN_REHEARSAL.md).

Перенос выполнен отдельным локальным пакетом [LATE_RECOGNITION](LATE_RECOGNITION.md): исходные события неизменны, creditedEvents проверяет сохранённые подтверждения и строит производный реестр, snapshotTickets использует creditedAt. 8 unit + 7 fork PASS. Профили без recognition продолжают обычное начисление. Только непроверенные прямым декодером маршруты получают WAITING_RECOGNITION; это ожидание доказательств, не обещание поддержки маршрута.

08.10.2026: lock индексатора теперь содержит PID/hostname/дату для явной проверки аварийного владельца; автоматического снятия по возрасту нет. Используется локальным [worker](LOCAL_WORKER.md). Соседний fork прогон после изменения:7/7 PASS, .local/test-results/tickets-2026-10-08T16-49-52-832Z/report.json.
