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
    const {error:duplicate}=await db.from("telegram_whatsapp_messages").insert({message_id:String(msg.id),phone_number_id:ids[0]});
    if(duplicate)continue;
    try{
      const [{data:business},{data:catalog},{data:faqs}]=await Promise.all([
        db.from("telegram_business_profiles").select("business_name,assistant_name,business_details,business_hours,payment_options").eq("telegram_user_id",connection.telegram_user_id).maybeSingle(),
        db.from("telegram_business_catalog").select("name,price,currency,details").eq("telegram_user_id",connection.telegram_user_id).eq("available",true).limit(30),
        db.from("telegram_business_faqs").select("question,answer").eq("telegram_user_id",connection.telegram_user_id).limit(30)
      ]);
      const ai=await fetch(`${url}/functions/v1/tivals-ai-chat`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${serviceKey}`},body:JSON.stringify({model:"tivals-ai",business_profile:{...business,catalog,faqs},messages:[{role:"user",content:String(msg.text?.body||"").slice(0,3000)}]})});
      if(!ai.ok)throw new Error("AI unavailable");
      const data=await ai.json();if(["ALL_PROVIDERS_FAILED","NO_PROVIDER_KEYS"].includes(String(data?.code||"")))throw new Error("AI provider unavailable");
      const reply=String(data?.reply||data?.response||data?.choices?.[0]?.message?.content||"").trim().slice(0,4000);
      if(!reply)throw new Error("Empty AI reply");
      const token=await decrypt(connection.token_enc);
      const sent=await fetch(`https://graph.facebook.com/v23.0/${ids[0]}/messages`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:String(msg.from),type:"text",text:{body:reply},context:{message_id:String(msg.id)}})});
      if(!sent.ok)throw new Error(`Meta send failed: ${sent.status}`);
    }catch(e){console.error("WhatsApp reply failed",String(e));await db.from("telegram_whatsapp_messages").delete().eq("message_id",String(msg.id));return new Response("Retry later",{status:503})}
  }
  return new Response("OK");
});
