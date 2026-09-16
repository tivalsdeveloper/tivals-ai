(()=>{
const ENDPOINT='https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/github-agent';
const state={repos:[],repo:null,branch:'main',path:''};
async function call(payload){
  const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({success:false,error:'Invalid server response'}));
  if(!r.ok||data.success===false)throw new Error(data.error||`GitHub request failed (${r.status})`);
  return data;
}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function repos(){const d=await call({action:'list_repos'});state.repos=d.repositories||[];return state.repos;}
async function files(full,path='',branch){const [owner,repo]=full.split('/');return call({action:'list_files',owner,repo,path,branch:branch||state.branch});}
async function read(full,path,branch){const [owner,repo]=full.split('/');return call({action:'read_file',owner,repo,path,branch:branch||state.branch});}
async function branch(full,newBranch,source='main'){const [owner,repo]=full.split('/');return call({action:'create_branch',owner,repo,source_branch:source,new_branch:newBranch});}
async function create(full,path,content,branchName,message){const [owner,repo]=full.split('/');return call({action:'create_file',owner,repo,path,content,branch:branchName,message:message||`Create ${path} with Tivals AI`});}
async function update(full,path,content,branchName,message){const [owner,repo]=full.split('/');return call({action:'update_file',owner,repo,path,content,branch:branchName,message:message||`Update ${path} with Tivals AI`});}
window.TivalsGitHub={call,repos,files,read,branch,create,update,state};
window.dispatchEvent(new CustomEvent('tivals-github-ready'));
})();