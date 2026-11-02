import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const isNewsQuery=(query:string)=>/\b(news|headlines|breaking)\b/i.test(query)||(/\b(latest|recent|today|this week|current)\b/i.test(query)&&/\b(cybersecurity|cyber security|technology|tech|security|artificial intelligence|science|business|world|politics|gaming|finance)\b/i.test(query));
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const key=Deno.env.get("SERPER_API_KEY");
    if(!key)return json({error:"SERPER_API_KEY is not configured"},500);
    const body=await req.json().catch(()=>({}));
    const query=String(body.query||body.q||"").trim();
    if(!query)return json({error:"query is required"},400);
    const num=Math.min(Math.max(Number(body.num||8),1),10);
    const news=isNewsQuery(query);
    const request=async(url:string)=>await fetch(url,{method:"POST",headers:{"X-API-KEY":key,"Content-Type":"application/json"},body:JSON.stringify({q:query,num})});
    let response=await request(news?"https://google.serper.dev/news":"https://google.serper.dev/search");
    let data=await response.json().catch(()=>({}));
    if(!response.ok)return json({error:data?.message||data?.error||("Serper search failed ("+response.status+")"),providerStatus:response.status},response.status);
    let raw=news?(Array.isArray(data.news)?data.news:[]):(Array.isArray(data.organic)?data.organic:[]);
    let resultType=news?"news":"web";
    if(news&&!raw.length){
      response=await request("https://google.serper.dev/search");
      data=await response.json().catch(()=>({}));
      if(!response.ok)return json({error:data?.message||data?.error||("Serper search failed ("+response.status+")"),providerStatus:response.status},response.status);
      raw=Array.isArray(data.organic)?data.organic:[];
      resultType="web-fallback";
    }
    const results=raw.slice(0,num).map((x:any)=>({
      title:x.title||"",
      url:x.link||x.url||"",
      snippet:x.snippet||x.description||"",
      date:x.date||x.datePublished||"",
      source:x.source||x.publisher||"",
      ...(x.imageUrl?{imageUrl:x.imageUrl}:{})
    })).filter((x:any)=>x.title&&x.url);
    return json({query,resultType,answerBox:data.answerBox||null,knowledgeGraph:data.knowledgeGraph||null,results});
  }catch(e){
    console.error("web-search",e);
    return json({error:e instanceof Error?e.message:"Web search failed"},500);
  }
});