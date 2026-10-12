> Технический документ с результатами отдельных пакетов. Датированные статусы и «следующие шаги» ниже — история; актуальная готовность — в [CURRENT_CONTEXT](CURRENT_CONTEXT.md), очередь работ — в [ROADMAP](ROADMAP.md).

# Редактирование карточки Pons — исследование 12.10.2026

Исходная точка платформы c50337a + текущие локальные изменения.
Источник: публичная страница QIANQI и её текущие JS chunks, GET API Pons.
Снимок, URL chunks, SHA-256 и дата: `.local/notes/pons-metadata-20261012/report.json`.
Исходные JSON/API и JS сохранены рядом. Никаких подписей и записей не выполнялось.

## Подтверждённый путь

QIANQI: `0x6ea39a23aa46e51ca6cd2d1cbc0b5bfb29ecb216`.
GET `https://www.ponsfamily.com/api/launches/<address>` возвращает deployer
`0x098afa6731239a00ce0aff669aaefd16b7c72114`, совпадающий с адресом владельца.
GET `/api/launches/<address>/details` ответил200, `{available:true,wallet:null}`.
Сохранение включено; wallet null означает отсутствие авторизованной сессии в запросе.

Официальная форма отправляет PUT `/api/launches/<address>/details` с полями:
description, twitter, telegram, discord, farcaster. Описание — до256 символов,
без ссылок; ссылки размещаются в социальных полях. Форма нормализует handles/URLs.
Website, logo, name и symbol в наблюдаемом запросе отсутствуют. Поддержка их
редактирования другим способом не установлена; придумывать параметры API нельзя.

Это изменение отображаемой карточки в хранилище Pons. По тексту самой формы
исходные данные контракта остаются прежними. Транзакция/газ для этого UI не нужны.

Вход: POST `/api/profile/nonce` с wallet и action `wallet-session`; кошелёк
подписывает сообщение `pons sign in` с origin, chain, wallet, nonce,
issuedAt/expiresAt; POST `/api/session` получает session cookie. Затем повторяется
PUT. Выполнять этот путь следует на официальном origin Pons и с просмотром
пользователем сообщения подписи. Приватный ключ для обхода формы не нужен.
Этот отчёт не утверждает успешность записи: authenticated PUT ещё не проверялся.

## Почему может прыгать фокус

В chunk-20 компонент диалога вызывает focus на первом input/textarea внутри effect
с зависимостями open/dismissible/onClose. В chunk-46 Edit details передаёт inline
onClose и обновляет state при каждом вводе. Изменение identity callback может
повторно запускать effect и возвращать фокус на description. Это вывод из исходников,
не воспроизведение в подключённом пользовательском кошельке.

## Текущие данные и предложение

Сейчас X и Telegram пустые; website указывает на https://qianqi.site.
Описание остаётся прежним (220 символов); полная копия в `launch.json` снимка.
Сохранён НЕОТПРАВЛЕННЫЙ черновик `proposed-details.NOT-SENT.json`:
оставить описание/Discord/Farcaster, добавить X https://x.com/ui_uallas
и Telegram https://t.me/qianqi_hub_bot. Это предложение для согласования полей,
не разрешение записать его и не опубликованные метаданные.

Сайт самого QIANQI теперь https://init.qianqi.site/, но поддерживаемого поля
для его изменения в этой форме/API не найдено. Требуется отдельное исследование
или запрос команде Pons. Исходный QIANQI/production платформы не менялись.

## Где сохранён сайт — проверка 12.10.2026

Снимок: `.local/notes/qianqi-website-20261012/`. В `onchain.json` сохранены
finalized-блок86588923, hash
`0x210c1369b4a7219d89f7e8f323ae74ce7d35e2fe546bec4faa9c467210f15419`,
результаты socials()/getTokenInfo(), runtime hash и декодированная транзакция запуска.

При выпуске в launchToken передано `params.socials.website = https://qianqi.site`.
Транзакция: `0x907be9938fd330402fcadad21bde8061476579210d7854716461573c81345ca8`,
блок79377860, фабрика `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`.
Текущий вызов socials() у самого токена возвращает тот же сайт. Логотип также
записан при создании: https://qianqi.site/assets/qianqi-logo.png.

Проверенный исходник PonsV2LauncherToken получен заново через
https://sourcify.dev/server/v2/contract/4663/0x6ea39a23aa46e51ca6cd2d1cbc0b5bfb29ecb216?fields=all
и сохранён как sourcify.json/verified-token.sol. Текущий runtime побайтно совпал
с onchainBytecode верифицированной записи. ProxyResolution: isProxy=false.
Конструктор сохраняет `_socials = socials_`; socials()/getTokenInfo() только читают.
Изменяющие функции ABI — approve, burn, burnFrom, transfer, transferFrom.
Setter метаданных/сайта, owner-admin или upgrade-путь в этой реализации отсутствуют.
Поэтому изменить исходный website вызовом владельца невозможно.

На текущей странице GeckoTerminal видны прежнее описание и ссылка qianqi.site:
https://www.geckoterminal.com/robinhood/pools/0x12ba58b5455fdbc15165e0e8b2096498d2c684f1
Это совпадает с исходными данными контракта и Pons, но конкретный источник
индексации GeckoTerminal этим исследованием не доказан. Нельзя обещать, что правка
off-chain карточки Pons автоматически обновит GeckoTerminal.
GeckoTerminal предоставляет отдельную Update Token Info форму:
https://www.geckoterminal.com/request-form/update-token . Заявка не отправлялась.

Владелец согласовал новое описание без соцсетей (193 символа), X и Telegram.
Обновлённый payload сохранён отдельно как `approved-details.NOT-SENT.json`
в новом снимке. Предыдущий черновик оставлен для истории. Подпись/сессия/PUT
по-прежнему не выполнялись. Для website нужен override на стороне Pons либо
отдельное обновление карточки GeckoTerminal; контракт остаётся неизменным.
