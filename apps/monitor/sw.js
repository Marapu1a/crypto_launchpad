// Notifications only: deliberately no fetch handler or offline cache for private data.
self.addEventListener('push',event=>{
 let d;try{d=event.data?.json()}catch{return}if(!d||typeof d.body!=='string')return;
 event.waitUntil(self.registration.showNotification(String(d.title||'Pattern Watcher').slice(0,100),{body:d.body.slice(0,600),tag:String(d.tag??'pw'),icon:'/imgs/pw_eye.png',data:{url:d.url}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();let url=new URL('/',self.location.origin);
 try{const target=new URL(event.notification.data?.url,self.location.origin);if(target.origin===url.origin&&(target.pathname==='/wallets'||target.pathname==='/'&&/^\d+$/.test(target.searchParams.get('interval')??'')))url=target}catch{}
 event.waitUntil((async()=>{const pages=await self.clients.matchAll({type:'window',includeUncontrolled:true});const page=pages.find(x=>new URL(x.url).origin===url.origin);if(page){await page.navigate(url.href);await page.focus()}else await self.clients.openWindow(url.href)})());
});
