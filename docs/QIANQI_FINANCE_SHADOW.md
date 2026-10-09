# QIANQI: историческая сверка RNG и обязательств

09.10.2026, база платформы 2222518. Только публичные read-only RPC, без SSH-изменений, приватных журналов и транзакций. Исходники форматов: vendor/qianqi/contracts/DrandRandomAdapter.sol, ShortControllerBase.sol, ShortSettlement.sol, ShortRulesEpochs.sol, PromoVault.sol, DualControllerPromoVault.sol (зафиксированный vendor ae445254). Новая реализация: src/qianqi/finance-shadow.mjs.

## Результат

FINANCE_RNG_MATCH на прежнем контрольном блоке **84135771**, hash 0x0838573c5fd2fad3760a931a8e109e3c02c069f0612628cc40c5efa02297f78c. Это не утверждение о состоянии на последнем блоке сети.

| Short | RNG request / round | Бюджет USDG | Назначено и выплачено | Возвращено в свободный резерв |
| --- | --- | --- | --- | --- |
| Первый | 1 / 21223496 | 139.272889 | 6.963644 | 132.309245 |
| Второй | 2 / 21232126 | 132.789855 | 53.115936 | 79.673919 |

Всего пять выплат на **60.079580 USDG**. Для каждого получателя сверены RewardAssigned, RewardPaid, USDG Transfer и оставшийся reward. Невостребованные призы и reserved равны нулю.

Свободные резервы: Short79.782582, Current93.241441, Next46.620720 USDG. Их сумма **219.644743 USDG** совпала с балансом vault. Нераспределённого остатка нет. Это проверка покрытия обязательств, не пересчёт всей истории распределения входящих комиссий.

На контрольном блоке activeProposal/pendingDatasetDraw Short, activeMonth/pendingMonth Monthly и pendingMonthlyDrawId vault равны нулю. Monthly RNG requests отсутствуют. Два запроса RNG соответствуют двум завершённым Short, прочих резервирований/финализаций в проверенной истории нет.

## Что проверяется

Перед live-сверкой повторно проверяется архив истории через verifyHistoryArchive. Запросы событий начинаются с79000001; на79000000 для каждого опрашиваемого emitter подтверждено отсутствие кода. Запрос от genesis RPC отверг, неуспешный capture сохранён отдельно.

Events привязаны к canonical receipt/header, duplicate logs отвергаются. Runtime контроллеров/vault совпадает с прежним историческим профилем. RNG consumers совпадают с контроллерами. DatasetSealed/context, controller drawRequest/requests, provider requests/contextRequest и settlement образуют одну цепочку. Seal и RNG request подтверждены одной транзакцией.

Проверяются формула будущего раунда по timestamp/lead, наступление времени beacon, BLS verify через historical eth_call, вычисление seed из chain hash/signature hash/chain/provider/request/consumer/context. Затем terminal snapshot/result hash сверяется с контроллером, призы — с vault и фактическими переводами.

Полнота selection и историческое исполнение RPC остаются доверенной границей. Проверка BLS делегирована историческому контракту через eth_call, не отдельной локальной BLS-реализации. Выбор победителей получен через shortResult и сверен с событиями/выплатами; алгоритм отбора по билетам и seed независимо не пересчитан. Не заявлять полный независимый аудит исходов.

## Воспроизведение и доказательства

- node scripts/qianqi-finance-shadow.mjs [optional-prior-finance-cache]
- node tests/qianqi/finance.mjs .local/test-results/qianqi-finance-2026-10-09T15-21-08-436Z
- node tests/qianqi/history.mjs .local/test-results/qianqi-history-2026-10-09T13-19-20-045Z

**8 новых +8 соседних tests PASS.** Негативные сценарии: seed, BLS false, чужой резерв, дефицит vault, фиктивный reward, пропущенная выплата, pending draw. Финальный capture: .local/test-results/qianqi-finance-2026-10-09T15-21-08-436Z/report.json и numbered RPC. Повторная offline-проверка: offline-verified.json. Пределы/source hashes: .local/notes/qianqi-finance-2026-10-09.json. Архивы не публикуются как production state, ключей/RPC credentials в них нет.

## До передачи исполнителю

Нужно сохранять draw/proposal IDs, frozen snapshots, RNG request/context/round/proven/delivered/seed, progress settlement, обязательства reward/paid/reserved/claimable и денежные резервы. Это on-chain состояние не надо пересоздавать при подключении существующего проекта.

Данный пакет не проверяет приватные signed intents, nonce, незавершённые сетевые отправки или процессы старого worker. Он не импортирует финансовое состояние в executor и не разрешает переключение. Следующий пакет — актуализация shadow на новых блоках и непрерывное сравнение; затем независимый replay исходов и отдельная репетиция handoff с проверкой журналов и единственным исполнителем. Для Month с реальным draw потребуется отдельный verifier, текущий путь останавливается при его появлении.
