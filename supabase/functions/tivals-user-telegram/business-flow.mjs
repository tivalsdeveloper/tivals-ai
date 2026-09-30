// Pure business request rules. No AI output can change these statuses.
export const STATUSES = Object.freeze(['pending','confirmed','declined','rescheduled','cancelled','completed','no_show']);
export const REQUIRED_NOTIFICATIONS = new Set(['urgent','complaint','handoff']);
export const REQUEST_TYPES = new Set(['booking','order','payment','form','quote','ticket','handoff','complaint','urgent','decision','rating']);
export const RESPONSE_LIMIT_MS = 2 * 60 * 60 * 1000;

export function redact(value) {
  return String(value ?? '').replace(/\b(?:\d[ -]*?){13,19}\b/g, '[payment details removed]')
    .replace(/\b(?:password|passcode|pin|otp|recovery code)\s*[:=]\s*\S+/gi, '[secret removed]')
    .slice(0, 1500);
}
export function shouldNotify(type, enabled) {
  return REQUIRED_NOTIFICATIONS.has(type) || enabled !== false;
}
export function classify(text) {
  const s=String(text||'').slice(0,2000).toLowerCase();
  if(/\b(urgent|emergency|asap|security breach|hacked)\b/.test(s))return {type:'urgent',priority:'urgent'};
  if(/\b(complain|complaint|terrible|unhappy|refund)\b/.test(s)||/\b(?:1|2)[\s-]*(?:out of 5|stars?)\b/.test(s))return {type:'complaint',priority:'high'};
  if(/\b(human|person|staff|agent|reception|technician|engineer|callback|call me|speak to someone)\b/.test(s))return {type:'handoff',priority:'high'};
  if(/\b(cancel|reschedule|change|move)\b/.test(s)&&/\b(book(?:ing)?|appointment|visit|viewing|table|reservation)\b/.test(s))return {type:'booking',priority:'normal',change:true};
  if(/\b(book(?:ing)?|appointment|visit|viewing|table|reservation)\b/.test(s))return {type:'booking',priority:'normal'};
  if(/\b(quote|estimate)\b/.test(s))return {type:'quote',priority:'normal'};
  if(/\b(ticket|support case|broken|not working)\b/.test(s))return {type:'ticket',priority:'normal'};
  if(/\b(order(?:ed)?|checkout|purchase(?:d)?)\b/.test(s))return {type:'order',priority:'normal'};
  if(/\b(paid|payment made|proof of payment)\b/.test(s))return {type:'payment',priority:'high'};
  if(/\b(submit(?:ted)?|sent)\b.*\b(form|application)\b/.test(s))return {type:'form',priority:'normal'};
  if(/\b(exception|special approval|business decision)\b|\b(manager|owner|business)\b.*\b(decide|approve|permission)\b/.test(s))return {type:'decision',priority:'normal'};
  return null;
}
export function nextStatus(current, action, actor, type="booking") {
  const owner={pending:{confirm:'confirmed',decline:'declined',suggest:'rescheduled'},rescheduled:{confirm:'confirmed',decline:'declined',suggest:'rescheduled'},confirmed:{complete:'completed',no_show:'no_show'}};
  const customer={pending:{cancel:'cancelled'},rescheduled:{accept:'confirmed',cancel:'cancelled'},confirmed:{cancel:'cancelled',change:'rescheduled'}};
  const result=actor==='owner'&&current==='pending'&&action==='complete'&&!['booking','order','payment'].includes(type)?'completed':(actor==='owner'?owner:customer)[current]?.[action];
  if(!result)throw new Error('This request can no longer be changed that way.');
  return result;
}
export function dueActions(request, now=Date.now()) {
  const created=Date.parse(request.created_at),limit=Math.max(5,Number(request.response_minutes||120))*60_000;
  const age=now-created, actions=[];
  if(request.status==='pending'){
    if(age>=limit&&request.timeout_stage===0)actions.push('owner_reminder','customer_pending');
    else if(age>=2*limit&&request.timeout_stage===1)actions.push('customer_options');
  }
  const start=Date.parse(request.starts_at||'');
  if(request.status==='confirmed'&&Number.isFinite(start)&&start-now<=24*60*60_000&&start-now>0&&!request.booking_reminded_at)actions.push('booking_reminder');
  if(request.status==='completed'&&['booking','ticket'].includes(request.request_type)&&!request.rating_requested_at)actions.push('rating_request');
  return actions;
}
export function autoConfirmAllowed(slot, requestedAt) {
  return Boolean(slot&&Date.parse(slot.starts_at)===Date.parse(requestedAt)&&Number(slot.capacity)>Number(slot.reserved)&&Date.parse(requestedAt)>Date.now());
}
export function unverifiedClaims(answer, knownPrices=[]) {
  const text=String(answer||'');
  if(/\b(?:booking|appointment|order|payment)\s+(?:is\s+)?(?:confirmed|completed|paid)\b/i.test(text))return true;
  if(/\b(?:in stock|available now|guaranteed availability)\b/i.test(text))return true;
  const known=new Set(knownPrices.map(x=>Number(x)).filter(Number.isFinite).map(x=>x.toFixed(2)));
  for(const match of text.matchAll(/(?:\bZAR\b|\bUSD\b|(?<![A-Za-z])R|\$)\s*(\d+(?:[.,]\d{1,2})?)/gi)){
    if(!known.has(Number(match[1].replace(',','.')).toFixed(2)))return true;
  }
  return false;
}

export function secureEqual(a,b){
  const x=new TextEncoder().encode(String(a)),y=new TextEncoder().encode(String(b));let diff=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);
  return diff===0;
}
