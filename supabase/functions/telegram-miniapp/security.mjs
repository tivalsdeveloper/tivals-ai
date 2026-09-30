// Fixed-size comparison and Telegram WebApp authentication. Raw initData is never logged.
export function secureEqual(a,b){
  const x=new TextEncoder().encode(String(a)),y=new TextEncoder().encode(String(b));
  let diff=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);
  return diff===0;
}
export async function verifiedTelegramInitData(raw,botToken,nowSeconds=Math.floor(Date.now()/1000)){
  if(!raw||!botToken||raw.length>8192)return null;
  const params=new URLSearchParams(raw),hash=params.get('hash')||'';
  if(!/^[0-9a-f]{64}$/i.test(hash))return null;
  params.delete('hash');
  const authDate=Number(params.get('auth_date'));
  if(!Number.isSafeInteger(authDate)||authDate>nowSeconds||nowSeconds-authDate>900)return null;
  const data=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const enc=new TextEncoder(),secret=await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',enc.encode('WebAppData'),{name:'HMAC',hash:'SHA-256'},false,['sign']),enc.encode(botToken));
  const signature=await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign']),enc.encode(data));
  const expected=Array.from(new Uint8Array(signature),x=>x.toString(16).padStart(2,'0')).join('');
  if(!secureEqual(expected,hash))return null;
  try{const user=JSON.parse(params.get('user')||'{}');return Number.isSafeInteger(Number(user.id))&&Number(user.id)>0?user:null}catch{return null}
}
