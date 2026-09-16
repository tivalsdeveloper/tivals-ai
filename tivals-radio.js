/* Tivals AI radio hub. Uses official station listen pages so streams remain controlled by broadcasters. */
(()=>{
const stations=[
{name:'Phalaphala FM',lang:'Tshivenda',url:'https://www.phalaphalafm.co.za/phalaphalafm/'},
{name:'Thobela FM',lang:'Sepedi',url:'https://www.thobelafm.co.za/thobelafm/livestreams/'},
{name:'METRO FM',lang:'Music / English',url:'https://www.metrofm.co.za/metro-fm/listen-live/'},
{name:'Ukhozi FM',lang:'isiZulu',url:'https://www.ukhozifm.co.za/'},
{name:'5FM',lang:'Youth / Music',url:'https://listen.5fm.co.za/'},
{name:'Munghana Lonene FM',lang:'Xitsonga',url:'https://listen.munghanalonenefm.co.za/listenmunghanalonenefm/'},
{name:'Motsweding FM',lang:'Setswana',url:'https://listen.motswedingfm.co.za/listenmotswedingfm/'},
{name:'Lesedi FM',lang:'Sesotho',url:'https://www.lesedifm.co.za/lesedifm/'},
{name:'SAfm',lang:'News / Talk',url:'https://www.safm.co.za/'},
{name:'Radio 2000',lang:'Music / Talk',url:'https://www.radio2000.co.za/'},
{name:'Good Hope FM',lang:'Music',url:'https://www.goodhopefm.co.za/'},
{name:'Umhlobo Wenene FM',lang:'isiXhosa',url:'https://www.umhlobowenenefm.co.za/'},
{name:'Ligwalagwala FM',lang:'siSwati',url:'https://www.ligwalagwalafm.co.za/'},
{name:'Ikwekwezi FM',lang:'isiNdebele',url:'https://www.ikwekwezifm.co.za/'},
{name:'Lotus FM',lang:'Indian South African',url:'https://www.lotusfm.co.za/'},
{name:'RSG',lang:'Afrikaans',url:'https://www.rsg.co.za/'}
];
const css=`#tivalsRadio{position:fixed;inset:0;z-index:10050;background:#061a31;color:#f7fbff;display:none;overflow:auto;font-family:inherit}.tr-head{position:sticky;top:0;z-index:2;background:#092542;padding:16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #24517b}.tr-head h2{margin:0;flex:1}.tr-close{border:1px solid #3d6b96;background:#102f50;color:white;border-radius:12px;padding:10px 14px;font-size:20px}.tr-search{display:block;width:calc(100% - 32px);box-sizing:border-box;margin:16px;padding:13px 15px;border-radius:14px;border:1px solid #315e87;background:#0b2744;color:white;font-size:16px}.tr-grid{padding:0 16px 100px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.tr-card{border:1px solid #214b70;background:#0a233e;border-radius:16px;padding:15px}.tr-card h3{margin:0 0 5px}.tr-card small{opacity:.72}.tr-play{margin-top:13px;width:100%;border:0;border-radius:12px;padding:12px;background:#1677d2;color:white;font-weight:700}.tr-note{padding:0 16px 14px;opacity:.75;font-size:13px}#tivalsRadioButton{display:flex;align-items:center;gap:10px}`;
function openStation(s){const w=window.open(s.url,'_blank','noopener,noreferrer');if(!w)location.href=s.url}
function render(q=''){const root=document.querySelector('#tivalsRadioGrid');if(!root)return;const x=q.trim().toLowerCase();root.innerHTML='';stations.filter(s=>!x||`${s.name} ${s.lang}`.toLowerCase().includes(x)).forEach(s=>{const c=document.createElement('div');c.className='tr-card';const h=document.createElement('h3');h.textContent=s.name;const sm=document.createElement('small');sm.textContent=s.lang;const b=document.createElement('button');b.className='tr-play';b.textContent='▶ Listen Live';b.onclick=()=>openStation(s);c.append(h,sm,b);root.appendChild(c)})}
function open(){const p=document.querySelector('#tivalsRadio');if(p){p.style.display='block';render();}}
function close(){const p=document.querySelector('#tivalsRadio');if(p)p.style.display='none'}
function boot(){if(document.querySelector('#tivalsRadio'))return;const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);const p=document.createElement('section');p.id='tivalsRadio';p.innerHTML='<div class="tr-head"><h2>📻 Live Radio</h2><button class="tr-close" aria-label="Close radio">×</button></div><input class="tr-search" id="tivalsRadioSearch" placeholder="Search stations or language…"><div class="tr-note">Choose a station to open its official live player. Streaming availability is controlled by each broadcaster.</div><div class="tr-grid" id="tivalsRadioGrid"></div>';document.body.appendChild(p);p.querySelector('.tr-close').onclick=close;p.querySelector('#tivalsRadioSearch').oninput=e=>render(e.target.value);render();
const host=document.querySelector('.sideTools')||document.querySelector('.tools')||document.querySelector('nav');if(host){const b=document.createElement('button');b.type='button';b.id='tivalsRadioButton';b.className=host.classList.contains('sideTools')?'sideTool':'toolBtn';b.textContent='📻 Radio';b.onclick=open;host.appendChild(b)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();window.TivalsRadio={open,close,stations};
})();