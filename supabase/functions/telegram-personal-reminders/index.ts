import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const sb=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});}
function unb64(value:string){const raw=atob(value),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
async function aesKey(){const digest=await crypto.subtle.digest("SHA-256",enc.encode(SERVICE_KEY));return crypto.subtle.importKey("raw",digest,"AES-GCM",false,["decrypt"]);}
async function decrypt(value:string){const bytes=unb64(value),iv=bytes.slice(0,12),cipher=bytes.slice(12);const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},await aesKey(),cipher);return new TextDecoder().decode(plain);}
async function sendTelegram(token:string,chatId:number,message:string){
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chatId,text:`⏰ <b>Reminder</b>\n\n${escapeHtml(message)}`,parse_mode:"HTML"})});
  const d=await r.json().catch(()=>({}));if(!r.ok||d?.ok===false)throw new Error(String(d?.description||"Telegram send failed."));
}
function escapeHtml(value:string){return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");}

Deno.serve(async req=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const staleBefore=new Date(Date.now()-10*60_000).toISOString();
  await sb.from("telegram_personal_reminders").update({status:"pending",updated_at:new Date().toISOString()}).eq("status","sending").lt("updated_at",staleBefore).lt("attempts",3);
  const {data:due,error}=await sb.from("telegram_personal_reminders").select("id,bot_owner_id,chat_id,message,attempts").eq("status","pending").lte("remind_at",new Date().toISOString()).lt("attempts",3).order("remind_at").limit(50);
  if(error)return json({error:"Could not load reminders."},500);
  let sent=0,failed=0,skipped=0;
  for(const item of due||[]){
    const claimedAt=new Date().toISOString();
    const {data:claimed,error:claimError}=await sb.from("telegram_personal_reminders").update({status:"sending",updated_at:claimedAt}).eq("id",item.id).eq("status","pending").select("id").maybeSingle();
    if(claimError||!claimed){skipped+=1;continue;}
    try{
      const {data:bot,error:botError}=await sb.from("telegram_owned_bots").select("token_enc,is_active").eq("telegram_user_id",item.bot_owner_id).maybeSingle();
      if(botError||!bot?.is_active||!bot?.token_enc)throw new Error("The personal bot is not connected.");
      await sendTelegram(await decrypt(String(bot.token_enc)),Number(item.chat_id),String(item.message));
      const {error:sentError}=await sb.from("telegram_personal_reminders").update({status:"sent",sent_at:new Date().toISOString(),updated_at:new Date().toISOString(),last_error:null}).eq("id",item.id).eq("status","sending");
      if(sentError)throw sentError;sent+=1;
    }catch(error){
      const attempts=Number(item.attempts||0)+1,lastError=String((error as Error)?.message||error).slice(0,500);
      await sb.from("telegram_personal_reminders").update({status:attempts>=3?"failed":"pending",attempts,last_error:lastError,updated_at:new Date().toISOString()}).eq("id",item.id).eq("status","sending");failed+=1;
    }
  }
  return json({ok:true,processed:(due||[]).length,sent,failed,skipped});
});
