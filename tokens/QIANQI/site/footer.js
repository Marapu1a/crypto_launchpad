'use strict';
QianqiMessages.push(['All projects','Все проекты','所有項目'],['Contact','Связаться','聯絡']);
(() => {
 const button=document.querySelector('.contact-open'),dialog=document.querySelector('#contact-dialog');
 button.addEventListener('click',()=>dialog.showModal());
 dialog.querySelector('.contact-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
 dialog.addEventListener('close',()=>button.focus({preventScroll:true}));
})();
