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
      await botCall(token,"setWebhook",{url:OWNED_WEBHOOK_URL+"?tg_owner="+encodeURIComponent(String(row.telegram_user_id)),secret_token:secret,allowed_updates:["message","business_message","business_connection","callback_query"],drop_pending_updates:false});
      await botCall(token,"setChatMenuButton",{menu_button:{type:"web_app",text:"Tivals AI",web_app:{url:APP_URL}}});
      await botCall(token,"setMyCommands",{commands:[
        {command:"start",description:"Start a conversation"},{command:"help",description:"Show commands and AI tools"},{command:"ask",description:"Ask in a group or channel"},
        {command:"newchat",description:"Start a fresh private chat"},{command:"chats",description:"Continue a previous private chat"},{command:"remind",description:"Create a personal reminder"},{command:"reminders",description:"View upcoming reminders"},
        {command:"lesson",description:"Start a lesson on a topic"},{command:"explain",description:"Explain a concept clearly"},{command:"quiz",description:"Create a short quiz"},{command:"practice",description:"Give practice questions"},
        {command:"search",description:"Search the live web"},{command:"tools",description:"Show all @ AI tools"},{command:"app",description:"Open the owner dashboard"},{command:"dashboard",description:"Open the owner dashboard"},{command:"settings",description:"Open bot settings"},
        {command:"grouphelp",description:"How to use this bot in groups"},{command:"connect",description:"Owner: connect tools"},{command:"accounts",description:"Owner: view connected tools"},
        {command:"emails",description:"Owner: show recent Gmail"},{command:"unread",description:"Owner: show unread Gmail"},{command:"sendemail",description:"Owner: prepare an email"},
        {command:"disconnect_gmail",description:"Owner: disconnect Gmail"},{command:"disconnect_github",description:"Owner: disconnect GitHub"},{command:"disconnect_website",description:"Owner: disconnect website"}
      ]});
      synced++;
    }catch(e){errors.push(String((e as Error)?.message||e).slice(0,180));}
  }
  return {synced,failed:errors.length,errors};
}
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"Method not allowed"},405);
  const syncSecret=Deno.env.get("TELEGRAM_SYNC_SECRET")||SERVICE_KEY;
  if(!syncSecret||req.headers.get("authorization")!==`Bearer ${syncSecret}`)return json({ok:false,error:"Unauthorized"},401);
  const token=Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
  const secret=Deno.env.get("TELEGRAM_WEBHOOK_SECRET")||"";
  if(!token)return json({ok:false,error:"missing bot token"},500);
  if(!secret)return json({ok:false,error:"missing webhook secret"},500);
  const allowed_updates=["message","business_message","business_connection","callback_query"];
  const payload:any={url:WEBHOOK_URL,allowed_updates,drop_pending_updates:false};
  payload.secret_token=secret;
  await botCall(token,"setWebhook",payload);
  await botCall(token,"setChatMenuButton",{menu_button:{type:"web_app",text:"Tivals AI",web_app:{url:APP_URL}}});
  await botCall(token,"setMyCommands",{commands:[
    {command:"start",description:"Start Tivals AI"},
    {command:"app",description:"Open Tivals AI app"},
    {command:"connect",description:"Connect Gmail, GitHub and TikTok"},
    {command:"accounts",description:"View connected tools"},
    {command:"tools",description:"Show available AI tools"}
  ]});
  const owned=await syncOwnedBots();
  return json({ok:true,allowed_updates,main_bot_synced:true,owned_bots:owned});
});
