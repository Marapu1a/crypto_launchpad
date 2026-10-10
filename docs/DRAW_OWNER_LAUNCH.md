# Сохраняемый запуск v2: три режима

10.10.2026, база7394c91. Отдельный `createDrawOwnerCoordinator` в
`server/owner-launch/draw-coordinator.mjs`, без переключения действующего v1 UI.
`src/launch/draw-template.mjs` проверяет v2-конфигурацию и общие Pons/адресные поля.
V1 и v2 не преобразуются автоматически; существующий coordinator.mjs не изменён.

## План и транзакции

Сохраняются полный input, профиль среды/ролей/бюджетов, build identity,
проверенная экономика Pons, текущий candidate/pending и история receipts.
Изменение параметров после создания плана запрещено. Artifacts берутся только
из внутренней закреплённой сборки v2, не из запроса/переданного внешнего build.

Последовательность:

1. Short+его RNG, если включён; Monthly+его отдельный RNG, если включён.
2. DrawFundingRouter с точными адресами/долями, FeeSplitter, PonsFeeCollector,
   PurchaseRecognition. Выключенному типу соответствует нулевой адрес router.
3. Явно заданное финансирование газа двух разных служебных кошельков.
4. При необходимости approval quote, затем Pons launch и необратимый collector.bind.
5. Проверка v2 runtime/policy связей; сохранение policy, статус `deployed`,
   `executionEnabled:false`.

Constructor calldata создаётся из валидированной конфигурации доверенными ABI.
Каждый шаг оценивается и ограничивается gas/total native budget перед arm;
текущие Pons условия перепроверяются перед launch. Адреса deploy определяются
по фактическому owner nonce. После receipt закрепляются runtime hash и RNG адрес.

## Журнал и восстановление

Используется существующий PostgreSQL owner_launches: project RLS, checksum,
revision, owner-wide advisory lease, один незавершённый launch на owner,
предварительное резервирование executor/publisher. До вызова кошелька точный
nonce/request уже сохранён. После потери wallet response нельзя занимать новый
nonce; attach проверяет sender/chain/nonce/to/data/value/gas caps. Следующий шаг
открывается только после canonical finalized receipt. Revert сохраняется blocked.

В общем store добавлено завершение только для пары owner-launch-v2/deployed;
условие завершения v1 registered сохранено. Завершение освобождает очередь owner
для следующего токена, но не снимает резервации служебных кошельков.
Повторное открытие deployed-плана не создаёт новых транзакций.

## Что ещё не подключено

V2 не регистрируется в старом production_senders: его worker понимает только v1.
Созданные token/curve/policy сохраняются в owner journal; проекты/модули API и
серверное обслуживание будут зарегистрированы следующим отдельным handoff.
HTTP/UI ещё используют прежний coordinator; в этот пакет входит вызываемый
серверный модуль и его сквозная проверка, не готовая кнопка нового конструктора.

Транспорт допускает только частный Hardhat fork4663 с совпавшим instanceId,
anchor и Pons pins. Mode production отвергается. Это не permission на реальные
транзакции. Реальные расширения кошельков и текущие Pons условия этим тестом
не проверены. На fork использована openingBuy0; approve/openingBuy ветки унаследованы
из v1, отдельный новый прогон покупки при launch в данном пакете не выполнялся.
Временной нижний предел Short по production timing остаётся задачей admission.

## Проверки

`npm run test:draw-owner-launch`: отдельные PostgreSQL и исторический fork82000000.
Три последовательных токена с разными служебными кошельками: Short/Monthly/оба.
На каждом шаге пересоздаётся coordinator после отправки, hash восстанавливается;
первый receipt каждого плана удерживается до simulated finality. Проверяются
неизменность input, запрет retry использованного nonce, отсутствие повторных
контрактов/nonce, правильный состав и итоговая v2 policy, отсутствие auto worker
registration, сохранённый completed и безопасное повторное открытие.
Дополнительно production mode и изменённый профиль отвергаются; v1 coordinator
не принимает v2 журнал. Это пересоздание серверного объекта с чтением PG,
не аварийное завершение ОС/процесса посреди SQL-запроса.

Unit/соседи: v2 launch2, owner matching/signing2, config v2 4.
Следующий пакет: v2 worker/ledger и отключённый handoff с регистрацией,
затем объединение конструктора и owner UI, репетиция всех циклов и серверное
подключение по отдельной отмашке. QIANQI не меняется.

Итог:4 fork/PG сценария и8 unit/соседних PASS. Отчёт:
`.local/test-results/draw-owner-2026-10-10T20-00-40-599Z/report.json`.
