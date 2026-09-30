import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
import {dueActions,redact} from "./business-flow.mjs";

const URL=Deno.env.get('SUPABASE_URL')||'';
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const encoder=new TextEncoder();
async function decrypt(value:string){
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0)),iv=bytes.slice(0,12);
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(KEY));
  const key=await crypto.subtle.importKey('raw',digest,'AES-GCM',false,['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,bytes.slice(12)));
}
async function send(token:string,row:any,text:string,markup?:any,owner=false){
  const payload={chat_id:owner?row.business_id:row.chat_id,text:redact(text),...(markup?{reply_markup:markup}:{}),...(!owner&&row.business_connection_id?{business_connection_id:row.business_connection_id}:{})};
  const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const result=await response.json().catch(()=>({}));if(!response.ok||!result.ok)throw new Error('Telegram delivery failed');
}
Deno.serve(async request=>{
  // Only service-role callers (scheduled jobs) may process customer records.
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  const supplied=request.headers.get('x-business-job-token')||'';
  const {data:config}=await db.from('telegram_business_job_config').select('token_sha256').eq('id',true).maybeSingle();
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(supplied));
  const hex=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  if(!supplied||!config?.token_sha256||hex!==config.token_sha256)return new Response('Unauthorized',{status:401});
  const {data:rows,error}=await db.rpc('telegram_due_business_requests',{p_now:new Date().toISOString()});
  if(error)return new Response('Could not load jobs',{status:500});
  let sent=0,failed=0;
  for(const row of rows||[]){
    const actions=dueActions(row);
    if(!actions.length)continue;
    try{
      const {data:bot}=await db.from('telegram_owned_bots').select('token_enc,is_active').eq('telegram_user_id',row.business_id).maybeSingle();
      if(!bot?.is_active||!bot.token_enc)continue;
      const token=await decrypt(bot.token_enc),now=new Date().toISOString();
      if(!row.owner_notified_at){
        const {data:settings}=await db.from('telegram_user_settings').select('notifications').eq('telegram_user_id',row.business_id).maybeSingle();
        const mandatory=['urgent','complaint','handoff'].includes(row.request_type);
        if(mandatory||settings?.notifications!==false){
          await send(token,row,`📨 ${row.request_type.toUpperCase()} · ${row.priority.toUpperCase()}\nReference: ${row.reference}\nCustomer: ${redact(row.customer_name||'Unknown')} ${row.customer_username?'@'+redact(row.customer_username):''} ${redact(row.customer_phone||'')}\nSummary: ${redact(row.summary)}\nAction needed: Review and respond.`,{inline_keyboard:[[{text:'✅ Confirm',callback_data:`confirm:${row.reference}`},{text:'❌ Decline',callback_data:`decline:${row.reference}`}],[{text:'🕒 Suggest new time',callback_data:`suggest:${row.reference}`},{text:'💬 Message customer',callback_data:`message:${row.reference}`}]]},true);
          sent++;
        }
        await db.from('telegram_business_requests').update({owner_notified_at:now}).eq('id',row.id).eq('business_id',row.business_id).is('owner_notified_at',null);
      }

      if(actions.includes('owner_reminder')){
        const {data:claim}=await db.from('telegram_business_requests').update({timeout_stage:1,updated_at:now}).eq('id',row.id).eq('business_id',row.business_id).eq('status','pending').eq('timeout_stage',0).select('id').maybeSingle();
        if(claim){try{await send(token,row,`⏰ Request ${row.reference} is still pending. Please confirm or decline it.`,undefined,true);await send(token,row,`Your request ${row.reference} is still pending. We're waiting for the business to respond.`);sent+=2;}catch(e){await db.from('telegram_business_requests').update({timeout_stage:0}).eq('id',row.id).eq('business_id',row.business_id).eq('timeout_stage',1);throw e;}}
      }else if(actions.includes('customer_options')){
        const {data:claim}=await db.from('telegram_business_requests').update({timeout_stage:2,updated_at:now}).eq('id',row.id).eq('business_id',row.business_id).eq('status','pending').eq('timeout_stage',1).select('id').maybeSingle();
        if(claim){try{await send(token,row,`Request ${row.reference} is still pending. Would you like to keep waiting or contact the business directly?`,{inline_keyboard:[[{text:'⏳ Keep waiting',callback_data:`cust:wait:${row.reference}`},{text:'📞 Contact us directly',callback_data:`cust:contact:${row.reference}`}]]});sent++;}catch(e){await db.from('telegram_business_requests').update({timeout_stage:1}).eq('id',row.id).eq('business_id',row.business_id).eq('timeout_stage',2);throw e;}}
      }
      if(actions.includes('booking_reminder')){
        const {data:claim}=await db.from('telegram_business_requests').update({booking_reminded_at:now}).eq('id',row.id).eq('business_id',row.business_id).eq('status','confirmed').is('booking_reminded_at',null).select('id').maybeSingle();
        if(claim){try{await send(token,row,`Reminder: your booking ${row.reference} is scheduled for ${new Date(row.starts_at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'})}.`,{inline_keyboard:[[{text:"✅ I'll be there",callback_data:`cust:attend:${row.reference}`},{text:'🕒 Reschedule',callback_data:`cust:change:${row.reference}`}],[{text:'❌ Cancel',callback_data:`cust:cancel:${row.reference}`}]]});sent++;}catch(e){await db.from('telegram_business_requests').update({booking_reminded_at:null}).eq('id',row.id).eq('business_id',row.business_id).eq('booking_reminded_at',now);throw e;}}
      }
      if(actions.includes('rating_request')){
        const {data:claim}=await db.from('telegram_business_requests').update({rating_requested_at:now}).eq('id',row.id).eq('business_id',row.business_id).eq('status','completed').is('rating_requested_at',null).select('id').maybeSingle();
        if(claim){try{await send(token,row,`How was your service for request ${row.reference}?`,{inline_keyboard:[[1,2,3,4,5].map(stars=>({text:`⭐ ${stars}`,callback_data:`rate:${row.reference}:${stars}`}))]});sent++;}catch(e){await db.from('telegram_business_requests').update({rating_requested_at:null}).eq('id',row.id).eq('business_id',row.business_id).eq('rating_requested_at',now);throw e;}}
      }
    }catch{failed++;} // Never log customer details or bot tokens.
  }
  return new Response(JSON.stringify({ok:true,sent,failed}),{headers:{'content-type':'application/json'}});
});
