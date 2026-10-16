'use strict';
(() => {
 const supported=['en','ru','zh-HK'],key='qianqi.language.v1';
 const normalize=s=>s.replace(/\s+/g,' ').trim();
 const exact=new Map(),templates=[];
 for(const [en,ru,zh] of globalThis.QianqiMessages){
  if(!en||!ru||!zh||exact.has(en))throw Error('Invalid or duplicate translation: '+en);
  exact.set(en,{en,ru,'zh-HK':zh});
  if(en.includes('{')){
   const names=[];let source='',last=0;
   for(const match of en.matchAll(/\{(\w+)\}/g)){source+=escape(en.slice(last,match.index))+'(.+?)';names.push(match[1]);last=match.index+match[0].length;}
   source+=escape(en.slice(last));templates.push({pattern:new RegExp('^'+source+'$'),names,values:exact.get(en),weight:en.replace(/\{\w+\}/g,'').length});
   for(const translated of [ru,zh])if([...translated.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join()!==[...names].sort().join())throw Error('Translation placeholders differ: '+en);
  }
 }
 templates.sort((a,b)=>b.weight-a.weight);
 function escape(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
 let language='en';try{const saved=localStorage.getItem(key);if(supported.includes(saved))language=saved;}catch{}
 const sources=new WeakMap(),attributeSources=new WeakMap();
 function dateLabel(value,lang){
  const match=/^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec) (\d{4}), (\d{2}):(\d{2}) UTC$/.exec(value);
  if(!match)return value;
  const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[2].slice(0,3));
  const date=new Date(Date.UTC(Number(match[3]),month,Number(match[1]),Number(match[4]),Number(match[5])));
  return new Intl.DateTimeFormat(lang,{timeZone:'UTC',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+' UTC';
 }
 function translate(source,lang=language){
  const clean=normalize(source);if(lang==='en')return source;
  let value=exact.get(clean)?.[lang];
  if(!value)for(const entry of templates){const match=entry.pattern.exec(clean);if(match){const params=Object.fromEntries(entry.names.map((name,i)=>[name,name==='time'?dateLabel(match[i+1],lang):match[i+1]]));value=entry.values[lang].replace(/\{(\w+)\}/g,(_,name)=>params[name]);break;}}
  return value===undefined?source:source.match(/^\s*/)[0]+value+source.match(/\s*$/)[0];
 }
 function textNode(node){
  if(!node.parentElement||node.parentElement.closest('script,style,code,pre,[translate="no"],textarea,option'))return;
  const before=sources.get(node),current=node.nodeValue;
  const source=before&&current===before.rendered?before.source:current;
  const rendered=translate(source);sources.set(node,{source,rendered});if(current!==rendered)node.nodeValue=rendered;
 }
 function attributes(node){
  if(node.closest('[translate="no"]'))return;
  const saved=attributeSources.get(node)||{};
  for(const name of ['aria-label','title','alt','placeholder'])if(node.hasAttribute(name)){
   const current=node.getAttribute(name),before=saved[name],source=before&&current===before.rendered?before.source:current,rendered=translate(source);
   saved[name]={source,rendered};if(current!==rendered)node.setAttribute(name,rendered);
  }
  attributeSources.set(node,saved);
 }
 const options={subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title','alt','placeholder']};
 const observer=new MutationObserver(()=>render());
 function render(){
  observer.disconnect();
  try{
   document.documentElement.lang=language;
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
   while(walker.nextNode()){const node=walker.currentNode;if(node.nodeType===Node.TEXT_NODE)textNode(node);else attributes(node);}
   if(document.querySelector('title')?.firstChild)textNode(document.querySelector('title').firstChild);
   for(const select of document.querySelectorAll('[data-language-select]'))select.value=language;
  }finally{observer.observe(document.body,options);}
 }
 function setLanguage(value){if(!supported.includes(value))return;language=value;try{localStorage.setItem(key,value);}catch{}render();}
 for(const select of document.querySelectorAll('[data-language-select]'))select.addEventListener('change',()=>setLanguage(select.value));
 globalThis.QianqiI18n=Object.freeze({translate,setLanguage,get language(){return language;}});
 render();
})();
