import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const TELEGRAM_API="https://api.telegram.org";
const WEBHOOK_URL="https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/tivals-telegram";
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
Deno.serve(async()=>{
  const token=Deno.env.get("TELEGRAM_BOT_TOKEN")||"";
  const secret=Deno.env.get("TELEGRAM_WEBHOOK_SECRET")||"";
  if(!token)return json({ok:false,error:"missing bot token"},500);
  const allowed_updates=["message","business_message","business_connection"];
  const payload:any={url:WEBHOOK_URL,allowed_updates,drop_pending_updates:false};
  if(secret)payload.secret_token=secret;
  const setResponse=await fetch(TELEGRAM_API+"/bot"+token+"/setWebhook",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  const setResult=await setResponse.json().catch(()=>({}));
  const infoResponse=await fetch(TELEGRAM_API+"/bot"+token+"/getWebhookInfo");
  const info=await infoResponse.json().catch(()=>({}));
  return json({ok:setResponse.ok&&setResult?.ok!==false,allowed_updates,telegram:setResult,webhook_info:info},setResponse.ok?200:500);
});