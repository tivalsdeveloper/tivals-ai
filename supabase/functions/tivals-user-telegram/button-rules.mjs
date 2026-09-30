// Server-controlled buttons: model output may suggest text but cannot choose workflow actions.
export function automaticButtons(message) {
  const value=String(message||"").trim();
  if (!value) return [];
  if (/\[ASK:\s*yes_no\]/i.test(value) || /\b(?:would you like|do you want|should I|can I|is that correct|are you sure)\b[^?]*\?\s*$/i.test(value)) return ["✅ Yes","❌ No"];
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
export function matchingMenuOption(message,labels) {
  const value=String(message||"").trim().toLocaleLowerCase();
  return labels.find(label=>String(label).trim().toLocaleLowerCase()===value)||null;
}
