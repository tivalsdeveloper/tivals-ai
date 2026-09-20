import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TELEGRAM_API="https://api.telegram.org";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const WEBHOOK_URL=SUPABASE_URL+"/functions/v1/tivals-telegram";
const OWNED_WEBHOOK_URL=SUPABASE_URL+"/functions/v1/tivals-user-telegram";
const APP_URL="https://ai.tivalsdeveloper.site/telegram-app.html";
const sb=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function unb64(value:string){const raw=atob(value);const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
async function aesKey(){const digest=await crypto.subtle.digest("SHA-256",enc.encode(SERVICE_KEY));return crypto.subtle.importKey("raw",digest,"AES-GCM",false,["decrypt"]);}
async function decrypt(value:string){const bytes=unb64(value),iv=bytes.slice(0,12),cipher=bytes.slice(12);const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},await aesKey(),cipher);return new TextDecoder().decode(plain);}
async function botCall(token:string,method:string,payload?:Record<string,unknown>){
  const r=await fetch(TELEGRAM_API+"/bot"+token+"/"+method,payload?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}:undefined);
  const d=await r.json().catch(()=>({}));if(!r.ok||d?.ok===false)throw new Error(d?.description||method+" failed");return d;
}
async function syncOwnedBots(){
  const {data,error}=await sb.from("telegram_owned_bots").select("telegram_user_id,token_enc,webhook_secret_enc").eq("is_active",true);
  if(error)throw error;
  let synced=0;const errors:string[]=[];
  for(const row of data||[]){
    try{
      const [token,secret]=await Promise.all([decrypt(String(row.token_enc||"")),decrypt(String(row.webhook_secret_enc||""))]);
      await botCall(token,"setWebhook",{url:OWNED_WEBHOOK_URL+"?tg_owner="+encodeURIComponent(String(row.telegram_user_id)),secret_token:secret,allowed_updates:["message","business_message","business_connection"],drop_pending_updates:false});
      await botCall(token,"setChatMenuButton",{menu_button:{type:"web_app",text:"Tivals AI",web_app:{url:APP_URL}}});
      await botCall(token,"setMyCommands",{commands:[
        {command:"start",description:"Start Tivals AI"},
        {command:"app",description:"Open Tivals AI app"},
        {command:"connect",description:"Connect Gmail, GitHub and TikTok"},
        {command:"accounts",description:"View connected tools"}
      ]});
      synced++;
    }catch(e){errors.push(String((e as Error)?.message||e).slice(0,180));}
  }
  return {synced,failed:errors.length,errors};
}
Deno.serve(async()=>{
  const token=Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
  const secret=Deno.env.get("TELEGRAM_WEBHOOK_SECRET")||"";
  if(!token)return json({ok:false,error:"missing bot token"},500);
  const allowed_updates=["message","business_message","business_connection"];
  const payload:any={url:WEBHOOK_URL,allowed_updates,drop_pending_updates:false};
  if(secret)payload.secret_token=secret;
  const setResult=await botCall(token,"setWebhook",payload);
  const info=await botCall(token,"getWebhookInfo");
  const owned=await syncOwnedBots();
  return json({ok:true,allowed_updates,telegram:setResult,webhook_info:info,owned_bots:owned});
});