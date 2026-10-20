(()=>{
 const words={replay:['Replay of saved history, not live events. Original as-of revisions are unavailable.','历史回放，并非实时事件。缺少原始时点版本。','Проверка по сохранённой истории, не текущие события. Исходные версии данных на момент каждого сбора недоступны.'],mode:['Observation mode · notifications are off. Thresholds are experimental. Pons V2 curve buys in the first hour, excluding creators.','观察模式 · 通知已关闭，阈值尚在测试。仅 Pons V2 首小时曲线买入，不含创建者。','Режим наблюдения · уведомления выключены, пороги экспериментальные. Покупки Pons V2 на кривой в первый час, без создателей.'],
 activity:['Sustained elevated activity','持续活跃','Устойчивое оживление'],volumeSpike:['Purchase volume spike','买入量激增','Всплеск объёма покупок'],
 empty:['No episodes recorded yet.','暂无事件记录。','События ещё не записаны.'],insufficient:['Insufficient complete data for all comparisons. Up to 70 consecutive minutes are needed.','完整数据不足，需要最多连续 70 分钟。','Для всех сравнений пока недостаточно полных данных. Нужно до 70 минут непрерывной истории.'],
 unavailable:['Could not load signals.','无法加载信号。','Не удалось загрузить сигналы.'],notFound:['This saved event is unavailable. No current snapshot has been substituted.','该历史事件不可用，不会替换为当前快照。','Сохранённое событие недоступно. Текущие данные вместо него не подставлены.'],
 open:['View the recorded interval','查看记录时段','Посмотреть сохранённый интервал'],active:['Open episode','开放事件','Открытое событие'],closed:['Episode ended','事件已结束','Событие завершилось'],
 baseline:['Earlier hour: median per 5 minutes','此前一小时：每 5 分钟中位数','Предыдущий час: медиана за 5 минут'],threshold:['Experimental threshold','实验阈值','Экспериментальный порог'],
 concentrated:['All observed volume came from one address.','观察到的全部交易量来自一个地址。','Весь наблюдаемый объём пришёлся на один адрес.'],evidence:['Recorded observations','已保存的观测','Сохранённые наблюдения'],
 launches:['New launches','新发行','Новые запуски'],scope:['Token composition changes as new launches enter and older tokens leave their first hour.','新发行进入、旧代币超过首小时后退出，样本构成会变化。','Состав меняется: новые токены появляются, старые выходят из первого часа.'],
 previous:['Previous 5 minutes','前 5 分钟','Предыдущие 5 минут'],top3:['Volume share of top 3 addresses','前 3 地址交易量占比','Доля трёх крупнейших адресов в объёме']};
 Object.assign(words,{
 mode:['We are testing signals. Notifications are off. Only observed Pons V2 first-hour curve purchases are included, excluding creators.','正在测试信号，不发送通知。仅统计观察到的 Pons V2 首小时曲线买入，不含创建者。','Проверяем сигналы, уведомления не отправляем. Учитываем наблюдаемые покупки Pons V2 на кривой в первый час, без создателей.'],
 replay:['These are saved historical events, not current market activity.','以下为历史记录，并非当前市场活动。','Здесь сохранённые события из истории, а не текущая активность рынка.'],
 activity:['More buyers and purchases for 10 minutes','买家与买入次数连续十分钟增加','Покупателей и покупок больше уже 10 минут'],
 volumeSpike:['Purchase volume rose','买入金额上升','Вырос объём покупок'],
 event:['Elevated buying activity','买入活动升温','Повышенная активность покупок'],
 started:['First detected:','首次发现：','Впервые замечено:'],
 active:['No ending recorded','尚未记录结束','Завершение пока не зафиксировано'],
 closed:['Event ended','事件已结束','Событие завершилось'],
 open:['Explore event →','查看详情 →','Разобрать событие →'],
 back:['← All events','← 所有事件','← Все события'],
 recorded:['Signals within this event','事件内信号数','Срабатываний внутри события'],
 lastRecorded:['Latest signal:','最近信号：','Последнее:'],
 groupHelp:['Signals below occurred at different times. They belong to one period of elevated activity; each block has its own interval.','以下信号发生在不同时间，归于同一活跃阶段；每块都有自己的时间区间。','Ниже — срабатывания в разное время внутри одного периода повышенной активности. У каждого блока свой интервал.'],
 volumeWhy:['More was spent on purchases than is typical for a five-minute interval in the preceding hour.','五分钟买入金额超过此前一小时的典型水平。','За эти 5 минут на покупки потратили больше, чем обычно за такой же интервал в предыдущем часу.'],
 activityWhy:['Both buyer addresses and purchase counts stayed elevated for two five-minute intervals in a row.','买家地址数与买入次数连续两个五分钟区间保持较高水平。','Два пятиминутных интервала подряд покупателей и покупок было больше обычного.'],
 spent:['Spent on purchases','买入支出','Потрачено на покупки'],
 buyerLabel:['Buyer wallets','买家钱包','Кошельков-покупателей'],
 purchaseLabel:['Purchases','买入次数','Покупок'],
 in5:['over these 5 minutes','这五分钟内','за эти 5 минут'],
 last5:['in the last 5 minutes of this signal','信号的后五分钟','за последние 5 минут сигнала'],
 compare:['Compared with earlier activity','与此前活动比较','С чем сравниваем'],
 usual:['Typical level per 5 minutes in the preceding hour','此前一小时每五分钟的典型水平','Обычный уровень за 5 минут в предыдущем часу'],
 previous:['First 5 minutes of this signal','信号的前五分钟','Первые 5 минут этого сигнала'],
 pairLegend:['buyer wallets / purchases','买家钱包 / 买入次数','кошельков-покупателей / покупок'],
 explain:['How to read this','如何理解','Как это понимать'],
 usualHelp:['We sort the 12 five-minute values from the preceding hour and average the two middle values (the median). One unusually large burst has less influence than in an average. Zero means a typical interval had no purchases, not necessarily the entire hour. Activity signals exclude both signal intervals from this comparison.','将前一小时的十二个五分钟数值排序后取中间值（中位数），减少单次突增的影响。零表示典型区间没有买入，并不代表整小时没有。活跃信号的两个区间不计入基准。','Берём 12 пятиминутных отрезков предыдущего часа, сортируем значения и берём среднее двух значений посередине — это медиана. Один случайный всплеск меньше искажает сравнение. Ноль означает, что типичный отрезок был без покупок, а не обязательно весь час. Для сигнала активности оба интервала самого сигнала исключены из сравнения.'],
 who:['Who accounted for the volume','谁贡献了买入金额','Кто обеспечил объём'],
 top3Human:['of purchase volume came from the three largest buyer wallets (or fewer if there were fewer buyers).','的买入金额来自金额最大的三个买家钱包；不足三个时统计全部。','объёма покупок пришлось на три крупнейших кошелька-покупателя (или меньше, если покупателей было меньше трёх).'],
 concentrated:['All purchase volume came from one buyer wallet.','全部买入金额来自一个买家钱包。','Весь объём покупок пришёлся на один кошелёк-покупатель.'],
 buyersHelp:['Wallets are ranked by the amount spent in this currency during this five-minute interval. A high share means a few wallets drove the volume. Wallets are not people: one person can own several.','按该五分钟内以此币种买入的金额排名。占比高说明金额集中于少数钱包。一个人可以拥有多个钱包。','Считаем сумму покупок каждого кошелька в этой валюте за указанные 5 минут. Большая доля означает, что объём обеспечили несколько крупных покупателей. Кошелёк не равен человеку: у одного человека их может быть несколько.'],
 rule:['Why the signal triggered','为何触发信号','Почему появился сигнал'],
 activityRule:['Both five-minute intervals met the minimum buyer and purchase counts shown below.','两个五分钟区间的买家数和买入次数均达到以下界限。','В обоих пятиминутных интервалах число кошельков-покупателей и покупок достигло указанных ниже границ.'],
 volumeRule:['The purchase amount reached the signal boundary. It depends on the earlier hour and a minimum amount, so a tiny rise from zero is not enough.','买入金额达到触发界限。界限由此前一小时的水平与最低金额共同决定，避免从零开始的微小增长触发。','Сумма покупок достигла границы срабатывания. Она зависит от предыдущего часа и минимальной суммы: небольшой рост с нуля сам по себе недостаточен.'],
 minVolume:['Signal boundary for this interval','此区间触发金额','Граница срабатывания для этого интервала'],
 trial:['We are checking these rules on history. A signal marks unusual activity; it does not predict price growth.','规则正在历史数据上验证。信号表示活动异常，并不预测价格上涨。','Эти правила пока проверяем на истории. Сигнал отмечает необычную активность, а не предсказывает рост цены.'],
 source:['Source data: purchases by token','原始数据：各代币买入','Исходные данные: покупки по токенам'],
 baseSource:['Earlier-hour comparison data','此前一小时对比数据','Данные предыдущего часа для сравнения']
 });
 const t=k=>words[k]?.[U.locale().startsWith('ru')?2:U.locale().startsWith('zh')?1:0]??U.t(k),n=U.node;
 let data=null,error='',loading=false;
 const title=r=>r.kind==='activity'?t('activity'):t('volumeSpike')+' · '+r.symbol;
 function observation(w){const box=n('section','','signal-evidence');box.append(n('h3',U.clock(w.windowEnd-300)+' – '+U.clock(w.windowEnd)),n('p',`${t('buyers')}: ${U.num(w.current?.buyers)} · ${t('buys')}: ${U.num(w.current?.buys)} · ${t('tokens')}: ${U.num(w.current?.tokens)} · ${t('launches')}: ${U.num(w.current?.launches)}`));
  const rows=(w.board??[]).filter(x=>x.recent?.buys>0);if(rows.length){const table=n('table',''),head=n('thead',''),hr=n('tr','');for(const k of ['token','buys','volume'])hr.append(n('th',t(k)));head.append(hr);table.append(head);const body=n('tbody','');for(const x of rows){const tr=n('tr',''),td=n('td','');if(/^0x[0-9a-f]{40}$/i.test(x.address)){const a=n('a',x.symbol||x.address);a.href='https://ponsfamily.com/launchpad/'+x.address;a.target='_blank';a.rel='noopener noreferrer';td.append(a)}else td.textContent=x.symbol;tr.append(td,n('td',U.num(x.recent.buys)),n('td',U.amount(x.recent.volume)+' '+(x.quote??'')));body.append(tr)}table.append(body);box.append(table)}return box;
 }
 function help(key){const d=n('details','','signal-help');d.append(n('summary',t('explain')),n('p',t(key)));return d}
 function metric(label,value,note){const d=n('div','','signal-metric');d.append(n('span',label),n('strong',value));if(note)d.append(n('small',note));return d}
 function range(end,seconds=300){return U.clock(end-seconds)+' — '+U.clock(end)}
 function reason(r){const activity=r.kind==='activity',last=activity?r.values[1]:r;
  const box=n('section','','signal-reason'),head=n('div','','signal-reason-head');head.append(n('h3',title(r)),n('span',range(r.windowEnd,activity?600:300),'signal-time'));box.append(head,n('p',t(activity?'activityWhy':'volumeWhy'),'signal-intro'));
  const metrics=n('div','','signal-metrics');
  if(!activity)metrics.append(metric(t('spent'),U.amount(r.value)+' '+r.symbol,t('in5')));
  metrics.append(metric(t('buyerLabel'),U.num(last.buyers),t(activity?'last5':'in5')),metric(t('purchaseLabel'),U.num(last.buys),t(activity?'last5':'in5')));box.append(metrics);
  const comparison=n('div','','signal-comparison');comparison.append(n('h4',t('compare')));
  if(activity){const rows=n('div','','signal-compare-grid');rows.append(metric(t('buyerLabel'),U.num(r.values[0].buyers),t('previous')),metric(t('purchaseLabel'),U.num(r.values[0].buys),t('previous')),metric(t('buyerLabel'),U.num(r.baseline.buyers),t('usual')),metric(t('purchaseLabel'),U.num(r.baseline.buys),t('usual')));comparison.append(rows)}
  else comparison.append(n('p',t('usual')+': '+U.amount(r.baseline)+' '+r.symbol+'.'));
  comparison.append(help('usualHelp'));box.append(comparison);
  if(!activity){const who=n('div','','signal-buyers');who.append(n('h4',t('who')));if(r.top3Pct!=null)who.append(n('p',U.num(r.top3Pct)+'% — '+t('top3Human')));if(r.concentrated)who.append(n('p',t('concentrated')));who.append(help('buyersHelp'));box.append(who)}
  const rule=n('details','','signal-rule');rule.append(n('summary',t('rule')));
  rule.append(n('p',t(activity?'activityRule':'volumeRule')));
  rule.append(n('p',activity?t('buyerLabel')+': '+U.num(r.thresholds.buyers)+'; '+t('purchaseLabel')+': '+U.num(r.thresholds.buys)+'.':t('minVolume')+': '+U.amount(r.threshold)+' '+r.symbol+'.'),n('p',t('trial')));box.append(rule);return box;
 }
 function draw(){document.getElementById('signals-mode').textContent=t('mode')+(data?.mode==='replay'?' '+t('replay'):'');const root=document.getElementById('signals');root.replaceChildren();document.getElementById('signals-status').textContent=error?t(error):data?.latest?.status==='insufficient'?t('insufficient'):'';if(!data)return;
  if(data.id){const back=n('a',t('back'),'signal-back');back.href='/signals';root.append(back)}
  const episodes=data.id?[data]:data.episodes??[];if(!episodes.length)root.append(n('p',t('empty')));
  for(const e of episodes){const card=n('article','','signal-card'),head=n('header','','signal-card-head');head.append(n('span',t(e.status==='closed'?'closed':'active'),'signal-tag'),n('h2',t('event')),n('p',t('started')+' '+U.clock(e.firstEnd)));card.append(head);
   const tags=n('div','','signal-tags');for(const label of new Set(e.reasons.map(title)))tags.append(n('span',label));card.append(tags);
   if(data.id){card.append(n('p',t('groupHelp'),'signal-intro'));for(const r of [...e.reasons].sort((a,b)=>a.windowEnd-b.windowEnd))card.append(reason(r));
    const details=n('details','','signal-source');details.append(n('summary',t('source')),n('p',t('scope')));const ends=[...new Set(e.reasons.flatMap(r=>r.kind==='activity'?[r.windowEnd-300,r.windowEnd]:[r.windowEnd]))].sort((a,b)=>a-b);for(const end of ends)if(e.windows?.[end])details.append(observation(e.windows[end]));const base=n('details','');base.append(n('summary',t('baseSource')));for(const end of [...new Set(e.reasons.flatMap(r=>r.baselineEnds))].sort((a,b)=>a-b))if(e.windows?.[end])base.append(observation(e.windows[end]));details.append(base);card.append(details)
   }else{card.append(n('p',t('recorded')+': '+U.num(e.reasons.length)+'. '+t('lastRecorded')+' '+U.clock(Math.max(...e.reasons.map(r=>r.windowEnd))), 'signal-intro'));const a=n('a',t('open'),'signal-open');a.href='/signals?id='+e.id;card.append(a)}root.append(card);
  }
 }
 async function load(){if(loading)return;loading=true;const button=document.getElementById('signals-refresh');button.disabled=true;error='';try{const id=new URLSearchParams(location.search).get('id');const r=await fetch(id?'/api/market-signal?id='+encodeURIComponent(id):'/api/market-signals',{signal:AbortSignal.timeout(15000)});if(!r.ok){error=r.status===404?'notFound':'unavailable';data=null}else data=await r.json()}catch{error='unavailable';data=null}finally{loading=false;button.disabled=false;draw()}}
 document.getElementById('signals-refresh').onclick=load;document.addEventListener('languagechange',draw);load();
})();
