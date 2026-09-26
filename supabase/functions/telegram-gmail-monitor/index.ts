import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const OAUTH_URL=`${SUPABASE_URL}/functions/v1/telegram-oauth`;
const AI_URL=`${SUPABASE_URL}/functions/v1/tivals-ai-chat`;
const GOOGLE_CLIENT_ID_CONFIGURED=Boolean(Deno.env.get("GOOGLE_CLIENT_ID")||Deno.env.get("GOOGLE_OAUTH_CLIENT_ID"));
const sb=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});}
function unb64(value:string){const raw=atob(value),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
async function aesKey(){const digest=await crypto.subtle.digest("SHA-256",enc.encode(SERVICE_KEY));return crypto.subtle.importKey("raw",digest,"AES-GCM",false,["decrypt"]);}
async function decrypt(value:string){const bytes=unb64(value),iv=bytes.slice(0,12),cipher=bytes.slice(12);const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},await aesKey(),cipher);return new TextDecoder().decode(plain);}
function esc(value:string){return String(value||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");}
function senderAddress(value:string){const angled=value.match(/<([^<>\s]+@[^<>\s]+)>/),plain=value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);return String(angled?.[1]||plain?.[0]||"").toLowerCase();}
function replySubject(value:string){const subject=String(value||"(No subject)").replace(/[\r\n]+/g," ").trim().slice(0,190);return/^re:/i.test(subject)?subject:`Re: ${subject}`;}
async function telegram(token:string,chatId:number,payload:Record<string,unknown>){const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chatId,...payload})});const d=await r.json().catch(()=>({}));if(!r.ok||d?.ok===false)throw new Error(String(d?.description||"Telegram notification failed."));}
async function refreshBotMenus(){const {data}=await sb.from("telegram_owned_bots").select("token_enc").eq("is_active",true).limit(500);let refreshed=0;for(const bot of data||[]){try{const token=await decrypt(String(bot.token_enc)),r=await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({menu_button:{type:"web_app",text:"My Bot",web_app:{url:"https://ai.tivalsdeveloper.site/telegram-app.html?mode=personal&v=20260926-5"}}})});if(r.ok)refreshed+=1;}catch{}}return refreshed;}
async function oauth(tg:number,query:string){const r=await fetch(OAUTH_URL,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${SERVICE_KEY}`},body:JSON.stringify({action:"gmail_messages",telegram_user_id:tg,provider:"gmail",query,max_results:5})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(String(d?.error||"Gmail check failed."));return d;}
async function maintainGmail(){const r=await fetch(OAUTH_URL,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${SERVICE_KEY}`},body:JSON.stringify({action:"gmail_maintain"})});const d=await r.json().catch(()=>({}));return r.ok?d:{ok:false,accounts:0,maintained:0,failed:0};}
async function access(tg:number){
  const {data:admin}=await sb.from("telegram_admins").select("role").eq("telegram_user_id",tg).maybeSingle();if(admin)return{allowed:true,plan:"owner",limit:Number.MAX_SAFE_INTEGER};
  const {data:sub}=await sb.from("telegram_subscriptions").select("plan,status,subscription_expiration_date").eq("telegram_user_id",tg).maybeSingle();
  if(sub&&sub.status==="active"&&["basic","pro"].includes(sub.plan)&&new Date(sub.subscription_expiration_date).getTime()>Date.now())return{allowed:true,plan:String(sub.plan),limit:sub.plan==="pro"?1000:200};
  const {data:trial}=await sb.from("telegram_personal_bot_trials").select("expires_at").eq("telegram_user_id",tg).maybeSingle();return{allowed:Boolean(trial&&new Date(trial.expires_at).getTime()>Date.now()),plan:"trial",limit:20};
}
async function takeAiUsage(tg:number,limit:number){if(!Number.isFinite(limit))return true;const today=new Date().toISOString().slice(0,10),{data}=await sb.from("telegram_daily_usage").select("ai_messages,image_generations").eq("telegram_user_id",tg).eq("usage_date",today).maybeSingle(),used=Number(data?.ai_messages||0);if(used>=limit)return false;const {error}=await sb.from("telegram_daily_usage").upsert({telegram_user_id:tg,usage_date:today,ai_messages:used+1,image_generations:Number(data?.image_generations||0),updated_at:new Date().toISOString()},{onConflict:"telegram_user_id,usage_date"});if(error)throw error;return true;}
async function draftReply(profile:any,message:any){
  const prompt=["Write a concise, natural email reply draft for the user's approval.","Do not claim an action was completed, promise money, share secrets, click links, or accept legal/financial terms.","If the email is unclear, ask one useful question. Return only the email body.",`Assistant personality: ${String(profile?.personality||"Friendly and helpful").slice(0,500)}`,`Sender: ${String(message.from||"").slice(0,500)}`,`Subject: ${String(message.subject||"").slice(0,300)}`,`Email preview: ${String(message.snippet||"").slice(0,1800)}`].join("\n");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);try{const r=await fetch(AI_URL,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${SERVICE_KEY}`},body:JSON.stringify({model:"auto",business_profile:null,messages:[{role:"system",content:"You draft safe personal email replies. The user must confirm before anything is sent."},{role:"user",content:prompt}]}),signal:controller.signal});const d=await r.json().catch(()=>({}));if(!r.ok||!d?.reply)throw new Error(String(d?.error||"AI reply draft failed."));return String(d.reply).trim().slice(0,10000);}finally{clearTimeout(timer);}
}

Deno.serve(async req=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const [maintenance,menusRefreshed]=await Promise.all([maintainGmail(),refreshBotMenus()]);
  const dueBefore=new Date(Date.now()-55*60_000).toISOString();
  const {data:settings,error}=await sb.from("telegram_gmail_monitor_settings").select("telegram_user_id,notify_chat_id,last_checked_at,auto_draft_replies").eq("enabled",true).or(`last_checked_at.is.null,last_checked_at.lt.${dueBefore}`).limit(100);if(error)return json({error:"Could not load Gmail monitors."},500);
  let checked=0,notified=0,drafted=0,failed=0;
  for(const setting of settings||[]){
    const tg=Number(setting.telegram_user_id),chatId=Number(setting.notify_chat_id||tg),started=new Date().toISOString();
    await sb.from("telegram_gmail_monitor_settings").update({last_checked_at:started,updated_at:started}).eq("telegram_user_id",tg).eq("enabled",true);
    try{
      const [{data:bot},{data:profile},entitlement]=await Promise.all([sb.from("telegram_owned_bots").select("token_enc,is_active").eq("telegram_user_id",tg).maybeSingle(),sb.from("telegram_owned_bots").select("bot_name,personality,custom_instructions").eq("telegram_user_id",tg).maybeSingle(),access(tg)]);
      if(!bot?.is_active||!bot?.token_enc)throw new Error("Personal bot is disconnected.");
      const token=await decrypt(String(bot.token_enc));
      if(!entitlement.allowed){await sb.from("telegram_gmail_monitor_settings").update({enabled:false,last_error:"Personal bot trial ended.",updated_at:new Date().toISOString()}).eq("telegram_user_id",tg);await telegram(token,chatId,{text:"⏸ <b>Gmail monitoring paused</b>\n\nYour personal bot trial has ended. Open /app to choose Basic or Pro.",parse_mode:"HTML"});continue;}
      const result=await oauth(tg,"in:inbox is:unread newer_than:2d -from:me"),messages=Array.isArray(result?.messages)?result.messages:[];
      for(const message of messages){
        const event={telegram_user_id:tg,gmail_message_id:String(message.id||""),gmail_thread_id:message.thread_id||null,sender:String(message.from||"Unknown sender").slice(0,500),sender_email:senderAddress(String(message.reply_to||message.from||""))||null,subject:String(message.subject||"(No subject)").slice(0,500),snippet:String(message.snippet||"").slice(0,4000),internet_message_id:String(message.internet_message_id||"").slice(0,1000)||null,email_references:String(message.references||"").slice(0,2000)||null,internal_date:message.internal_date||null,status:"detected"};
        if(!event.gmail_message_id)continue;const inserted=await sb.from("telegram_gmail_monitor_events").insert(event).select("id").maybeSingle();if(inserted.error){if(String(inserted.error.code)==="23505")continue;throw inserted.error;}
        const address=event.sender_email||"",unsafe=!address||/(?:no-?reply|do-?not-?reply|mailer-daemon)@/i.test(address),subject=event.subject;
        if(unsafe||setting.auto_draft_replies===false||!await takeAiUsage(tg,entitlement.limit)){
          await telegram(token,chatId,{text:`📧 <b>New email</b>\n\n<b>From:</b> ${esc(event.sender)}\n<b>Subject:</b> ${esc(subject)}\n\n${esc(event.snippet.slice(0,900))}\n\n<i>Open Gmail or ask @gmail to review it.</i>`,parse_mode:"HTML"});await sb.from("telegram_gmail_monitor_events").update({status:"notified",updated_at:new Date().toISOString()}).eq("id",inserted.data.id);notified+=1;continue;
        }
        const body=await draftReply(profile,message),pendingId=crypto.randomUUID(),inReplyTo=event.internet_message_id||"",references=[event.email_references,inReplyTo].filter(Boolean).join(" ").trim().slice(0,2000);
        const pending={id:pendingId,telegram_user_id:tg,chat_id:chatId,recipient:address,subject:replySubject(subject),body,status:"pending",expires_at:new Date(Date.now()+24*60*60_000).toISOString(),gmail_thread_id:event.gmail_thread_id,in_reply_to:inReplyTo||null,email_references:references||null,source_message_id:event.gmail_message_id};
        const made=await sb.from("telegram_pending_emails").insert(pending);if(made.error)throw made.error;
        await sb.from("telegram_gmail_monitor_events").update({status:"drafted",pending_email_id:pendingId,updated_at:new Date().toISOString()}).eq("id",inserted.data.id);
        await telegram(token,chatId,{text:`📧 <b>New email · AI reply ready</b>\n\n<b>From:</b> ${esc(event.sender)}\n<b>Subject:</b> ${esc(subject)}\n\n<b>Email preview</b>\n${esc(event.snippet.slice(0,700))}\n\n<b>Suggested reply</b>\n${esc(body.slice(0,1500))}\n\n<i>Nothing is sent until you confirm. This approval expires in 24 hours.</i>`,parse_mode:"HTML",reply_markup:{inline_keyboard:[[{text:"✅ Send AI reply",callback_data:`gmail_send:${pendingId}`},{text:"❌ Cancel",callback_data:`gmail_cancel:${pendingId}`}]]}});drafted+=1;notified+=1;
      }
      await sb.from("telegram_gmail_monitor_settings").update({last_success_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("telegram_user_id",tg);checked+=1;
    }catch(error){failed+=1;await sb.from("telegram_gmail_monitor_settings").update({last_error:String((error as Error)?.message||error).slice(0,500),updated_at:new Date().toISOString()}).eq("telegram_user_id",tg);}
  }
  return json({ok:true,accounts:(settings||[]).length,checked,notified,drafted,failed,gmail_connections_maintained:Number(maintenance?.maintained||0),gmail_maintenance_failed:Number(maintenance?.failed||0),menus_refreshed:menusRefreshed,google_client_id_configured:GOOGLE_CLIENT_ID_CONFIGURED});
});
