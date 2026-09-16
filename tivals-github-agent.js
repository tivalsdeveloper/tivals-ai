(()=>{
const ENDPOINT='https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/github-agent';
const state={repos:[],repo:null,branch:'main',path:''};
async function call(payload){
  const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({success:false,error:'Invalid server response'}));
  if(!r.ok||data.success===false)throw new Error(data.error||`GitHub request failed (${r.status})`);
  return data;
}
async function repos(){const d=await call({action:'list_repos'});state.repos=d.repositories||[];return state.repos;}
async function files(full,path='',branch){const [owner,repo]=full.split('/');return call({action:'list_files',owner,repo,path,branch:branch||state.branch});}
async function read(full,path,branch){const [owner,repo]=full.split('/');return call({action:'read_file',owner,repo,path,branch:branch||state.branch});}
async function branch(full,newBranch,source='main'){const [owner,repo]=full.split('/');return call({action:'create_branch',owner,repo,source_branch:source,new_branch:newBranch});}
async function create(full,path,content,branchName,message){const [owner,repo]=full.split('/');return call({action:'create_file',owner,repo,path,content,branch:branchName,message:message||`Create ${path} with Tivals AI`});}
async function update(full,path,content,branchName,message){const [owner,repo]=full.split('/');return call({action:'update_file',owner,repo,path,content,branch:branchName,message:message||`Update ${path} with Tivals AI`});}
function githubIntent(q=''){
  return /\bgithub\b/i.test(q)||/\b(repositor(?:y|ies)|repos?)\b/i.test(q)||/\b(list|show|read|open)\b.*\b(files?|branches?)\b/i.test(q);
}
function repoFrom(q=''){
  const full=q.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);if(full)return full[1];
  if(state.repo)return state.repo;
  const name=q.match(/\b(?:repo(?:sitory)?|in|from)\s+["'`]?([A-Za-z0-9_.-]+)["'`]?/i);
  if(name&&state.repos.length){const hit=state.repos.find(r=>(r.name||'').toLowerCase()===name[1].toLowerCase());if(hit)return hit.full_name||hit.name;}
  return '';
}
function listFromData(d){return d.files||d.items||d.entries||d.contents||d.content||[];}
async function handlePrompt(q=''){
  q=String(q).trim();if(!githubIntent(q))return{handled:false};
  if(/\b(list|show|what|which)\b.*\b(repositor(?:y|ies)|repos?)\b/i.test(q)||/\bmy\s+github\b/i.test(q)){
    const rs=await repos();return{handled:true,text:rs.length?'Your connected GitHub repositories:\n\n'+rs.map(r=>'- '+(r.full_name||r.name)).join('\n'):'No repositories were returned by your GitHub connection.'};
  }
  const repo=repoFrom(q);if(!repo)return{handled:true,text:'Tell me which GitHub repository to use, for example: `tivalsdeveloper/tivals-ai`.'};
  state.repo=repo;
  if(/\b(list|show)\b.*\bfiles?\b/i.test(q)){
    const path=(q.match(/\bpath\s+["'`]?([^\s"'`]+)["'`]?/i)||[])[1]||'';const d=await files(repo,path);const xs=listFromData(d);return{handled:true,text:Array.isArray(xs)&&xs.length?`Files in ${repo}${path?' / '+path:''}:\n\n`+xs.map(x=>'- '+(x.path||x.name||String(x))).join('\n'):`No files were returned for ${repo}${path?' / '+path:''}.`};
  }
  const fm=q.match(/\b(?:read|open|show)\s+(?:file\s+)?["'`]?([^\s"'`]+\.[A-Za-z0-9]+)["'`]?/i);
  if(fm){const d=await read(repo,fm[1]);const body=d.content||d.text||'';return{handled:true,text:body?`GitHub file: ${repo}/${fm[1]}\n\n\`\`\`\n${body}\n\`\`\``:`I opened ${repo}/${fm[1]}, but no text content was returned.`};}
  return{handled:false};
}
function show(role,text){if(typeof window.add==='function')return window.add(role,text);console.log('[Tivals GitHub]',role,text);}
let running=false;
async function intercept(e){
  const send=e.type==='click'?e.target.closest?.('#send'):e.type==='keydown'&&e.key==='Enter'&&!e.shiftKey&&e.target?.matches?.('#prompt');if(!send||running)return;
  const box=document.querySelector('#prompt'),q=box?.value?.trim();if(!q||!githubIntent(q))return;
  e.preventDefault();e.stopImmediatePropagation();running=true;box.value='';show('user',q);const wait=show('ai','Checking your connected GitHub account…');
  try{const out=await handlePrompt(q);if(!out.handled)throw new Error('I recognized a GitHub request, but need a repository or file action.');if(wait?.remove)wait.remove();show('ai',out.text);}catch(err){if(wait?.remove)wait.remove();show('ai','GitHub connection error: '+(err.message||err));}finally{running=false;}
}
document.addEventListener('click',intercept,true);document.addEventListener('keydown',intercept,true);
window.TivalsGitHub={call,repos,files,read,branch,create,update,githubIntent,handlePrompt,state};
window.dispatchEvent(new CustomEvent('tivals-github-ready'));
})();