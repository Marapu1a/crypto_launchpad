export const language=value=>/^ru(?:-|$)/i.test(value??'')?'ru':/^zh(?:-|$)/i.test(value??'')?'zh':'en';
export const localized=(lang,en,ru,zh)=>({en,ru,zh})[language(lang)];
export const testMessage=lang=>localized(lang,'Test notification. Connected.','Тестовое уведомление. Канал подключён.','测试通知。已连接。');
export const activityButton=lang=>localized(lang,'View activity','Посмотреть активность','查看活跃情况');
export async function recipientLanguage(db,owner,channel){
 const sql=channel==='telegram'?'SELECT l.language FROM monitor_alerts.chats c JOIN monitor_alerts.chat_languages l ON l.chat=c.chat WHERE c.owner=$1':'SELECT language FROM monitor_alerts.languages WHERE owner=$1';
 const {rows:[r]}=await db.query(sql,[owner]);return r?.language??'ru';
}
