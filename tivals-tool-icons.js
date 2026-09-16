/* Professional icon treatment for Tivals AI sidebar tools. Keeps existing actions intact. */
(()=>{
const svg=(body)=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const icons={
 image:svg('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>'),
 gmail:svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>'),
 embed:svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
 github:svg('<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.2.1 15 1.8a13.4 13.4 0 0 0-7 0C4.8.1 3.7.5 3.7.5A5 5 0 0 0 3.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.3 3.5 6.5 6.8 7A4.8 4.8 0 0 0 8 18v4'/><path d="M8 19c-3 .9-3-1.5-4-2"/>'),
 radio:svg('<rect x="3" y="7" width="18" height="13" rx="3"/><path d="m7 7 10-4M7 12h5"/><circle cx="16.5" cy="14" r="2.5"/><path d="M7 16h2"/>'),
 settings:svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>')
};
const style=document.createElement('style');style.textContent=`
.sideTools{gap:7px!important;padding:8px!important;border-radius:18px!important;background:rgba(17,38,65,.72)!important;border:1px solid rgba(101,155,211,.22)!important;box-shadow:0 14px 36px rgba(0,0,0,.16)}
.sideTools .sideTool{min-height:58px!important;padding:8px 10px!important;display:flex!important;align-items:center!important;gap:13px!important;border-radius:14px!important;font-size:15px!important;font-weight:650!important;color:#eef6ff!important;transition:background .16s ease,transform .16s ease!important}
.sideTools .sideTool:hover,.sideTools .sideTool:active{background:rgba(73,132,193,.16)!important;transform:translateY(-1px)}
.tivals-tool-icon{width:42px;height:42px;flex:0 0 42px;display:grid;place-items:center;border-radius:13px;color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 5px 14px rgba(0,0,0,.16)}
.tivals-tool-icon svg{width:23px;height:23px;display:block}.tivals-tool-icon.image{background:linear-gradient(145deg,#7657ff,#5b3ee7)}.tivals-tool-icon.gmail{background:linear-gradient(145deg,#ff4d6d,#dc2747)}.tivals-tool-icon.embed{background:linear-gradient(145deg,#21d4d9,#08a9bd)}.tivals-tool-icon.github{background:linear-gradient(145deg,#454b57,#20242c)}.tivals-tool-icon.radio{background:linear-gradient(145deg,#ffb52e,#ee7c16)}.tivals-tool-icon.settings{background:linear-gradient(145deg,#6d89a8,#415b79)}
.tivals-tool-label{min-width:0;flex:1;line-height:1.25}.tivals-tool-label small{display:block;color:#91a9c3;font-size:11px;font-weight:500;margin-top:3px}
`;
document.head.appendChild(style);
function typeFor(text){const t=text.toLowerCase();if(t.includes('image'))return'image';if(t.includes('gmail')||t.includes('email'))return'gmail';if(t.includes('website')||t.includes('embed'))return'embed';if(t.includes('github'))return'github';if(t.includes('radio'))return'radio';if(t.includes('setting'))return'settings';return null}
const sub={image:'Create AI images',gmail:'Email and monitoring',embed:'Embed Tivals AI',github:'Repository access',radio:'Live stations',settings:'Preferences'};
function enhance(btn){if(btn.dataset.tivalsIconReady)return;const raw=btn.textContent.replace(/^[\s\S]*?(?=[A-Za-z])/,'').trim()||btn.textContent.trim(),type=typeFor(raw);if(!type)return;btn.dataset.tivalsIconReady='1';btn.textContent='';const ic=document.createElement('span');ic.className='tivals-tool-icon '+type;ic.innerHTML=icons[type];const label=document.createElement('span');label.className='tivals-tool-label';label.append(document.createTextNode(raw));const small=document.createElement('small');small.textContent=sub[type]||'';label.appendChild(small);btn.append(ic,label)}
function scan(){document.querySelectorAll('.sideTools .sideTool,.sideTools button').forEach(enhance)}
scan();new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
})();