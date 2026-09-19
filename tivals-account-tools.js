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
    style.textContent='.connectorModal{width:min(880px,100%)!important}.connectorIntro{margin:6px 0 18px!important}.connectorHeading{grid-column:1/-1;margin:8px 2px 0;color:#85a7ca;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.accountToolsGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.accountToolCard{display:grid;grid-template-columns:48px minmax(0,1fr);gap:0 13px;align-content:start;border:1px solid #2c527b;background:linear-gradient(145deg,#0b2749,#091d38);border-radius:18px;padding:16px;min-height:142px}.accountToolIcon{grid-row:1/7;width:48px;height:48px;display:grid;place-items:center;border-radius:15px;background:#173a66;color:#fff;font-size:20px;font-weight:800}.accountToolCard b{display:block;margin:1px 0 4px;font-size:16px}.accountToolCard code{display:block;margin-top:5px;font-size:12px;color:#a9c9ec;white-space:normal}.accountToolActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.accountToolActions button{border:1px solid #466c96;background:#15395f;color:#fff;border-radius:10px;padding:9px 12px;font-weight:700}.accountToolActions .primary{background:#168eea;border-color:#168eea}.accountToolStatus{margin:6px 0 0;color:#9eb0c5;font-size:12px;line-height:1.45}.connectorInput{grid-column:2;width:100%;min-height:42px;margin-top:10px;padding:10px 12px;border:1px solid #3b6893;border-radius:10px;background:#06182f;color:#fff}.tiktokTool,.telegramTool{border-color:#365e83!important}@media(max-width:650px){.connectorModal{padding:18px!important}.accountToolsGrid{grid-template-columns:1fr}.accountToolCard{min-height:0}.connectorHeading{grid-column:auto}.connectorIntro{font-size:14px}}';
    document.head.appendChild(style);

    var modal=document.createElement('div');
    modal.className='modalBack';
    modal.id='accountToolsModal';
    modal.innerHTML='<div class="modal connectorModal"><div class="modalTop"><div><h2>Apps & connectors</h2><p class="connectorIntro">Connect your accounts and open Tivals AI tools from one place.</p></div><button class="closeModal" id="closeAccountTools" aria-label="Close apps and connectors">×</button></div><div class="accountToolsGrid"><div class="connectorHeading">Connected accounts</div><div class="accountToolCard telegramTool"><span class="accountToolIcon">✈</span><b>Telegram bot</b><div class="accountToolStatus" id="webTelegramStatus">Checking connection…</div><input class="connectorInput" id="webTelegramToken" type="password" autocomplete="off" placeholder="Paste BotFather token"><div class="accountToolActions"><button class="primary" id="webTelegramConnect">Connect bot</button><button id="webTelegramTest" hidden>Test</button><button id="webTelegramDisconnect" hidden>Disconnect</button></div></div><div class="accountToolCard tiktokTool"><span class="accountToolIcon">♪</span><b>TikTok</b><div class="accountToolStatus" id="webTikTokStatus">Checking connection…</div><code>@tiktok show my stats</code><div class="accountToolActions"><button class="primary" id="webTikTokConnect">Connect</button><button id="webTikTokDisconnect" hidden>Disconnect</button></div></div><div class="accountToolCard"><span class="accountToolIcon">✉</span><b>Gmail & monitor</b><div class="accountToolStatus">Read, find and send email with your permission.</div><code>@gmail check my latest emails</code><div class="accountToolActions"><button class="primary" id="openGmailConnector">Open Gmail</button></div></div><div class="accountToolCard"><span class="accountToolIcon">⌘</span><b>GitHub</b><div class="accountToolStatus">Inspect repositories and work with code.</div><code>@github list my repositories</code><div class="accountToolActions"><button class="primary" id="openGithubConnector">Connect GitHub</button></div></div><div class="connectorHeading">Built-in tools</div><div class="accountToolCard"><span class="accountToolIcon">▧</span><b>Image generator</b><div class="accountToolStatus">Create images directly from the chat.</div><code>@image futuristic AI robot</code></div><div class="accountToolCard"><span class="accountToolIcon">▶</span><b>YouTube</b><div class="accountToolStatus">Find helpful videos without leaving Tivals AI.</div><code>@youtube Python tutorial</code></div><div class="accountToolCard"><span class="accountToolIcon">AI</span><b>Website AI</b><div class="accountToolStatus">Business knowledge, domain security and embed settings.</div><div class="accountToolActions"><button class="primary" id="openWebsiteAI">Manage Website AI</button></div></div></div></div>';
    document.body.appendChild(modal);

    document.querySelector('#closeAccountTools').onclick=function(){modal.classList.remove('open')};
    modal.onclick=function(e){if(e.target===modal)modal.classList.remove('open')};
    document.querySelector('#webTikTokConnect').onclick=connectTikTok;
    document.querySelector('#webTikTokDisconnect').onclick=disconnectTikTok;
    document.querySelector('#webTelegramConnect').onclick=connectTelegram;
    document.querySelector('#webTelegramTest').onclick=testTelegram;
    document.querySelector('#webTelegramDisconnect').onclick=disconnectTelegram;
    document.querySelector('#openGmailConnector').onclick=function(){modal.classList.remove('open');document.querySelector('#gmailBtn')?.click()};
    document.querySelector('#openGithubConnector').onclick=function(){modal.classList.remove('open');document.querySelector('#githubConnect')?.click()};
    document.querySelector('#openWebsiteAI').onclick=function(){modal.classList.remove('open');window.TivalsWidgetDashboard?.open()};

    var side=document.querySelector('.sideTools');
    if(side&&!document.querySelector('#sideAccountTools')){
      var b=document.createElement('button');b.id='sideAccountTools';b.type='button';b.className='sideTool';b.textContent='Apps & connectors';b.onclick=openTools;side.prepend(b);
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
    await Promise.all([refreshTikTok(),refreshTelegram()]);
  }

  async function refreshTelegram(){
    ensureUI();
    var status=document.querySelector('#webTelegramStatus'),connect=document.querySelector('#webTelegramConnect'),test=document.querySelector('#webTelegramTest'),disconnect=document.querySelector('#webTelegramDisconnect'),token=document.querySelector('#webTelegramToken');
    if(!status)return;
    try{
      var d=await api('web_telegram_status');
      if(d.connected){status.textContent='Connected as '+(d.connection?.account_label||'Telegram bot')+'. The bot webhook is active.';connect.textContent='Replace bot';test.hidden=false;disconnect.hidden=false;token.placeholder='Paste a new BotFather token to replace it'}
      else{status.textContent='Not connected. Create a bot with @BotFather, then paste its token here.';connect.textContent='Connect bot';test.hidden=true;disconnect.hidden=true}
    }catch(e){status.textContent=e.message;test.hidden=true;disconnect.hidden=true}
  }

  async function connectTelegram(){
    var token=document.querySelector('#webTelegramToken'),status=document.querySelector('#webTelegramStatus'),button=document.querySelector('#webTelegramConnect');
    if(!token.value.trim()){status.textContent='Paste the bot token you received from @BotFather.';token.focus();return}
    button.disabled=true;status.textContent='Verifying your bot with Telegram…';
    try{var d=await api('web_telegram_connect',{bot_token:token.value.trim()});token.value='';status.textContent='Connected as '+(d.account_label||'Telegram bot')+'. Send /start to your bot to test it.';await refreshTelegram()}
    catch(e){status.textContent=e.message}finally{button.disabled=false}
  }

  async function testTelegram(){
    var status=document.querySelector('#webTelegramStatus');status.textContent='Testing the Telegram webhook…';
    try{var d=await api('web_telegram_test');status.textContent=d.webhook?.last_error?'Telegram reported: '+d.webhook.last_error:'Connection works. Open your bot in Telegram and send /start.'}catch(e){status.textContent=e.message}
  }

  async function disconnectTelegram(){
    var status=document.querySelector('#webTelegramStatus');status.textContent='Disconnecting…';
    try{await api('web_telegram_disconnect');await refreshTelegram()}catch(e){status.textContent=e.message}
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
    setTimeout(function(){refreshTikTok();refreshTelegram()},700);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.TivalsAccountTools={open:openTools,refreshTikTok:refreshTikTok,connectTikTok:connectTikTok,disconnectTikTok:disconnectTikTok,refreshTelegram:refreshTelegram};
})();
