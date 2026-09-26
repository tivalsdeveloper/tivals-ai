import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url=Deno.env.get("SUPABASE_URL")||"";
const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const headers={"access-control-allow-origin":"*","access-control-allow-methods":"GET,HEAD,OPTIONS","cache-control":"no-store","content-type":"application/json; charset=utf-8"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const installUrl="https://pypi.org/project/tiveltext/";
let packageStats:{expires:number;day:number;month:number}|null=null;
async function pypiDownloads(){
  if(packageStats&&packageStats.expires>Date.now())return {last_day:packageStats.day,last_month:packageStats.month};
  try{
    const response=await fetch("https://pypistats.org/api/packages/tiveltext/recent",{signal:AbortSignal.timeout(4000)});
    if(!response.ok)return null;
    const payload=await response.json();
    const day=Number(payload?.data?.last_day),month=Number(payload?.data?.last_month);
    if(!Number.isFinite(day)||!Number.isFinite(month))return null;
    packageStats={expires:Date.now()+12*60*60*1000,day,month};
    return {last_day:day,last_month:month};
  }catch{return null;}
}
function currentWindows(){
  const now=new Date();
  const local=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Johannesburg",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const values=Object.fromEntries(local.map(part=>[part.type,part.value]));
  return {hour:`${values.year}-${values.month}-${values.day} ${values.hour}:00`,day:`${values.year}-${values.month}-${values.day}`,month:`${values.year}-${values.month}`};
}
async function hash(input:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");}

Deno.serve(async request=>{
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(!["GET","HEAD"].includes(request.method))return reply({error:"Method not allowed"},405);
  const action=new URL(request.url).searchParams.get("download");
  if(action){
    if(action!=="tiveltext")return reply({error:"Unknown project"},404);
    if(request.method==="HEAD")return new Response(null,{status:302,headers:{location:installUrl,"cache-control":"no-store"}});
    const ip=request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
    const hour=new Date().toISOString().slice(0,13);
    const visitor=await hash(`${ip}|${hour}|${key}`);
    await db.from("project_download_clicks").upsert({project:"tiveltext",hour_bucket:hour,visitor_hash:visitor},{onConflict:"project,hour_bucket,visitor_hash",ignoreDuplicates:true});
    return new Response(null,{status:302,headers:{location:installUrl,"cache-control":"no-store"}});
  }
  const windows=currentWindows();
  const [hourResult,dayResult,monthResult,{count:botCount,error:botError},downloads]=await Promise.all([
    db.from("project_download_clicks").select("id",{head:true,count:"exact"}).eq("project","tiveltext").gte("clicked_at",`${windows.day}T${windows.hour.slice(11,13)}:00:00+02:00`),
    db.from("project_download_clicks").select("id",{head:true,count:"exact"}).eq("project","tiveltext").gte("clicked_at",`${windows.day}T00:00:00+02:00`),
    db.from("project_download_clicks").select("id",{head:true,count:"exact"}).eq("project","tiveltext").gte("clicked_at",`${windows.month}-01T00:00:00+02:00`),
    db.from("telegram_owned_bots").select("telegram_user_id",{head:true,count:"exact"}).eq("is_active",true),
    pypiDownloads()
  ]);
  if(hourResult.error||dayResult.error||monthResult.error||botError)return reply({error:"Statistics temporarily unavailable"},503);
  const counts={hour:hourResult.count||0,day:dayResult.count||0,month:monthResult.count||0};
  return reply({tracked_download_clicks:counts,pypi_downloads:downloads,connected_bot_accounts:botCount||0,as_of:new Date().toISOString(),timezone:"Africa/Johannesburg",note:"PyPI downloads update daily and cover rolling 24-hour and 30-day periods. Hourly link visits count unique visitors from this site, not completed installations."});
});
