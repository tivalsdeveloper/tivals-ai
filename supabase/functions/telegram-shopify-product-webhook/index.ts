import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";

const url=Deno.env.get("SUPABASE_URL")||"",serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();
async function decrypt(value:string){const raw=Uint8Array.from(atob(value),x=>x.charCodeAt(0));const key=await crypto.subtle.importKey("raw",await crypto.subtle.digest("SHA-256",enc.encode(serviceKey)),"AES-GCM",false,["decrypt"]);return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:raw.slice(0,12)},key,raw.slice(12)));}
function safeUrl(value:string){try{const u=new URL(value);return u.protocol==="https:"?u.href:""}catch{return""}}
async function validHmac(raw:string,signature:string,secret:string){
  if(!signature)return false;
  const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const expected=new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(raw)));
  let actual:Uint8Array;try{actual=Uint8Array.from(atob(signature),x=>x.charCodeAt(0))}catch{return false}
  let diff=expected.length^actual.length;for(let i=0;i<expected.length;i++)diff|=expected[i]^(actual[i]||0);return diff===0;
}
async function sendTelegram(botToken:string,recipient:string,product:any){
  const link=safeUrl(String(product.onlineStoreUrl||""));if(!link)return;
  const name=String(product.title||"New product").slice(0,160);
  const amount=product?.priceRangeV2?.minVariantPrice;
  const caption=`New in the store: ${name}${amount?.amount?` — ${amount.amount} ${amount.currencyCode||""}`:""}`;
  const base={chat_id:recipient,reply_markup:{inline_keyboard:[[{text:"View product",url:link}]]}};
  const image=safeUrl(String(product?.featuredImage?.url||""));
  if(image){const photo=await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...base,photo:image,caption})});if(photo.ok)return}
  const text=await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...base,text:caption+"\n"+link})});if(!text.ok)throw new Error(`Telegram alert failed: ${text.status}`);
}
async function sendWhatsApp(phoneId:string,token:string,recipient:string,product:any){
  const link=safeUrl(String(product.onlineStoreUrl||""));if(!link)return;
  const name=String(product.title||"New product").slice(0,160),image=safeUrl(String(product?.featuredImage?.url||""));
  const caption=`New in the store: ${name}\n${link}`;
  const payload=image?{type:"image",image:{link:image,caption}}:{type:"text",text:{body:caption}};
  const r=await fetch(`https://graph.facebook.com/v23.0/${phoneId}/messages`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:recipient,...payload})});
  if(!r.ok)throw new Error(`WhatsApp alert failed: ${r.status}`);
}
Deno.serve(async req=>{
  if(req.method!=="POST")return new Response("Method not allowed",{status:405});
  const raw=await req.text();if(raw.length>1_000_000)return new Response("Too large",{status:413});
  const shop=String(req.headers.get("x-shopify-shop-domain")||"").toLowerCase();
  const topic=String(req.headers.get("x-shopify-topic")||"").toLowerCase();
  if(!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)||!["products/create","products/update"].includes(topic))return new Response("Invalid event",{status:400});
  const {data:subscription}=await db.from("telegram_shopify_webhook_subscriptions").select("telegram_user_id").eq("shop_domain",shop).maybeSingle();
  if(!subscription)return new Response("Unknown store",{status:403});
  const owner=Number(subscription.telegram_user_id);
  const {data:app}=await db.from("telegram_shopify_app_credentials").select("client_secret_enc").eq("telegram_user_id",owner).eq("shop_domain",shop).maybeSingle();
  const secret=app?.client_secret_enc?await decrypt(String(app.client_secret_enc)):Deno.env.get("SHOPIFY_CLIENT_SECRET")||"";
  if(!secret||!await validHmac(raw,req.headers.get("x-shopify-hmac-sha256")||"",secret))return new Response("Invalid signature",{status:403});
  let payload:any;try{payload=JSON.parse(raw)}catch{return new Response("Invalid JSON",{status:400})}
  const id=String(payload?.admin_graphql_api_id||`gid://shopify/Product/${payload?.id||""}`);
  if(!/^gid:\/\/shopify\/Product\/\d+$/.test(id))return new Response("Invalid product",{status:400});
  // Shopify may deliver a creation event before the product is published. A later update will be checked again.
  const response=await fetch(`${url}/functions/v1/telegram-oauth`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${serviceKey}`},body:JSON.stringify({action:"shopify_products",telegram_user_id:owner,provider:"shopify",query:String(payload?.title||"").slice(0,60)})});
  if(!response.ok)return new Response("Store lookup unavailable",{status:503});
  const data=await response.json().catch(()=>({}));
  const product=(Array.isArray(data?.products)?data.products:[]).find((x:any)=>String(x?.id)===id);
  if(!product||!safeUrl(String(product.onlineStoreUrl||"")))return new Response("Not published");
  const {data:subscribers,error:subError}=await db.from("telegram_product_alert_subscribers").select("channel,recipient,last_inbound_at").eq("telegram_user_id",owner).eq("active",true);
  if(subError)return new Response("Subscriber lookup unavailable",{status:503});
  const {error:claimError}=await db.from("telegram_product_alerts_sent").insert({telegram_user_id:owner,product_id:id});
  if(claimError)return new Response("Already handled");
  const {data:bot}=await db.from("telegram_owned_bots").select("token_enc").eq("telegram_user_id",owner).eq("is_active",true).maybeSingle();
  const {data:wa}=await db.from("telegram_whatsapp_connections").select("phone_number_id,token_enc").eq("telegram_user_id",owner).eq("active",true).maybeSingle();
  let delivered=0;
  for(const sub of subscribers||[]){
    try{
      if(sub.channel==="telegram"&&bot?.token_enc){await sendTelegram(await decrypt(bot.token_enc),String(sub.recipient),product);delivered++}
      // Free-form WhatsApp alerts require an open customer service conversation. Outside it, an approved template is needed.
      if(sub.channel==="whatsapp"&&wa?.token_enc&&sub.last_inbound_at&&Date.now()-new Date(sub.last_inbound_at).getTime()<23*60*60*1000){await sendWhatsApp(String(wa.phone_number_id),await decrypt(wa.token_enc),String(sub.recipient),product);delivered++}
    }catch(e){console.error("Product alert delivery failed",String(e))}
  }
  if(!delivered&&subscribers?.some((x:any)=>x.channel==="telegram")){await db.from("telegram_product_alerts_sent").delete().eq("telegram_user_id",owner).eq("product_id",id);return new Response("Delivery failed",{status:503})}
  return new Response("OK");
});
