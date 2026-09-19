/* Tivals AI unified website tools: @tool routing + TikTok connection. */
(function(){
  var OAUTH='https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/telegram-oauth';
  var routing=false;

  async function session(){
    try{return (await window.sb?.auth?.getSession())?.data?.session||null}catch(e){return null}
  }

  async function api(action,extra){
    var s=await session();
    if(!s?.access_token)throw new Error('Sign in to Tivals AI first.');
    var body=Object.assign({action:action},extra||{});
    var r=await fetch(OAUTH,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.access_token},body:JSON.stringify(body)});
    var d=await r.json().catch(function(){return {}});
    if(!r.ok||d?.error)throw new Error(d?.error||('Account request failed ('+r.status+').'));
    return d;
  }

  function show(role,text){return typeof window.add==='function'?window.add(role,text):null}
  function closeSide(){document.querySelector('#sidebar')?.classList.remove('open');document.querySelector('#sideOverlay')?.classList.remove('open')}

  function ensureUI(){
    if(document.querySelector('#accountToolsModal'))return;

    var style=document.createElement('style');
    style.textContent='.accountToolsGrid{display:grid;gap:10px;margin-top:14px}.accountToolCard{border:1px solid #39495d;background:#111b29;border-radius:14px;padding:13px}.accountToolCard b{display:block;margin-bottom:6px}.accountToolCard code{display:block;margin-top:5px;font-size:12px;color:#b9d8ff;white-space:normal}.accountToolActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.accountToolActions button{border:1px solid #465a72;background:#18283b;color:#fff;border-radius:10px;padding:10px 13px;font-weight:700}.accountToolActions .primary{background:#ee2b5b;border-color:#ee2b5b}.accountToolStatus{margin:8px 0 0;color:#9eb0c5;font-size:13px;line-height:1.5}.tiktokTool{border-color:#514553!important}';
    document.head.appendChild(style);

    var modal=document.createElement('div');
    modal.className='modalBack';
    modal.id='accountToolsModal';
    modal.innerHTML='<div class="modal"><div class="modalTop"><h2>Tools & connected accounts</h2><button class="closeModal" id="closeAccountTools">×</button></div><p>Choose a tool explicitly by starting your message with <code>@tool</code>.</p><div class="accountToolsGrid"><div class="accountToolCard tiktokTool"><b>🎵 TikTok</b><code>@tiktok check my TikTok account</code><code>@tiktok show my stats</code><code>@tiktok show my latest videos</code><div class="accountToolStatus" id="webTikTokStatus">Checking TikTok connection…</div><div class="accountToolActions"><button class="primary" id="webTikTokConnect">Connect TikTok</button><button id="webTikTokDisconnect" hidden>Disconnect</button></div></div><div class="accountToolCard"><b>✉ Gmail</b><code>@gmail check my latest emails</code><code>@gmail find emails from NAME</code></div><div class="accountToolCard"><b>🐙 GitHub</b><code>@github list my repositories</code><code>@github inspect owner/repository</code></div><div class="accountToolCard"><b>▶ YouTube</b><code>@youtube Python tutorial</code></div><div class="accountToolCard"><b>▧ Image</b><code>@image futuristic AI robot</code></div><div class="accountToolCard"><b>AI chat</b><code>@ai explain recursion</code></div></div></div>';
    document.body.appendChild(modal);

    document.querySelector('#closeAccountTools').onclick=function(){modal.classList.remove('open')};
    modal.onclick=function(e){if(e.target===modal)modal.classList.remove('open')};
    document.querySelector('#webTikTokConnect').onclick=connectTikTok;
    document.querySelector('#webTikTokDisconnect').onclick=disconnectTikTok;

    var side=document.querySelector('.sideTools');
    if(side&&!document.querySelector('#sideAccountTools')){
      var b=document.createElement('button');b.id='sideAccountTools';b.type='button';b.className='sideTool';b.textContent='Tools & accounts';b.onclick=openTools;side.prepend(b);
    }
    if(side&&!document.querySelector('#sideTikTok')){
      var t=document.createElement('button');t.id='sideTikTok';t.type='button';t.className='sideTool';t.textContent='TikTok';t.onclick=openTools;side.prepend(t);
    }

    var tools=document.querySelector('.tools');
    if(tools&&!document.querySelector('#accountToolsBtn')){
      var x=document.createElement('button');x.id='accountToolsBtn';x.type='button';x.className='toolBtn';x.textContent='◎ Tools & accounts';x.onclick=openTools;tools.appendChild(x);
    }
  }

  async function refreshTikTok(){
    ensureUI();
    var status=document.querySelector('#webTikTokStatus');
    var connect=document.querySelector('#webTikTokConnect');
    var disconnect=document.querySelector('#webTikTokDisconnect');
    if(!status)return;
    try{
      var d=await api('web_tiktok_status');
      if(d.connected){
        status.textContent='Connected as '+(d.connection?.account_label||'TikTok account')+'. Permissions: '+(d.connection?.scope||'basic');
        connect.textContent='Reconnect TikTok';
        disconnect.hidden=false;
      }else{
        status.textContent='Not connected. Connect TikTok to use profile, statistics and video tools.';
        connect.textContent='Connect TikTok';
        disconnect.hidden=true;
      }
    }catch(e){status.textContent=e.message;disconnect.hidden=true}
  }

  async function openTools(){
    ensureUI();
    document.querySelector('#accountToolsModal')?.classList.add('open');
    closeSide();
    await refreshTikTok();
  }

  async function connectTikTok(){
    try{
      var d=await api('create_web_tiktok_link');
      if(d?.url)location.href=d.url;
    }catch(e){show('ai','TikTok connection failed: '+e.message)}
  }

  async function disconnectTikTok(){
    try{
      await api('web_tiktok_disconnect');
      await refreshTikTok();
      show('ai','TikTok disconnected from your Tivals AI website account.');
    }catch(e){show('ai','TikTok disconnect failed: '+e.message)}
  }

  function fmtProfile(d){
    var p=d?.profile||{},s=d?.stats||{};
    var out=['### TikTok account','','**Display name:** '+(p.display_name||d?.account||'TikTok account')];
    if(s.follower_count!=null||s.following_count!=null||s.likes_count!=null||s.video_count!=null){
      out.push('','**Statistics**','- Followers: '+(s.follower_count??'—'),'- Following: '+(s.following_count??'—'),'- Likes: '+(s.likes_count??'—'),'- Public videos: '+(s.video_count??'—'));
    }
    out.push('','**Permissions:** '+(d?.scope||'user.info.basic'));
    return out.join('\n');
  }

  function fmtVideos(d){
    var v=Array.isArray(d?.videos)?d.videos:[];
    if(!v.length)return '### TikTok videos\n\nNo public videos were returned.';
    return '### Latest TikTok videos\n\n'+v.slice(0,10).map(function(x,i){
      var title=String(x?.title||x?.video_description||('Video '+(i+1))).trim()||('Video '+(i+1));
      return '**'+(i+1)+'. '+title+'**'+(x?.duration?'\nDuration: '+x.duration+'s':'')+(x?.embed_link?'\n'+x.embed_link:'');
    }).join('\n\n');
  }

  async function handleTikTok(raw,request){
    show('user',raw);
    var wait=show('ai','Using TikTok tools…');
    try{
      var d=/\b(videos?|posts?|latest videos?|recent videos?)\b/i.test(request)
        ? await api('web_tiktok_videos',{max_results:5})
        : await api('web_tiktok_profile');
      wait?.remove?.();
      show('ai',Array.isArray(d?.videos)?fmtVideos(d):fmtProfile(d));
    }catch(e){
      wait?.remove?.();
      var msg=/not connected/i.test(e.message)?e.message+' Open **Tools & accounts** and connect TikTok first.':e.message;
      show('ai','### TikTok tool\n\n'+msg);
    }
  }

  function parse(text){
    var m=String(text||'').trim().match(/^@([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
    return m?{tool:m[1].toLowerCase(),request:String(m[2]||'').trim()}:null;
  }

  function redispatch(input,text){
    routing=true;
    input.value=text;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    setTimeout(function(){
      document.querySelector('#send')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      setTimeout(function(){routing=false},0);
    },0);
  }

  function intercept(e){
    if(routing)return;
    var hit=e.type==='click'?e.target.closest?.('#send'):(e.type==='keydown'&&e.key==='Enter'&&!e.shiftKey&&e.target?.matches?.('#prompt'));
    if(!hit)return;
    var input=document.querySelector('#prompt');
    var raw=input?.value?.trim();
    var p=parse(raw);
    if(!p)return;

    if(p.tool==='tiktok'){
      e.preventDefault();e.stopImmediatePropagation();
      input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
      handleTikTok(raw,p.request);
      return;
    }

    if(p.tool==='tools'||p.tool==='help'){
      e.preventDefault();e.stopImmediatePropagation();
      input.value='';openTools();
      return;
    }

    var mapped=null;
    if(p.tool==='youtube'||p.tool==='yt')mapped='youtube '+p.request;
    if(p.tool==='image'||p.tool==='picture')mapped='Generate an image of '+p.request;
    if(p.tool==='ai'||p.tool==='chat')mapped=p.request;
    if(mapped!==null){
      e.preventDefault();e.stopImmediatePropagation();
      redispatch(input,mapped);
    }
  }

  document.addEventListener('click',intercept,true);
  document.addEventListener('keydown',intercept,true);

  async function boot(){
    ensureUI();
    var q=new URLSearchParams(location.search);
    if(q.get('tiktok')==='connected'){
      q.delete('tiktok');
      history.replaceState({},'',location.pathname+(q.toString()?'?'+q:'')+location.hash);
      setTimeout(function(){show('ai','### TikTok connected ✓\n\nYour TikTok account is now available to Tivals AI. Try @tiktok show my stats or @tiktok show my latest videos.')},350);
    }
    setTimeout(refreshTikTok,700);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.TivalsAccountTools={open:openTools,refreshTikTok:refreshTikTok,connectTikTok:connectTikTok,disconnectTikTok:disconnectTikTok};
})();