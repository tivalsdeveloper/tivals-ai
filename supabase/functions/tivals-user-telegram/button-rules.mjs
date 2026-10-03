// Server-controlled buttons: model output may suggest text but cannot choose workflow actions.
export function automaticButtons(message) {
  const value=String(message||"").trim();
  if (!value) return [];
  const question=value.replace(/\[ASK:\s*yes_no\]/gi,"").trim().split(/[.!?]\s+/).at(-1).trim();
  if (/\b(?:how|what|which|when|where|why)\b[^?]*\?\s*$/i.test(question) || /\b(?:or)\b[^?]*\?\s*$/i.test(question)) return [];
  if (/\[ASK:\s*yes_no\]/i.test(value) || /\b(?:would you like|do you want|should I|can I|is that correct|are you sure)\b[^?]*\?\s*$/i.test(question)) return ["✅ Yes","❌ No"];
  if (/\b(?:shall we continue|ready to continue|more products|next tip)\b[^?]*\??\s*$/i.test(value)) return ["▶️ Continue","🏠 Main menu"];
  return [];
}
export function cleanAnswer(message) {
  return String(message||"").replace(/\[ASK:\s*yes_no\]/gi,"").trim();
}
export function menuRows(labels) {
  const unique=[...new Set(labels.map(x=>String(x).trim()).filter(Boolean))].slice(0,8);
  const rows=[];for(let i=0;i<unique.length;i+=2)rows.push(unique.slice(i,i+2).map(text=>({text})));
  return rows;
}
export function inlineChoiceRows(labels) {
  const actions={"✅ Yes":"quick:yes","❌ No":"quick:no","▶️ Continue":"quick:continue","🏠 Main menu":"quick:menu"};
  return menuRows(labels).map(row=>row.map(button=>({text:button.text,callback_data:actions[button.text]})));
}
// One decision per question message, even when Telegram sends a second callback ID.
export function selectionKey(chatId,messageId) {
  if(!Number.isSafeInteger(chatId)||!Number.isSafeInteger(messageId)||messageId<=0) return null;
  return `selected:${chatId}:${messageId}`;
}
export function matchingMenuOption(message,labels) {
  const value=String(message||"").trim().toLocaleLowerCase();
  return labels.find(label=>String(label).trim().toLocaleLowerCase()===value)||null;
}
export function ambiguousAffirmation(message,history) {
  if(!/^(?:✅\s*)?(?:yes|yeah|yep|sure)\s*[.!]?$/i.test(String(message||'').trim()))return false;
  const last=[...(history||[])].reverse().find(entry=>entry.role==='assistant');
  const question=String(last?.content||'').split(/[.!?]\s+/).at(-1);
  return /\bor\b[^?]*\?\s*$/i.test(question||'');
}
