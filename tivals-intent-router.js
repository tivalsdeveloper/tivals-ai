/* Tivals AI semantic intent router: prevents stale GitHub context from hijacking normal chat. */
(()=>{
  const AI='https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/tivals-ai-chat';
  let routing=false;
  const explicitGithub=q=>/\b(github|repos?|repositor(?:y|ies)|branch(?:es)?|commit|pull request|\bpr\b|clone|push|merge|fork)\b/i.test(q)||/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/.test(q)||/\b[\w./-]+\.(?:js|ts|tsx|jsx|html|css|py|cpp|cc|c|h|hpp|java|go|rs|php|rb|json|md|yml|yaml|sh)\b/i.test(q);
  const clearlyGeneral=q=>/\b(essay|poem|story|letter|paragraph|homework|explain|define|meaning|translate|summari[sz]e|recipe|weather|news|math|calculate|who is|what is|why is|how does)\b/i.test(q)&&!explicitGithub(q);
  const githubVerb=q=>/\b(read|check|inspect|list|show|open|update|upgrade|edit|modify|fix|refactor|create|add|delete|remove)\b/i.test(q);
  async function classify(q){
    if(explicitGithub(q))return'github';
    if(clearlyGeneral(q))return'general';
    const gh=window.TivalsGitHub?.state;
    if(!gh?.repo||!githubVerb(q))return'general';
    try{
      const model=document.querySelector('#model')?.value||'';
      const prompt=`Classify the user's intent for a chat application. Return exactly one word: github or general.\nUse github only when the user actually wants to inspect, create, modify, list, link, commit, or otherwise operate on a GitHub repository/file. A previously active repository is context, not proof that a new unrelated request is about GitHub.\nActive repository: ${gh.repo||'none'}\nActive file: ${gh.path||'none'}\nUser message: ${q}`;
      const headers=window.tivalsAiHeaders?await window.tivalsAiHeaders():{'Content-Type':'application/json'};
      const r=await fetch(AI,{method:'POST',headers,body:JSON.stringify({model,messages:[{role:'user',content:prompt}]})});
      const d=await r.json().catch(()=>({})),a=String(d.reply||'').trim().toLowerCase();
      return a.startsWith('github')?'github':'general';
    }catch{return explicitGithub(q)?'github':'general'}
  }
  function normalSend(){
    if(typeof window.send==='function'){window.send();return true}
    const b=document.querySelector('#send');
    if(b){b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return true}
    return false;
  }
  async function intercept(e){
    if(routing)return;
    const hit=e.type==='click'?e.target.closest?.('#send'):e.type==='keydown'&&e.key==='Enter'&&!e.shiftKey&&e.target?.matches?.('#prompt');
    if(!hit)return;
    const box=document.querySelector('#prompt'),q=box?.value?.trim();if(!q)return;
    if(explicitGithub(q))return;
    if(!window.TivalsGitHub?.state?.repo)return;
    // Take ownership only when stale GitHub context could otherwise hijack the message.
    if(!clearlyGeneral(q)&&!githubVerb(q))return;
    e.preventDefault();e.stopImmediatePropagation();routing=true;
    try{
      const route=await classify(q);
      if(route==='github'){
        // Re-dispatch once while routing=true so this guard stands aside and the GitHub agent handles it.
        if(e.type==='keydown')document.querySelector('#send')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        else e.target.closest?.('#send')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      }else normalSend();
    }finally{setTimeout(()=>{routing=false},0)}
  }
  document.addEventListener('click',intercept,true);
  document.addEventListener('keydown',intercept,true);
  window.TivalsIntentRouter={classify,explicitGithub,clearlyGeneral};
})();
