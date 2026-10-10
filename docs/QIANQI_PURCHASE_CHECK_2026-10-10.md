# QIANQI: две покупки и поступление комиссий

10.10.2026, проверка по обращению владельца «две покупки, фонд не пополнился,
ошибок в Telegram нет». Код платформы на момент проверки `fc9975d`;
live executor `/opt/crypto-launchpad/releases/d0a6840-writer-90328c4`.
Только чтение: без restart, ручных транзакций, правок конфигурации и уведомлений.

## Результат

Обе покупки распознаны как `ELIGIBLE / SUPPORTED_SELF_BATCH_BUY`.
Комиссии штатно собраны и перечислены; на момент первого просмотра API
ещё показывал finalized-снимок до пополнения. Затем API догнал перевод.
Финансового сбоя в проверенной цепочке нет.

Все указанные receipt имеют status=1 и совпадающий canonical block hash.
Время ниже — МСК, из timestamp блоков.

| Операция | Время | Блок | Сумма USDG |
| --- | --- | --- | --- |
| Покупка 1 | 10:56:28 | 84839606 | 0.750000 |
| Покупка 2 | 10:56:51 | 84839821 | 0.842856 |
| Sweep curve → Pons escrow | 10:57:42 | 84840323 | 0.058935 для collector |
| Escrow → collector | 10:58:47 | 84840943 | 0.058935 |
| Collector → prize vault | 11:00:22 | 84841882 | **0.053042** |
| Collector → общий team/ops адрес | 11:01:27 | 84842517 | 0.005892 |

Хэши по порядку:

```text
buy1  0x78a4b783d9fbca3894b7b42b231cb2a0f953313a2fb2c12fa8caf1a5ec9a973c
buy2  0xe60631666b4e4cbb3fae6e30f3bca15a04a785d364ec9c4c624f282450528a1a
sweep 0x04e98216f148a74d5db3d233ba5f9d3fad9a5cc71f1a4cd2efaf0d1510f986b0
pull  0xf93911064fd4833d6da6a58b31e9d1f1ae65e983ac0c40de2d7eae63507ffbde
prize 0xc4d11878ffcd64f8c2c190e37c5b45a04600f619c19f36845e8ea917523fb5e3
team  0xa7c671923fb0ceda65d83e78e920385edae67905adbaf889c1cf92a3ef93b2ee
```

CurveBuy содержит fee/tax: 7500/22500 raw и 8428/25285 raw.
Не следует путать полный fee Pons с поступлением creator collector;
выше показаны реальные ERC20 Transfer, а не прогноз процентов.
После распределения balance и accounted collector равны 2 raw (0.000002 USDG);
ready credits, escrow due и curve quoteDue равны нулю. Нераспределённой готовой
операции нет. Общий executor nonce latest/pending 89/89, lastResolved — team pay.

## Почему на сайте не было изменения

Первый API-снимок: observedAt `08:15:18.097Z`, head 84839831 — после покупок,
но **до** перевода prize на блоке 84841882. Баланс vault — 219.644743 USDG.

Снимок после штатного обновления: observedAt `08:17:58.755Z`, head 84843619,
indexer state caughtUp, target=processed=84843619. Баланс совпал с chain:
219.697785 USDG. Проверенный latest был 84851465, finalized 84843619;
индексатор следует finalized, а не самым новым блокам.

| Часть фонда | До | После | Изменение |
| --- | --- | --- | --- |
| Short | 79.782582 | 79.809103 | +0.026521 |
| Monthly current | 93.241441 | 93.259122 | +0.017681 |
| Monthly next | 46.620720 | 46.629560 | +0.008840 |
| Всего | 219.644743 | 219.697785 | +0.053042 |

Short пока ниже порога 100 USDG, поэтому ожидание prizeFunding остаётся штатным.
Эта проверка не утверждает, что у покупателей появился целый билет: обе покупки
маленькие, а threshold QIANQI — накопленные 100 номинальных USDG.

## Почему Telegram молчал

Automation и indexer active/running, NRestarts=0. В journal видны два прохода
по 2 успешных шага, failures=[]; позднее waiting/prizeFunding.
Monitor timer active, штатные запуски наблюдались в 08:15–08:17 UTC;
последний завершённый запуск пишет `suppressed; operational checks healthy`.
Oneshot monitor между запусками имеет inactive/dead — это нормальный режим таймера.

`ops/qianqi/notify.cjs` не относит prizeFunding к авариям; уведомления о каждом
успешном пополнении не предусмотрены. Поэтому отсутствие тревоги соответствует
состоянию. Отправка тестового Telegram-сообщения в этом расследовании не выполнялась.

## Источники и пределы

Read-only SSH: systemctl/journalctl, выбранные публичные поля config,
санитизированный operator status, lastResolved, ledger decisions/index status.
Read-only RPC через существующий credential: receipts, canonical blocks,
CurveBuy/ERC20 Transfer, collector inspect/calls; публичный
`https://qianqi.site/v1/overview?limit=1`.
Секреты, raw signatures и production журналы на компьютер не копировались.
Это проверка именно этих двух покупок и четырёх финансовых отправок, не нового
розыгрыша. Одновременно подтверждена естественная финансовая активность после
переезда на общий backend, без искусственных покупок или ручного sender.
