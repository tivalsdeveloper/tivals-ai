import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url=Deno.env.get("SUPABASE_URL")||"";
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();
function hex(bytes:ArrayBuffer){return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function equal(a:string,b:string){if(a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;}
async function decrypt(value:string){const raw=Uint8Array.from(atob(value),x=>x.charCodeAt(0));const key=await crypto.subtle.importKey("raw",await crypto.subtle.digest("SHA-256",enc.encode(serviceKey)),"AES-GCM",false,["decrypt"]);return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:raw.slice(0,12)},key,raw.slice(12)));}
async function validSignature(raw:string,signature:string,secret:string){if(!signature.startsWith("sha256="))return false;const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return equal(signature.slice(7).toLowerCase(),hex(await crypto.subtle.sign("HMAC",key,enc.encode(raw))));}


function productLine(p:any){
  const price=p?.priceRangeV2?.minVariantPrice;
  const amount=Number(price?.amount);
  const formatted=Number.isFinite(amount)?` — ${price?.currencyCode||"ZAR"} ${amount.toFixed(2)}`:"";
  return `${String(p.title||"").slice(0,120)}${formatted}\n${String(p.onlineStoreUrl||"").slice(0,500)}`;
}
function shoppingReply(text:string,products:any[],shopifyAvailable:boolean,previous:any[]){
  const t=text.toLowerCase().trim();
  const last=String(previous?.[0]?.reply_text||"");
  const followUp=/^(yes|yeah|yep|sure|okay|ok|i do|please|send (it|the link))\W*$/i.test(t);
  if(followUp){
    const links=[...last.matchAll(/https:\/\/[^\s]+/g)].map(m=>m[0]);
    if(links.length===1){const p=products.find(x=>String(x.onlineStoreUrl||"")===links[0]);return {text:"Yes. Tap the product below to view it and complete your purchase.",products:p?[p]:[],link:p?"":links[0]}}
    if(links.length>1)return {text:"Which product would you like? Send its name and I'll show you the purchase link.",products:[]};
    return {text:"Sure. Tell me which product you mean and I'll help you with the next step.",products:[]};
  }
  if(!/\b(buy|purchase|order|available|catalog|store|books?|courses?|products?|price|sell|show|view)\b/.test(t))return null;
  if(!shopifyAvailable)return {text:"I can't check the store right now. Please try again shortly or tell me which product you're looking for.",products:[]};
  if(!products.length)return {text:"I can't find any published products with purchase links right now.",products:[]};
  const normalized=(v:string)=>v.toLowerCase().replace(/[^a-z0-9 ]/g," ");
  const named=products.filter(p=>normalized(String(p.title||"")).split(/\s+/)
    .filter(w=>w.length>3&&!/^(learn|course|lessons|handwritten|beginner|advanced|digital|guide|with)$/.test(w))
    .some(w=>normalized(t).includes(w)));
  if(named.length===1)return {text:"Here is the product. Tap its link to view details and buy it.",products:named};
  const digital=products.filter(p=>/course|lesson|pdf|learn|guide|handwritten/i.test(String(p.title||"")));
  const candidates=(named.length?named:/\bbooks?\b/.test(t)&&digital.length?digital:products).slice(0,3);
  const note=/\bbooks?\b/.test(t)&&!products.some(p=>/\bbook\b/i.test(String(p.title||"")))?"These are digital learning materials; I can't confirm a printed book in the published listings. ":"";
  return {text:`${note}Here are some published options. Which one interests you?`,products:candidates};
}
async function sendWhatsApp(phoneId:string,token:string,to:string,message:any,contextId=""){
  const r=await fetch(`https://graph.facebook.com/v23.0/${phoneId}/messages`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to,...message,...(contextId?{context:{message_id:contextId}}:{})})});
  if(!r.ok)throw new Error(`Meta send failed: ${r.status}`);
}
async function sendProductImage(phoneId:string,token:string,to:string,p:any){
  const image=String(p?.featuredImage?.url||""),link=String(p?.onlineStoreUrl||"");
  const caption=productLine(p).slice(0,1000);
  if(/^https:\/\//i.test(image))try{await sendWhatsApp(phoneId,token,to,{type:"image",image:{link:image,caption}});return}catch(e){console.error("WhatsApp product image unavailable",String(e))}
  await sendWhatsApp(phoneId,token,to,{type:"text",text:{body:caption}});
}
async function shopifyContext(owner:number){
  const response=await fetch(`${url}/functions/v1/telegram-oauth`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${serviceKey}`},body:JSON.stringify({action:"shopify_products",telegram_user_id:owner,provider:"shopify",query:""})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(String(data?.error||"Shopify unavailable"));
  return Array.isArray(data?.products)?data.products:[];
}

Deno.serve(async req=>{
  if(req.method==="GET"){
    const p=new URL(req.url).searchParams;
    if(p.get("hub.mode")!=="subscribe")return new Response("Invalid challenge",{status:403});
    const token=p.get("hub.verify_token")||"";
    if(!token||token.length>200)return new Response("Invalid token",{status:403});
    const hash=hex(await crypto.subtle.digest("SHA-256",enc.encode(token)));
    const {data}=await db.from("telegram_whatsapp_connections").select("phone_number_id").eq("verify_token_hash",hash).eq("active",true).maybeSingle();
    return data?new Response(p.get("hub.challenge")||"",{headers:{"content-type":"text/plain"}}):new Response("Invalid token",{status:403});
  }
  if(req.method!=="POST")return new Response("Method not allowed",{status:405});
  const raw=await req.text();if(raw.length>1_000_000)return new Response("Too large",{status:413});
  let payload:any;try{payload=JSON.parse(raw)}catch{return new Response("Invalid JSON",{status:400})}
  const changes=payload?.entry?.flatMap((x:any)=>x.changes||[])||[];
  const ids=[...new Set(changes.map((x:any)=>String(x?.value?.metadata?.phone_number_id||"")).filter(Boolean))];
  if(ids.length!==1)return new Response("Unknown phone",{status:403});
  const {data:connection}=await db.from("telegram_whatsapp_connections").select("telegram_user_id,phone_number_id,token_enc,app_secret_enc").eq("phone_number_id",ids[0]).eq("active",true).maybeSingle();
  if(!connection)return new Response("Unknown phone",{status:403});
  let appSecret:string;
  try{appSecret=await decrypt(connection.app_secret_enc)}catch{return new Response("Configuration error",{status:500})}
  if(!await validSignature(raw,req.headers.get("x-hub-signature-256")||"",appSecret))return new Response("Invalid signature",{status:403});
  // Only inbound text is handled; delivery statuses and unsupported media are acknowledged.
  const messages=changes.flatMap((x:any)=>x.value?.messages||[]).filter((x:any)=>x.type==="text"&&x.id&&x.from);
  for(const msg of messages){
    const incoming=String(msg.text?.body||"").trim().slice(0,3000);
    const customer=String(msg.from).slice(0,40);
    const {error:duplicate}=await db.from("telegram_whatsapp_messages").insert({message_id:String(msg.id),phone_number_id:ids[0],customer_number:customer,incoming_text:incoming});
    if(duplicate)continue;
    try{
      const [{data:business},{data:catalog},{data:faqs},{data:previous}]=await Promise.all([
        db.from("telegram_business_profiles").select("business_name,assistant_name,business_details,industry,behavior,email,phone,address,website_url,business_hours,payment_options").eq("telegram_user_id",connection.telegram_user_id).maybeSingle(),
        db.from("telegram_business_catalog").select("item_type,name,price,currency,details,available").eq("telegram_user_id",connection.telegram_user_id).eq("available",true).limit(30),
        db.from("telegram_business_faqs").select("question,answer").eq("telegram_user_id",connection.telegram_user_id).limit(30),
        db.from("telegram_whatsapp_messages").select("incoming_text,reply_text").eq("phone_number_id",ids[0]).eq("customer_number",customer).neq("message_id",String(msg.id)).not("reply_text","is",null).order("received_at",{ascending:false}).limit(5)
      ]);
      if(/^(?:stop|unsubscribe|stop product alerts|stop products)$/i.test(incoming)){
        await db.from("telegram_product_alert_subscribers").update({active:false}).eq("telegram_user_id",connection.telegram_user_id).eq("channel","whatsapp").eq("recipient",customer);
        const token=await decrypt(connection.token_enc);
        await sendWhatsApp(ids[0],token,customer,{type:"text",text:{body:"Product alerts are off. Message 'notify me of new products' to turn them on again."}},String(msg.id));
        await db.from("telegram_whatsapp_messages").update({reply_text:"Product alerts are off."}).eq("message_id",String(msg.id));
        continue;
      }
      if(/^(?:notify me(?: of| about)? new products|product alerts on|subscribe to product alerts)$/i.test(incoming)){
        await db.from("telegram_product_alert_subscribers").upsert({telegram_user_id:connection.telegram_user_id,channel:"whatsapp",recipient:customer,active:true,opted_in_at:new Date().toISOString(),last_inbound_at:new Date().toISOString()},{onConflict:"telegram_user_id,channel,recipient"});
        const token=await decrypt(connection.token_enc);
        await sendWhatsApp(ids[0],token,customer,{type:"text",text:{body:"You're subscribed to new product alerts. Reply STOP PRODUCTS to opt out. WhatsApp alerts are sent only when messaging rules allow them."}},String(msg.id));
        await db.from("telegram_whatsapp_messages").update({reply_text:"Product alerts enabled."}).eq("message_id",String(msg.id));
        continue;
      }
      await db.from("telegram_product_alert_subscribers").update({last_inbound_at:new Date().toISOString()}).eq("telegram_user_id",connection.telegram_user_id).eq("channel","whatsapp").eq("recipient",customer).eq("active",true);
      let products:any[]=[],shopifyAvailable=false;
      try{if(/\b(buy|purchase|order|available|catalog|store|books?|courses?|products?|price|sell|show|view)\b/i.test(incoming)||/^(yes|yeah|yep|sure|okay|ok|i do|please|send (it|the link))\W*$/i.test(incoming)){products=await shopifyContext(Number(connection.telegram_user_id));shopifyAvailable=true}}
      catch(e){console.error("WhatsApp Shopify lookup unavailable",String((e as Error)?.message||e))}
      const history=(previous||[]).reverse().flatMap((row:any)=>[{role:"user",content:String(row.incoming_text||"").slice(0,3000)},{role:"assistant",content:String(row.reply_text||"").slice(0,3000)}]);
      const commerce=shoppingReply(incoming,products,shopifyAvailable,previous||[]);
      let answer=commerce?.text||"";
      if(!answer){
        const ai=await fetch(`${url}/functions/v1/tivals-ai-chat`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${serviceKey}`},body:JSON.stringify({model:"tivals-ai",business_profile:{...business,catalog,faqs,shopify:{available:shopifyAvailable,products}},messages:[{role:"system",content:"You are replying to a WhatsApp customer. Continue the conversation naturally. Do not introduce yourself again after the first reply. Answer the question directly. Never suggest an unrelated service or claim you checked a store unless live product details are provided. Do not invent product availability, prices, or purchase links. Keep replies short and helpful."},...history,{role:"user",content:incoming}]})});
        if(!ai.ok)throw new Error("AI unavailable");
        const data=await ai.json();if(["ALL_PROVIDERS_FAILED","NO_PROVIDER_KEYS"].includes(String(data?.code||"")))throw new Error("AI provider unavailable");
        answer=String(data?.reply||data?.response||data?.choices?.[0]?.message?.content||"").trim();
      }
      const reply=answer.slice(0,4000);
      if(!reply)throw new Error("Empty reply");
      const token=await decrypt(connection.token_enc);
      await sendWhatsApp(ids[0],token,customer,{type:"text",text:{body:reply}},String(msg.id));
      for(const product of commerce?.products||[])await sendProductImage(ids[0],token,customer,product);
      if(commerce?.link)await sendWhatsApp(ids[0],token,customer,{type:"text",text:{body:commerce.link}});
      const remembered=commerce?.products?.length?`${reply}\n${commerce.products.map(productLine).join("\n")}`:commerce?.link?`${reply}\n${commerce.link}`:reply;
      await db.from("telegram_whatsapp_messages").update({reply_text:remembered.slice(0,4000)}).eq("message_id",String(msg.id));
    }catch(e){console.error("WhatsApp reply failed",String(e));await db.from("telegram_whatsapp_messages").delete().eq("message_id",String(msg.id));return new Response("Retry later",{status:503})}
  }
  return new Response("OK");
});
