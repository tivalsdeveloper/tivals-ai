import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { loadPulse } from "./fetch.ts";

const headers={
  "access-control-allow-origin":"https://tivalsdeveloper.site",
  "access-control-allow-methods":"GET,OPTIONS",
  "access-control-allow-headers":"content-type",
  "content-type":"application/json; charset=utf-8",
  "cache-control":"public, max-age=60, s-maxage=300"
};

Deno.serve(async request=>{
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(request.method!=="GET")return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers});
  try{return new Response(JSON.stringify(await loadPulse()),{status:200,headers});}
  catch(error){console.error("Pulse data unavailable",error);return new Response(JSON.stringify({error:"Live library statistics are temporarily unavailable"}),{status:503,headers:{...headers,"cache-control":"no-store"}});}
});
