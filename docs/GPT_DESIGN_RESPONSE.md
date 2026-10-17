# Pattern Watcher — дизайн-компоновка и EN / 简体中文 UI-copy

**Дата:** 17.10.2026. **Основание:** [актуальный brief](GPT_REVIEW_BRIEF.md), `main@775f1948181916fbe219e759c6059583313b0bc4` (11:16 UTC / 14:16 МСК). Предлагаемая компоновка — **дизайн-спецификация, не реализованный интерфейс**. Смотрел код `apps/monitor/index.html`, `wallets.html`, `monitor.py`, `wallets.py` и связанные документы; не запускал локальный UI, browser fixtures, Pons, RPC, сервер, платежи, не видел `.local` скриншоты. Реальные пиксели и переносы ещё проверять в браузере.

**Решение в одну строку:** выбрать **вариант A — «Исследование в один поток»**: короткий общий header → состояние снимка → четыре показателя → один график → одна таблица токенов; кошельки — соседняя вкладка с поиском, компактной карточкой адреса и двумя последовательными таблицами. Полный смысл, 2 языка, минимум декоративности. Не делать терминал с отдельной «умной» боковой колонкой.

## 0. Неподвижные границы

- Рабочее имя **Pattern Watcher**, не окончательный бренд. UI только **English** либо **Simplified Chinese (简体中文)**, **один язык в один момент**. 简体中文 — рабочее допущение, регион/аудитория владельцем не утверждены. Не добавлять RU в публичный переключатель без отдельного решения.
- Монитор: первые 60 минут после запуска **Pons V2**, закрытые окна по 5 минут, 7 отображаемых окон; не live/instant. Обновление кнопкой **читает готовый снимок**, не запускает сбор.
- Кошельки: **ручное** чтение Pons, общий TTL кеша примерно 5 минут; монитор показывает **до 30 активных адресов текущего снимка**, не всевременной топ. Позиции Pons **не** полный портфель, баланс ETH недоступен (проверенный balances API возвращал 403). История — получаемый хвост, сохранено не более 5000 **сгруппированных** операций на адрес. Один сохранённый элемент может объединять несколько исходных строк одного вида / токена / tx.
- Нет PnL, доходности, «успешности кошелька», полного wallet age, детектора ботов, счёта «людей». Оценка `valueUsd` обозначается как приблизительная, не как точная сумма расчетного токена.
- Токен и ETH-подписка (24h / 7d / 30d), скидка держателям, Web Push/Telegram, связанный токен — направление **будущих пакетов**; UI оплаты/цены/маскота **сейчас не рисовать**.
- Основа визуального родства с [хабом](../apps/hub/site/index.html): тёмная нейтральная поверхность, спокойная типографика, светлый текст, тёплый акцент, тонкие границы. **Не переносить** hero-высоту, полноэкранную картинку, огромную типографику или маркетинговый призыв.

## 1. Два компактных варианта

| | **A — «Исследование в один поток» (рекомендую)** | **B — «Сводка + контекст»** |
|---|---|---|
| Desktop, токены | Общий header 64 px; 4 KPI в одну строку; один график на всю ширину; строка объёмов; полноширинная таблица | Слева 2/3: KPI, график и таблица; справа 1/3: выбранный интервал, объёмы/источники/пояснения |
| Desktop, кошельки | Та же навигация; поиск; identity + 4 KPI; позиции; действия с фильтрами | Слева список активных/избранных адресов, справа карточка/операции |
| Mobile | Все блоки в одной колонке; KPI 2×2; график 7 столбцов; таблица превращается в компактные записи | Правая/левая колонка превращается в отдельный блок **до** основного контента или в переключаемую панель |
| Плюс | Чёткая причинно-следственная цепочка `metric → time → rows → wallet`; минимальный риск двух параллельных контекстов | Удобно при постоянном переключении между адресами на большом мониторе |
| Минус | Длинная прокрутка подробностей (лечится сворачиванием вторичного) | Пожирает ширину таблицы, требует дублирования состояний и мобильной «спрятанной» панели |
| Вывод | **Выбрать как версию 1** | Оставить возможным будущим desktop-представлением, **не делать сейчас** |

У A есть принцип **одна выбранная пятиминутка + одна выбранная метрика**, и обе явно написаны над данными. В B появляется второй центр внимания, а в переводе на 390 px он в любом случае исчезает. Сейчас это неоправданная сложность.

### Визуальная система (рекомендуемые целевые токены, ещё не CSS)

| Элемент | Предложение |
|---|---|
| Общая ширина | Desktop max-width **1200 px**; при viewport 1440 → по **120 px** поля; в `390 px` → **16 px** поля и **358 px** контент |
| Фон/поверхность | `#111110` / `#1B1B19` (родство с хабом); border `#383832`; основной текст `#EDE9DD`; вторичный `#BDB9AF` |
| Единственный акцент | Тёплый `#DDB47C` — selected state, active nav, важные ссылки; не использовать зелёный как «прибыль/безопасно». Ошибка — нейтральная рамка + надпись, warning — янтарная надпись + значок, не только цвет |
| Типографика | UI `system-ui, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`; для адресов/цифр `ui-monospace` с доступным CJK fallback. Не скачивать и не распространять файлы шрифтов |
| Размеры | body **14 px / 1.45**; H1 **25–28 px** desktop, **22–24 px** mobile; section title **18 px**; KPI number **27–30 px**, mobile **25 px**; table primary **14 px**, metadata **12–13 px**; никогда 10px для смыслового текста |
| Пространство | 8 px сетка: gap 8/12/16/24; карточки 16–18 px padding; row table **58–66 px** desktop, мобильная запись **100–124 px** |
| Границы/состояния | Округление **8–10 px**, линии 1px; разделение секций вертикальным отступом 24–32 px. Selection: бордер + маркер/aria-pressed; partial: штрих + слово `Partial / 部分` |
| Motion | Только короткий hover/focus, уважать `prefers-reduced-motion`; **без** непрерывной пульсации/«срочности» |

Контраст `#BDB9AF` на `#111110` вероятно приемлем, но **финальные реальные пары** и выбранный accent в состояниях/outline проверить инструментом WCAG: обычный текст ≥4.5:1, крупный ≥3:1, фокус/границы управляющих элементов ≥3:1. Это критерий, не объявленная проведённая проверка.

## 2. Точные схемы для верстальщика

Это текстовые **wireframe-предложения**, размеры внутри зоны — целевые, а не измерения существующих HTML. Все числа в примерах ниже — **фиктивные макетные значения**, не фактический рынок.

### A1. Tokens / Desktop 1440 × условно 900, scroll page

Контейнер: `x=120..1320`, ширина 1200. Верхняя часть доступна до первого скролла на 900 px; таблица начинается ближе к нижнему краю первого экрана.

```text
┌────────────────────── viewport 1440 ───────────────────────────┐
│ 120px margin    container 1200px                     120px margin
│ ┌────────────────────────────────────────────────────────────┐
│ │ HEADER 64h: [PW □] Pattern Watcher  [Tokens] [Wallets]     │
│ │                                       [EN ▾] [From hub ↗]  │
│ ├────────────────────────────────────────────────────────────┤
│ │ TITLE/STATUS 84h                                          │
│ │ First hour on Pons                  [Read saved snapshot]   │
│ │ 10:20–10:25 · your time · Snapshot 10:27 · Complete        │
│ ├────────────────────────────────────────────────────────────┤
│ │ KPI ROW 106h; four 282px cards, gap 24px                   │
│ │ [Buyers 125 ↑ +14] [Buys 240 ↑ +35] [Tokens 17] [Launches 8]│
│ ├────────────────────────────────────────────────────────────┤
│ │ CHART HEAD 44h: Buyers · seven 5-min windows  [ⓘ Definition]│
│ │ CHART 208h:   ▂    ▃    ▆    █    ▄    ▆    ▅              │
│ │               09:50 … selected 10:15–10:20 … 10:20       │
│ │ [Selected: 10:15–10:20]              [Back to latest]      │
│ ├────────────────────────────────────────────────────────────┤
│ │ QUOTE VOLUMES 64h: [USDG 1,240]   [ETH 0.03571]           │
│ ├────────────────────────────────────────────────────────────┤
│ │ TOKENS / TABLE-TOOLS 72h                                  │
│ │ First hour · 12 shown  [5 min | Since launch] [Sort ▾]   │
│ │ visible note: addresses, not people; Pons V2 curve BUY    │
│ ├────────────────────────────────────────────────────────────┤
│ │ TABLE: Token/age/link | Buyer addr | Buys | Volume | Max  │
│ │ token A · 12m · Pons/X | 15 · +9 new | 64 | 200 USDG | 47  │
│ │ token B · 26m · Pons/X |  2 · +1 new | 34 | 0.025 ETH| .012│
│ │             extra: buys/address, top 3%, median in subline│
│ │ … 58–66px per row; no independent opaque subpanel         │
│ ├────────────────────────────────────────────────────────────┤
│ │ [About data & coverage ▾] [Comparison for latest ▾]       │
│ │ FOOTER links to Pons, hub; no marketing banner            │
│ └────────────────────────────────────────────────────────────┘
└────────────────────────────────────────────────────────────────┘
```

Размеры: header 64; вертикальные промежутки **16–24**; KPI 106; chart 208; объёмы 64; таблица min-width ≈1100 и no-scroll desktop. **Не писать «Live»**; data-state рядом с временем окна. Исторический выбор показывает pinned time рядом с `Back to latest`, не скрывает статус partial. Если текущее значение недоступно, в карточке `—`, не `0`; delta только между двумя **полными** соседними окнами. Список при метрике `Launches` должен содержать новые токены **без покупок** с честными нулями.

**Столбец/строка:** click KPI → меняет **только** серию одного графика; click chart bar → меняет общую `selectedEnd`, КПИ/объёмы/таблицу; click bar из прошлого → всегда видна кнопка `Back to latest`; click `5 min / Since launch` → только диапазон строк выбранной таблицы, выбранный bar остаётся; click sort → только сортировка; click token row (если интерактивна) → раскрыть **уже имеющиеся** max/median/top3/tx и ссылки, **не** открывать несуществующую token-detail page; click `Pons` / `X` / `tx` → внешняя страница с явным external indicator. Нативные ссылки/кнопки внутри строки независимы; не вешать click на всю строку с вложенными интерактивными controls.

### A2. Wallets / Desktop 1440

```text
┌──────────────────────────── width 1200 ────────────────────────┐
│ HEADER 64h: [PW □] Pattern Watcher [Tokens] [Wallets*] [EN ▾] │
├────────────────────────────────────────────────────────────────┤
│ Wallet activity / Search 82h                                  │
│ [0x wallet address ................................] [View]    │
│ [Saved addresses ▾]  [Active in selected monitor snapshot ▾]  │
│ helper: up to 30 recent BUY addresses, not a performance rank │
├────────────────────────────────────────────────────────────────┤
│ IDENTITY 88h                                                  │
│ 0x12ab…09cd  [Copy full address] [Open on Pons ↗] [☆ Save]    │
│ First seen by us: 16 Oct ...                                  │
│ Earliest available operation: 15 Oct ...                      │
│ Visible: Saved history is partial; address ≠ person           │
├────────────────────────────────────────────────────────────────┤
│ COUNTERS 100h: [Buys 25] [Sells 12] [Traded tokens 8] [Saved operations 39]│
│  one-line meaning: grouped saved operations, not all-time tx  │
├────────────────────────────────────────────────────────────────┤
│ PONS POSITIONS 150h                                           │
│ Visible: Pons-reported positions only. Not full wallet/ETH.   │
│ Token                 Pons token amount      Est. USD          │
│ A                     1,200.00              ≈ $143           │
├────────────────────────────────────────────────────────────────┤
│ SAVED ACTIVITY                                               │
│ [All | Buys | Sells | Other] [Token ▾] [Show 100 more]       │
│ Visible: History may have gaps; fetched 10:25 / cached 5 min  │
│ Time  | Action | Token | Amount | Est. USD | Transaction ↗    │
│ …                                                              │
│ [My note ▾]  [About wallet data ▾]                             │
└────────────────────────────────────────────────────────────────┘
```

Принципиально **позиции идут отдельной таблицей**, а не как «полный баланс» внутри KPI. Условное `39` «Saved operations» — количество **сохранённых агрегированных записей**, не count chain events. `First seen by us` и `Earliest available operation` две самостоятельные даты **над KPI**, чтобы их не спрятать. До загрузки карточки адреса: только search и свёрнутые saved/active chips; пустая подробная панель не занимает 500 px.

### A3. Tokens / Mobile 390 × scroll (content 358)

На телефоне **не превращать таблицу из пяти колонок в 900px горизонтальный скролл как единственный способ читать данные**. Рендерить те же rows как короткие вертикальные записи; это responsive presentation, не новый продукт.

```text
┌──────────────────── 390px ─────────────────────┐
│ 16  ┌────────────── 358px ──────────────────┐ 16│
│     │ [PW□] Pattern Watcher       [EN ▾]    │   │ 52h
│     │ [Tokens*]   [Wallets]     [Hub ↗]     │   │ 44h
│     │ First hour on Pons                    │   │ 56h
│     │ 10:20–10:25 (local) · Complete        │   │
│     │ Saved 10:27 · [Read snapshot]         │   │ 44h
│     ├───────────────────────────────────────┤   │
│     │ [Buyers 125]   [Buys 240]              │   │ 2×2, 92h each
│     │ [+14 vs prev]   [+35 vs prev]          │   │
│     │ [Tokens 17]    [Launches 8]           │   │
│     ├───────────────────────────────────────┤   │
│     │ Buyers · every 5 minutes              │   │ 32h
│     │  ▂  ▃  ▆  █  ▄  ▆  ▅                 │   │ 132h
│     │ time labels: first / selected / last  │   │
│     │ Selected: 10:15–10:20  [Latest ↶]     │   │ 48h
│     │ USDG 1,240    ETH 0.03571              │   │ 58h
│     ├───────────────────────────────────────┤   │
│     │ First-hour tokens (12)                │   │ 40h
│     │ [5 min | Since launch] [Sort ▾]      │   │ 44h
│     │ ┌───────────────────────────────────┐ │   │
│     │ │ TOKEN A · 12 min     [Pons ↗][X ↗]│ │   │
│     │ │ 15 buyer addresses · 64 buys      │ │   │ ~116h
│     │ │ 200 USDG · +9 first at token      │ │   │
│     │ │ [More metrics ▾]                  │ │   │
│     │ └───────────────────────────────────┘ │   │
│     │ [next token …]                        │   │
│     │ [About data & coverage ▾]            │   │
│     └───────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

Высоты header+nav ≈96, data banner ≈100, KPI ≈192, chart+selector ≈220, volumes 58. Внутри 358px токен `symbol` не раздвигает контейнер: ограничить 1–2 строки и ellipsis (полный name доступен в accessible label/раскрытии). Возраст, окно, quote единица доступны и без раскрытия. Для графика 7 узких столбцов — min target **44×44 px** по всей области bar (tap box, не только закрашенная вертикаль); подписать только выбранный и крайние times, полное время — в `aria-label` и текстовой `Selected` строке. Если столбцы физически не дают семь целей 44 px (7×44=308 + gaps) — уменьшить gaps до 2–3 px и использовать 358px на все 7, **не** делать крошечные невидимые hit-targets.

### A4. Wallets / Mobile 390

```text
┌──────────────────── 390px ─────────────────────┐
│ [PW□] [Tokens] [Wallets*] [中文 ▾]             │ 96h
│ Wallet activity                               │ 42h
│ [ 0x address …                           ]    │ 48h
│ [View wallet]                                 │ 44h
│ [Saved addresses ▾]                           │
│ [Active addresses (≤30) ▾]                    │
│ 0x12ab…09cd [Copy] [Pons ↗] [☆]               │ 80h
│ First seen by us: 16 Oct …                    │
│ Earliest available: 15 Oct …                  │
│ [Partial history · may have gaps]             │ 44h
│ [Buys 25]       [Sells 12]                    │
│ [Tokens 8]     [Saved operations 39]          │ 2×2
│ Pons-reported positions                       │
│ Not a full wallet balance or ETH balance      │ visible
│ [A    1,200 tokens    ≈ $143]                 │ stacked
│ Saved activity                                │
│ [Action ▾] [Token ▾]                          │
│ [10:21 · BUY · TOKEN A]                        │
│ [1,200 tokens · ≈ $143 · Tx ↗]                │
│ [Show 100 more]                               │
│ [My note ▾]  [About data ▾]                  │
└────────────────────────────────────────────────┘
```

Каждая запись истории на mobile — **два ряда**, в 1-м time/type/token, во 2-м количество/**Est. USD**/tx; без таблицы шириной 600px. Для длинных адресов: показывать `0x1234…cdef`, по copy копировать **полный** адрес (помощь, не делать `0x…` самостоятельным идентификатором), Pons link на карточке; input видит полный ввод и допускает горизонтальную прокрутку содержимого. `Saved addresses` и `Active addresses` — раскрытия, не вечный сайдбар на 390px. Если профиль ещё не открыт, счётчики/позиции/лента отсутствуют, а не показывают фиктивные нули.

### Строгая карта взаимодействий

| Пользователь делает | Ожидаемое действие | Не делать |
|---|---|---|
| Нажимает **Buyers / Buys / Active tokens / Launches** | Выбирает одну серию графика; выбранная KPI получает рамку/aria-pressed; при `Launches` таблица включает новые токены с 0 BUY | Не меняет выбранное окно молча, не отправляет сетевой запрос |
| Нажимает столбец | Выбирает `selectedEnd`; KPI/объём/таблица описывают этот интервал; над ними текст `Viewing 10:15–10:20` | Не выдавать его за последний |
| Нажимает `Latest` | Возвращает последний сохранённый закрытый интервал, сохраняя KPI и сортировку | Не вызывает Pons сбор |
| Выбирает 5 min / Since launch | Меняет период token rows от запуска до конца выбранного окна; график/selected time фиксированы | Не расширяет окно токена за 60 минут |
| Нажимает token row | **Предлагаемое** inline-раскрытие уже имеющихся max/median/top-3/buys/address, не новый маршрут; Pons/X/tx — отдельные ссылки | Не открывать `wallets` «по токену», если такого фильтра пока нет |
| Переходит `Tokens ↔ Wallets` | 2 явные nav вкладки; на Wallets показать поиск и active≤30 chips, адрес выбирается через chip или ввод | Не выдавать список active за глобальный рейтинг |
| Выбирает активный/избранный address chip | Подставляет **полный** адрес в поиск и запускает **один** текущий ручной wallet load с общим кешем | Не запускать ежесекундный polling |
| Нажимает адрес в карточке | `Copy` — полный адрес, `Open on Pons` — внешний профиль; возможность клика по самому адресу с фокусом и копированием — лишь удобство | Не вести на выдуманный «полный портфель» |
| Выбирает kind/token в истории | Локально фильтрует **сохранённые** grouped events; `Show 100 more` догружает следующую порцию из уже полученного snapshot | Не обещать полноценную remote пагинацию / полноту всей сети |
| Раскрывает `My note` | Редактирует заметку текущего адреса, сохраняющуюся **только в этом браузере** | Не обещать синхронизацию |

## 3. Copy deck: стабильные ключи EN / 简体中文

Таблицы ниже — **предлагаемые тексты для локализации**. Ключи `pw.*` — стабильный namespace новой UI-copy, не утверждение о существующих локализационных ключах. При внедрении: один словарь и один `lang` на страницу; ключи не зависят от метрики; значения/адреса/время — placeholders, не содержимое словаря.

### A. Навигация, заголовки, время, действия

| Key | English | 简体中文 |
|---|---|---|
| `pw.brand` | Pattern Watcher | Pattern Watcher |
| `pw.nav.tokens` | Tokens | 代币 |
| `pw.nav.wallets` | Wallets | 钱包 |
| `pw.nav.hub` | Project hub | 项目主页 |
| `pw.nav.language` | Language | 语言 |
| `pw.nav.english` | English | English |
| `pw.nav.chinese` | Simplified Chinese | 简体中文 |
| `pw.tokens.title` | First hour on Pons | Pons 代币上线首小时 |
| `pw.tokens.subtitle` | Curve buys during each token's first 60 minutes. | 仅统计各代币上线后 60 分钟内的曲线买入。 |
| `pw.tokens.window` | 5-minute window: {start}–{end} | 五分钟区间：{start}–{end} |
| `pw.tokens.windowLatest` | Latest completed window | 最近已结束的区间 |
| `pw.tokens.windowHistoric` | Viewing an earlier window | 正在查看历史区间 |
| `pw.tokens.lastSaved` | Snapshot saved {time} | 快照保存于 {time} |
| `pw.tokens.readSnapshot` | Read saved snapshot | 读取已保存快照 |
| `pw.tokens.latest` | Back to latest | 返回最近区间 |
| `pw.tokens.chartHint` | Select a 5-minute window | 选择一个五分钟区间 |
| `pw.tokens.chartTitle` | {metric} by 5-minute window | {metric}（每五分钟） |
| `pw.tokens.volumeTitle` | Buy volume by asset | 按资产划分的买入额 |
| `pw.tokens.tableTitle` | First-hour tokens | 首小时代币 |
| `pw.tokens.tableCount` | {count} tokens shown | 显示 {count} 个代币 |
| `pw.tokens.period5` | In selected 5 minutes | 所选五分钟内 |
| `pw.tokens.periodLife` | Since launch (up to 60 min) | 上线以来（最多 60 分钟） |
| `pw.tokens.sort` | Sort by | 排序方式 |
| `pw.tokens.sortBuyers` | Buyer addresses | 买入地址数 |
| `pw.tokens.sortBuys` | Buys | 买入笔数 |
| `pw.tokens.sortNew` | Newest launches | 最新上线 |
| `pw.tokens.moreMetrics` | More metrics | 更多指标 |
| `pw.tokens.lessMetrics` | Fewer metrics | 收起指标 |
| `pw.link.pons` | View on Pons | 在 Pons 查看 |
| `pw.link.x` | Open X | 打开 X |
| `pw.link.tx` | View transaction | 查看交易 |
| `pw.link.external` | Opens another site | 将打开外部网站 |

### B. Четыре KPI, таблица и определения

| Key | English | 简体中文 |
|---|---|---|
| `pw.metric.buyers` | Buyer addresses | 买入地址数 |
| `pw.metric.buys` | Buys | 买入笔数 |
| `pw.metric.activeTokens` | Tokens with buys | 有买入的代币 |
| `pw.metric.launches` | Launches | 新上线代币 |
| `pw.metric.delta` | {change} vs previous 5 min | 较前五分钟 {change} |
| `pw.metric.noDelta` | Previous full window unavailable | 上一个完整区间不可用 |
| `pw.metric.buysPerAddress` | Buys per address | 每个地址的买入笔数 |
| `pw.metric.firstAtToken` | First-time buyers of this token: {count} | 首次买入该代币的地址：{count} |
| `pw.metric.volume` | Buy volume | 买入额 |
| `pw.metric.top3` | Top 3 buyers: {percent}% of volume | 前三大买入地址占交易额 {percent}% |
| `pw.metric.maxBuy` | Largest single buy | 最大单笔买入 |
| `pw.metric.medianBuy` | Median buy | 买入额中位数 |
| `pw.metric.tokenAge` | {minutes} min since launch | 上线 {minutes} 分钟 |
| `pw.metric.quoteAsset` | Quoted in {asset} | 计价资产：{asset} |
| `pw.metric.walletsNotPeople` | Addresses are not people. One address counts once per window. | 地址不等于人数。每个地址在每个区间只计一次。 |
| `pw.help.activeTokens` | Distinct tokens with at least one observed buy in this window. | 本区间至少有一笔已观测买入的不同代币数。 |
| `pw.help.launches` | New Pons V2 launches in this window, including zero-buy tokens. | 本区间上线的 Pons V2 代币，包括没有买入的代币。 |
| `pw.help.firstAtToken` | First observed buy by this address for this token in the available first-hour history. | 在可用的首小时历史中，该地址首次买入此代币。 |
| `pw.help.top3` | Share of buy volume from the three highest-volume buyer addresses. | 按买入额排名前三的地址占总买入额的比例。 |
| `pw.help.median` | Middle buy amount; not an average or a price. | 单笔买入额的中位数，不是平均值或价格。 |
| `pw.help.quote` | Amounts are shown in their quote asset; ETH and USDG are not added together. | 金额按原计价资产显示；ETH 与 USDG 不合并。 |
| `pw.tokens.launchZero` | No buys observed in this window | 本区间未观测到买入 |
| `pw.tokens.noActive` | No tokens with observed buys in this window. | 本区间没有观测到买入的代币。 |

### C. Страница кошелька, счетчики, фильтры, адреса

| Key | English | 简体中文 |
|---|---|---|
| `pw.wallet.title` | Wallet activity | 钱包活动 |
| `pw.wallet.subtitle` | Saved Pons observations. No automatic wallet polling. | 已保存的 Pons 观测数据；钱包不自动轮询。 |
| `pw.wallet.addressLabel` | Wallet address | 钱包地址 |
| `pw.wallet.addressPlaceholder` | Enter a 0x wallet address | 输入 0x 开头的钱包地址 |
| `pw.wallet.view` | View wallet | 查看钱包 |
| `pw.wallet.refresh` | Refresh wallet snapshot | 更新钱包快照 |
| `pw.wallet.saved` | Saved addresses | 已收藏地址 |
| `pw.wallet.active` | Active addresses in this snapshot | 本次快照中的活跃地址 |
| `pw.wallet.activeLimit` | Up to 30 addresses from recent first-hour token buys. Not a performance ranking. | 最多显示 30 个近期首小时买入地址；不是收益排名。 |
| `pw.wallet.copy` | Copy full address | 复制完整地址 |
| `pw.wallet.copied` | Address copied | 地址已复制 |
| `pw.wallet.openPons` | Open Pons profile | 打开 Pons 个人页面 |
| `pw.wallet.firstSeen` | First observed by us: {date} | 我们首次观测到：{date} |
| `pw.wallet.earliestTrade` | Earliest available operation: {date} | 最早可用操作：{date} |
| `pw.wallet.dateWarning` | Neither date is the wallet creation date. | 以上日期都不是钱包创建日期。 |
| `pw.wallet.buys` | Saved buys | 已保存买入 |
| `pw.wallet.sells` | Saved sells | 已保存卖出 |
| `pw.wallet.tokens` | Traded tokens | 交易过的代币 |
| `pw.wallet.operations` | Saved operations | 已保存操作 |
| `pw.wallet.groupNote` | Counts use saved groups of actions, not all on-chain events. | 统计基于已保存的合并操作，不代表全部链上事件。 |
| `pw.wallet.positionsTitle` | Pons-reported positions | Pons 提供的持仓 |
| `pw.wallet.positionsWarning` | Not a complete wallet portfolio or ETH balance. | 不是完整钱包资产，也不包括完整 ETH 余额。 |
| `pw.wallet.positionsUpdated` | Positions checked {date} | 持仓查询于 {date} |
| `pw.wallet.tokenAmount` | Token amount from Pons | Pons 显示的代币数量 |
| `pw.wallet.usdEstimate` | Est. USD value | 估算美元价值 |
| `pw.wallet.usdHelp` | Source estimate; not an exact settlement amount or profit. | 来源提供的估值，不是精确结算额，也不代表利润。 |
| `pw.wallet.activityTitle` | Saved activity | 已保存的操作记录 |
| `pw.wallet.activityUpdated` | History checked {date} | 历史记录查询于 {date} |
| `pw.wallet.filterAction` | Action | 操作类型 |
| `pw.wallet.filterToken` | Token | 代币 |
| `pw.wallet.filterAll` | All | 全部 |
| `pw.wallet.filterBuys` | Buys | 买入 |
| `pw.wallet.filterSells` | Sells | 卖出 |
| `pw.wallet.filterOther` | Transfers & other | 转账及其他 |
| `pw.wallet.actionBuy` | Buy | 买入 |
| `pw.wallet.actionSell` | Sell | 卖出 |
| `pw.wallet.actionSend` | Send | 转出 |
| `pw.wallet.actionReceive` | Receive | 转入 |
| `pw.wallet.actionDeposit` | Deposit | 存入 |
| `pw.wallet.actionWithdraw` | Withdraw | 提取 |
| `pw.wallet.amount` | Token amount | 代币数量 |
| `pw.wallet.time` | Time | 时间 |
| `pw.wallet.more` | Show 100 more | 再显示 100 条 |
| `pw.wallet.favoriteAdd` | Save address | 收藏地址 |
| `pw.wallet.favoriteRemove` | Remove saved address | 取消收藏 |
| `pw.wallet.note` | My note | 我的备注 |
| `pw.wallet.notePrivacy` | Saved only in this browser. | 仅保存在此浏览器中。 |
| `pw.wallet.historyWarning` | History is partial and may have gaps. Counts are not lifetime totals. | 历史记录可能不完整或有缺口；统计不是全生命周期总数。 |
| `pw.wallet.groupedHelp` | Same-type actions for one token within one transaction may be grouped and summed. | 同一笔交易中相同代币、相同类型的操作可能合并并汇总金额。 |
| `pw.wallet.dataHelp` | About wallet data | 关于钱包数据 |

### D. Состояния, дата, качество, пустота

| Key | English | 简体中文 |
|---|---|---|
| `pw.state.complete` | Complete for the available Pons pages | 已读取 Pons 当前可用的全部分页 |
| `pw.state.partial` | Partial data. Some pages or tokens were not collected. | 数据不完整，部分分页或代币未采集。 |
| `pw.state.stale` | Saved snapshot is old. Check its time before comparing. | 已保存快照可能过时；比较前请查看时间。 |
| `pw.state.loading` | Loading saved snapshot… | 正在读取已保存快照… |
| `pw.state.collecting` | Background collection in progress. Showing last saved snapshot. | 后台正在采集；当前显示上次保存的快照。 |
| `pw.state.cached` | Cached wallet snapshot (less than 5 min old) | 钱包缓存快照（不足五分钟） |
| `pw.state.readOnly` | This button reads stored data; it does not start a new Pons collection. | 此按钮仅读取已保存数据，不会启动新的 Pons 采集。 |
| `pw.state.error` | Latest collection failed. Earlier saved data may still be available. | 最近一次采集失败；仍可查看此前保存的数据。 |
| `pw.state.sourceUnavailable` | {source} is unavailable. Other saved sections remain visible with their timestamps. | {source} 暂不可用；其他已保存内容仍显示各自的时间。 |
| `pw.state.longWait` | This wallet is taking longer than expected. You can keep browsing or try again later. | 钱包数据获取时间较长。您可以继续浏览，或稍后重试。 |
| `pw.state.walletError` | Wallet snapshot unavailable. Try again later. | 暂时无法获取钱包快照，请稍后重试。 |
| `pw.state.emptyMarket` | No observed buys in this window. This does not cover missing data. | 本区间未观测到买入；不代表缺失数据为零。 |
| `pw.state.emptyWallet` | No saved operations match these filters. | 没有符合筛选条件的已保存操作。 |
| `pw.state.emptyPositions` | No positive positions in the available Pons response. | Pons 当前可用响应中没有正数持仓。 |
| `pw.state.noPositions` | Position data not available. | 持仓数据不可用。 |
| `pw.state.noSnapshot` | No saved snapshot yet. | 尚无已保存快照。 |
| `pw.state.notAvailable` | Not available | 暂不可用 |
| `pw.state.unknown` | Not established | 尚未确认 |
| `pw.state.noComparison` | Not enough complete history to compare. | 完整历史数据不足，无法比较。 |
| `pw.state.coverage` | {complete} of {expected} windows complete; {partial} partial, {missing} missing. | 共 {expected} 个区间，完整 {complete} 个、部分 {partial} 个、缺失 {missing} 个。 |
| `pw.state.savedAt` | Saved at {time} | 保存于 {time} |
| `pw.state.checkedAt` | Source checked {time} | 来源查询于 {time} |
| `pw.state.lastWindowComparison` | Comparison for the latest window ({time}, MSK) | 最近区间的对比（{time}，莫斯科时间） |
| `pw.state.mskHint` | Calendar comparisons use Moscow time (MSK). Display times use your device time zone. | 日历比较使用莫斯科时间（MSK）；显示时间使用设备时区。 |
| `pw.state.gaps` | Gaps & collection attempts | 缺口与采集记录 |
| `pw.state.about` | About data & coverage | 关于数据与覆盖范围 |
| `pw.state.sampleLimits` | Completeness means Pons pages were read, not independent on-chain verification. | “完整”表示已读取 Pons 分页，并非独立链上验证。 |
| `pw.state.zeroHelp` | 0 = observed zero; — = unavailable; Partial = incomplete coverage. | 0 表示观测为零；— 表示数据不可用；“部分”表示覆盖不完整。 |

**Нормализация терминов для обоих экранов.** `Buyer addresses` / `买入地址数` — не `users/用户数`. `Traded tokens` — **число разных токенов с сохранёнными BUY/SELL**, не «portfolio assets». `Saved operations` — число локально сохранённых **групп** действий, не lifetime transactions. `Pons-reported positions` — источник и граница видны в заголовке; `Est. USD` предваряется знаком `≈` в числовой ячейке. `Complete` — **только покрытие доступных страниц Pons**, без обещания консенсуса/отсутствия поздней правки.

### Где показывать определения (не только hover)

| Неоднозначное | Где **всегда видно** | Где подробнее по активации |
|---|---|---|
| Buyer addresses ≠ people | Одна строка сразу под KPI/графиком, или рядом с heading, **в mobile тоже** | `ⓘ` на Buyer KPI: `pw.metric.walletsNotPeople` |
| 5-мин окно / первые 60 минут | Под title и прямо над chart / table | `About data` |
| ETH / USDG раздельны | На каждом amount **единица**; два объёмных mini-items | `pw.help.quote` под `About data` |
| First-time buyer | В token row вторичной строкой `+N first at token` | `ⓘ` раскрывает `pw.help.firstAtToken`, если покрытие неполное → `—` |
| Top-3/median | Вторичная строка или раскрытие metric внутри token row | `ⓘ` доступен также кнопкой с клавиатуры/tap |
| Позиции ≠ баланс | Постоянный однострочный warning **сразу под `Pons-reported positions`** | `About wallet data` |
| Сгруппированные действия ≠ all-time | Строка **над четырьмя wallet KPI**, `Saved operations` вместо просто `Operations` | `pw.wallet.groupedHelp` рядом с таблицей |
| First seen ≠ creation | Обе даты + короткое `Neither date is the wallet creation date` | `About wallet data` |
| Est. USD ≠ exact | `≈ $...` + `Est. USD` в column header | `pw.wallet.usdHelp` рядом с header |
| Недоступно ≠ ноль | `0` только при полном подтверждённом пустом наборе; `—` + `Not available` при unknown; `Partial` рядом с числами | `About data`, в status видимый текст |

### Числа, даты, китайский язык — правила внедрения

1. В одном экране **один язык**, переключатель `EN | 简体中文` в header; сохранить выбор в клиенте, но fallback EN если перевод отсутствует. При первом входе можно учитывать `navigator.language` (предложение), **не** выбирать «регион» по адресу кошелька.
2. CJK: разрешить расширение заголовков на две строки, не увеличивая число колонок; не использовать forced uppercase/letter-spacing на 汉字; `font-family` из таблицы выше и системный CJK fallback. Дать больше вертикального воздуха китайскому тексту 14 px / 1.5, проверить Simplified Chinese glyph coverage на Windows/macOS/Android/iOS.
3. Числа форматировать локально: `en-US` и `zh-CN` через `Intl.NumberFormat`/без потери значимости для raw amounts; пример обе локали часто используют `1,234.56`, **не** предполагать что китайский всегда использует знак `¥`. Точные Pons quote amounts **в ETH и USDG** не переводить в USD; ETH адаптивно 5–8 значащих цифр, USDG по корректной точности API; показывать `<0.01` только если известны единица и правила округления, лучше `0.000005 USDG` для реального ненулевого.
4. `≈ $123.45` и `Est. USD` только у wallet `valueUsd`; не подписывать оценку как `USDG` или exact wallet balance. Отсутствующая `valueUsd` → `—`, не `≈ $0`.
5. Время по `Intl.DateTimeFormat(locale, {timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,…})` с явной подписью `local time/本地时间`; при клике на исторический столбец доступен полный день и дата. **Только исторические календарные сравнения** фиксированы по `Europe/Moscow`/`MSK`: явно указывать это в заголовке сравнения и не подменять timezone устройства.
6. Полный адрес в underlying `title/aria-label`, видимо `0x123456…cdef`, copy кнопкой; транзакция видима `Tx ↗` со словесным доступным именем (напр. `View transaction 0x…`), без сокращения фактического destination URL.
7. Плейсхолдеры `{count}`, `{start}`, `{end}`, `{asset}`, `{time}` — внешние динамические значения. Для plural в EN не склеивать `{count} + " buys"` вслепую; использовать выбранный formatter `Intl.PluralRules`, в zh единицы сохранять понятными.

## 4. Состояния без расклейки больших баннеров

| State / сценарий | Верхняя строка (видна без раскрытия) | Данные и действие |
|---|---|---|
| **Current complete** | `Complete · 10:20–10:25 local · saved 10:27` | Нормальная таблица, выбранное окно, delta только от полного previous |
| **Historical selection** | `Viewing 10:05–10:10 · Earlier window` + `Back to latest` | KPI/rows/volumes привязаны **к этому** окну; сравнение прошлого дня, если показывается, помечено `latest` |
| **Partial** | `Partial · 2 tokens not fully collected` (или общая `Partial`, если нет count) | Показать известные числа с пометкой `partial`; не показывать `0` за unknown, убрать сравнения и рост, не скрывать старые данные |
| **Stale** | `Saved snapshot is old · saved 10:02` | Весь экран можно читать, но заметное `stale` возле времени; `Read saved snapshot` не обещает нового сбора |
| **Empty market** | `Complete · No observed buys in this window` | KPI buys/buyers `0`; при выбранном `Launches` строка запусков **с 0**, при обычном buyers — понятное empty-state, не ошибка |
| **Wallet not opened** | `Enter a wallet address` | Только search, active ≤30 и saved chips; **не** выводить нули wallet KPI |
| **Wallet no saved operations** | `No saved operations match these filters` | `0` только если есть успешно прочитанная история и фильтр пуст; если history unavailable — `—`/источник недоступен |
| **One wallet source unavailable** | `Pons positions unavailable; saved activity last checked {time}` | Сохранить рабочую секцию истории с её собственным timestamp; позиции пометить `—`, не «0 holdings» |
| **One monitor source unavailable** | `Latest collection failed; showing saved snapshot from {time}` | Исторические данные в read-only режиме; качество и age остаются видимы, сравнение выключено |
| **Long wallet response (до текущего клиента timeout 40s)** | Через 3–5 сек `Taking longer than expected…` | Кнопка disabled пока load busy; сохранить поиск/навигацию; после timeout — ошибка с `Try again later`, не скрывать ранее сохранённое без пояснения |
| **Cached wallet ≤5 min** | `Cached snapshot · checked {time}` | Не заявлять, что ручное нажатие перезагрузило Pons; можно использовать `Refresh` после TTL; `last observed` остаётся исходным |
| **Reading local cache** | `Loading saved snapshot…` → `Snapshot saved {time}` | Скелетон или status min-height, без перемигивания и новых Pons-запросов |

Единая компактная **status rail** высотой около 28–48 px с текстом + иконкой, под заголовком каждого экрана. `partial/error/stale/cached` не должны окрашивать весь экран и не должны растворяться только в футере. `Error` не уничтожает старое `Complete`: одновременно показывать `last saved 10:10` и `latest attempt failed 10:15`; **источник и время** каждой секции собственные.

## 5. Проверяемые критерии качества и порядок реализации

### Acceptance / QA

1. **1440 desktop и 390 mobile** (дополнительно 320, 768): нет горизонтального скролла всей страницы; токен/кошелёк/транзакция читаются без клика в неизвестное место; focus visible на графике, активном nav, ссылках, табах, длинных адресах, details.
2. **Клавиатура:** Tab идёт header → KPI → bars → back-to-latest → table/filter → методика; Space/Enter работают на карточках и столбцах; selected имеет `aria-pressed`, aria-label содержит metric/значение/интервал/partial. `details` и tooltips доступны кнопкой, не только hover. `prefers-reduced-motion` учитывается.
3. **Китайский:** EN и 简体中文 на одном и том же 390px fixture не создают обрезанных CTA/невидимых единиц/наложений; нет одновременно EN и zh около каждого числа; переключение языка не сбрасывает выбранный bar/filter/address.
4. **Смысл данных:** 0/—/partial различаются; ETH/USDG не суммируются; `Est. USD` никогда не выводится как точная сумма; buyer addresses не становятся users; wallet firstObservedAt не становится creation date; positions≠portfolio; grouped actions≠all chain activity.
5. **Состояния:** fixture на complete/historical/partial/stale/empty; wallet no operations/history fail/positions fail/cached/timeout. Сломавшийся `/api/wallet` не должен делать пустыми всё ещё валидные сохранённые данные без пометки.
6. **Сеть и интерфейс:** `Read saved snapshot` не инициирует POST/опрос Pons; смена KPI/выбор bar/sort/filter — локальная; wallet fetch выполняется только при намеренном открытии адреса (с сохранением TTL); не появляется новый dependency/SDK ради таблицы.
7. **Контраст и responsive:** ≥4.5:1 текст, ≥3:1 элементы/focus; не только цвет для partial/selected/error; min touch target около 44×44; no horizontal scroll at 390 кроме специально обозначенного таблицей альтернативного режима, который здесь не рекомендуем.

### Три малых пакета в правильном порядке

1. **Пакет «общий каркас + токены».** Вынести nav и locale-copy, применить A1/A3 к существующему `index.html`, сделать компактную status rail, ясный selected window и правильную mobile-токен запись. Проверить в текущем `tests/studio/pons-monitor.mjs` **только на fixtures**, без Pons/QuickNode. Не менять сборщик/финансы.
2. **Пакет «кошелёк».** A2/A4: поиск, активные адреса ≤30, identity две даты, 4 KPI, позиции с явным warning, фильтруемая лента, local note. Проверить существующими `tests/studio/monitor-wallets.mjs` и синтетическими неполными источниками. Сохранить текущий cache 5 min и localStorage без утечки.
3. **Пакет «шлифовка локалей/доступности».** Реальное текущее EN+zh copy со состояниями; MSK vs device dates, ETH/USDG/Est. USD, keyboard/focus/mobile 320/390/768/1440, longer Chinese strings. Visual diff и ручная проверка на реальном браузере **из fixture**, затем только отдельное решение владельца о публикации нового UI.

## 6. Эмблема/бренд и отложенное

Резерв **28–32 px квадрат** слева от `Pattern Watcher` в header (mobile 24–28); допустима простая `PW` текстовая заглушка, не генерировать маскота сейчас. Никаких иных крупных арт-областей. Смысловой акцент остаётся у данных, а не у персонажа.

**Отложить до согласования**: иллюстрации/маскот, сложную карту связей адресов, другую навигационную архитектуру B, длинные tooltips с маркетингом, анимации, Web Push/Telegram UI, ETH checkout/tiers/скидки, связанные token banners, новые графики/прогнозы. Их описание в `MONITOR_DECISIONS_20261016.md` — планы, а не действующая часть UI.

---

**Что может сделать владелец прямо сейчас:** согласовать **вариант A**, порядок секций, цвет одного акцента и основной текст на EN+简体中文. Это достаточно конкретный макет для Codex/дизайнера. **Никакого кода/сбора/деплоя этим ответом не менялось.**
