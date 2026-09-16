(()=>{
const ENDPOINT='https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/github-agent';
const INSTALL='https://github.com/apps/tivals-ai/installations/new';
const SUPABASE_URL='https://kxuszpixwfecawdeqkrx.supabase.co';
const SUPABASE_KEY='sb_publishable__auyhjNpepXiYdGV5HEJ_A_AGsPbBuS';
const state={repos:[],repo:null,branch:'main',path:''};
let githubSb=null;
function authClient(){
  if(window.sb?.auth)return window.sb;
  if(githubSb?.auth)return githubSb;
  if(window.supabase?.createClient){
    githubSb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    return githubSb;
  }
  return null;
}
async function session(){try{const client=authClient();if(!client?.auth)return null;const {data}=await client.auth.getSession();return data?.session||null}catch{return null}}
async function waitForSession(timeout=5000){const start=Date.now();while(Date.now()-start<timeout){const s=await session();if(s)return s;await new Promise(r=>setTimeout(r,250))}return null}
async function authHeaders(){const h={'Content-Type':'application/json'};const s=await session();if(s?.access_token)h.Authorization='Bearer '+s.access_token;return h;}
async function call(payload){const r=await fetch(ENDPOINT,{method:'POST',headers:await authHeaders(),body:JSON.stringify(payload)});const data=await r.json().catch(()=>({success:false,error:'Invalid server response'}));if(!r.ok||data.success===false){const e=new Error(data.error||`GitHub request failed (${r.status})`);e.status=r.status;e.code=data.code;throw e;}return data;}
async function repos(){const d=await call({action:'list_repos'});state.repos=d.repositories||[];return state.repos;}
async function files(full,path='',branch){const [owner,repo]=full.split('/');return call({action:'list_files',owner,repo,path,branch:branch||state.branch});}
async function read(full,path,branch){const [owner,repo]=full.split('/');return call({action:'read_file',owner,repo,path,branch:branch||state.branch});}
async function branch(full,newBranch,source='main'){const [owner,repo]=full.split('/');return call({action:'create_branch',owner,repo,source_branch:source,new_branch:newBranch});}
async function create(full,path,content,branchName,message){const [owner,repo]=full.split('/');return call({action:'create_file',owner,repo,path,content,branch:branchName,message:message||`Create ${path} with Tivals AI`});}
async function update(full,path,content,branchName,message){const [owner,repo]=full.split('/');return call({action:'update_file',owner,repo,path,content,branch:branchName,message:message||`Update ${path} with Tivals AI`});}
function githubIntent(q=''){return /\bgithub\b/i.test(q)||/\b(repositor(?:y|ies)|repos?)\b/i.test(q)||/\b(list|show|read|open)\b.*\b(files?|branches?)\b/i.test(q);}
function repoFrom(q=''){const full=q.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);if(full)return full[1];if(state.repo)return state.repo;return '';}
function listFromData(d){return d.files||d.items||d.entries||d.contents||d.content||[];}
async function handlePrompt(q=''){q=String(q).trim();if(!githubIntent(q))return{handled:false};if(/\b(list|show|what|which)\b.*\b(repositor(?:y|ies)|repos?)\b/i.test(q)||/\bmy\s+github\b/i.test(q)){const rs=await repos();return{handled:true,text:rs.length?'Your connected GitHub repositories:\n\n'+rs.map(r=>'- '+(r.full_name||r.name)).join('\n'):'No repositories were returned by your GitHub connection.'};}const repo=repoFrom(q);if(!repo)return{handled:true,text:'Tell me which GitHub repository to use, for example: `tivalsdeveloper/tivals-ai`.'};state.repo=repo;if(/\b(list|show)\b.*\bfiles?\b/i.test(q)){const d=await files(repo,'');const xs=listFromData(d);return{handled:true,text:xs.length?`Files in ${repo}:\n\n`+xs.map(x=>'- '+(x.path||x.name)).join('\n'):`No files were returned for ${repo}.`};}return{handled:false};}
function show(role,text){if(typeof window.add==='function')return window.add(role,text);console.log('[Tivals GitHub]',role,text);}
async function bindInstallation(id){const s=await waitForSession();if(!s)return false;try{const d=await call({action:'connect_installation',installation_id:Number(id)});show('ai',`✓ GitHub connected${d.account_login?' as '+d.account_login:''}. You can now access your repositories.`);return true}catch(e){console.error('[Tivals GitHub] bind failed',e);return false}}
async function openConnect(){const s=await waitForSession(1500);if(!s){show('ai','Please sign in to Tivals AI before connecting GitHub.');return}sessionStorage.setItem('tivals-github-return',location.href.split('?')[0]);location.href=INSTALL;}
function addConnectButton(){if(document.querySelector('#githubConnect'))return;const host=document.querySelector('.sideTools')||document.querySelector('.tools');if(!host)return;const b=document.createElement('button');b.id='githubConnect';b.type='button';b.className=host.classList.contains('sideTools')?'sideTool':'toolBtn';b.textContent='Connect GitHub';b.onclick=openConnect;host.appendChild(b);}
function cleanInstallParams(){const p=new URLSearchParams(location.search);p.delete('installation_id');p.delete('setup_action');history.replaceState({},'',location.pathname+(p.toString()?'?'+p:'')+location.hash)}
async function finishInstall(){const p=new URLSearchParams(location.search),id=p.get('installation_id');if(!id)return;const s=await waitForSession();if(!s){show('ai','Your GitHub App returned successfully, but your Tivals AI session has expired. Sign in, then tap Connect GitHub again.');return}if(await bindInstallation(id)){cleanInstallParams();return}show('ai','GitHub returned successfully, but the installation could not be linked. Tap Connect GitHub and try once more.');}
let running=false;async function intercept(e){const send=e.type==='click'?e.target.closest?.('#send'):e.type==='keydown'&&e.key==='Enter'&&!e.shiftKey&&e.target?.matches?.('#prompt');if(!send||running)return;const box=document.querySelector('#prompt'),q=box?.value?.trim();if(!q||!githubIntent(q))return;e.preventDefault();e.stopImmediatePropagation();running=true;box.value='';show('user',q);const wait=show('ai','Checking your connected GitHub account…');try{const out=await handlePrompt(q);if(!out.handled)throw new Error('I need a repository or file action.');wait?.remove?.();show('ai',out.text);}catch(err){wait?.remove?.();if(err?.status===401)show('ai','GitHub is not connected to this Tivals AI account. Open the menu and tap **Connect GitHub**, then authorize the Tivals AI GitHub App.');else show('ai','GitHub connection error: '+(err.message||err));}finally{running=false;}}
document.addEventListener('click',intercept,true);document.addEventListener('keydown',intercept,true);async function boot(){addConnectButton();await finishInstall()}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();window.TivalsGitHub={call,repos,files,read,branch,create,update,openConnect,state};
})();