// Shared contact dialog. Deliberately independent of wallet dialogs.
(() => {
 if (globalThis.QianqiMessages) for (const row of [['All projects','Все проекты','所有項目'],['Contact','Связаться','聯絡']]) {
  if (!QianqiMessages.some(existing => existing[0] === row[0])) QianqiMessages.push(row);
 }
 const button=document.querySelector('.kit-footer .contact-open'),dialog=document.querySelector('.kit-contact');
 if(!button||!dialog)return;
 button.addEventListener('click',()=>dialog.showModal());
 dialog.querySelector('.contact-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
 dialog.addEventListener('close',()=>button.focus({preventScroll:true}));
})();
