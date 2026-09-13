(()=>{
  if(document.querySelector('#tivalsFloatingNav')) return;
  const style=document.createElement('style');
  style.textContent=`
  .tivals-fab-wrap{position:fixed;right:18px;bottom:max(18px,env(safe-area-inset-bottom));z-index:80;display:flex;align-items:flex-end;gap:12px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  .tivals-assistant-pill{height:64px;min-width:min(78vw,420px);border:1.5px solid #61799b;background:#14294b;color:#fff;border-radius:34px;display:flex;align-items:center;gap:14px;padding:0 20px;box-shadow:0 14px 35px #02091666;font-size:18px;font-weight:700}
  .tivals-assistant-pill .orb{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#39e3b1,#2f8df4);color:#0d3155;font-weight:900}
  .tivals-assistant-pill .mic{margin-left:auto;font-size:24px;color:#2aa0ff}
  .tivals-fab{width:64px;height:64px;border:0;border-radius:50%;background:#2499ef;color:#fff;font-size:34px;box-shadow:0 14px 35px #02091666;display:grid;place-items:center;transition:.2s transform,.2s background}
  .tivals-fab.open{transform:rotate(45deg);background:#229af3}
  .tivals-flyout{position:absolute;right:0;bottom:78px;width:min(310px,78vw);background:#14294b;border:1px solid #243d63;border-radius:24px;padding:10px;box-shadow:0 22px 60px #0209168f;opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;transition:.18s ease;overflow:hidden}
  .tivals-flyout.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}
  .tivals-flyout button{width:100%;border:0;background:transparent;color:#fff;display:flex;align-items:center;gap:16px;padding:14px 16px;border-radius:18px;font-size:17px;text-align:left}
  .tivals-flyout button:hover,.tivals-flyout button.active{background:#1f4778}
  .tivals-flyout .icon{width:34px;text-align:center;font-size:24px;line-height:1}
  .tivals-flyout .label{flex:1}
  .tivals-mini-sheet{position:fixed;inset:auto 12px calc(96px + env(safe-area-inset-bottom)) 12px;z-index:79;background:#152b4b;border:1px solid #294362;border-radius:24px;padding:20px;box-shadow:0 20px 60px #0008;max-height:66vh;overflow:auto;display:none;color:#fff}
  .tivals-mini-sheet.open{display:block}
  .tivals-mini-sheet h2{margin:0 0 8px;font-size:24px}.tivals-mini-sheet p{color:#aebfd5;line-height:1.5}.tivals-mini-sheet .card{background:#20395b;border:1px solid #355172;border-radius:16px;padding:14px;margin-top:10px}.tivals-mini-sheet .card button{margin-top:10px;border:0;border-radius:12px;background:#2499ef;color:white;padding:11px 14px;font-weight:700;width:100%}
  @media(min-width:761px){.tivals-fab-wrap{right:26px;bottom:26px}.tivals-assistant-pill{min-width:360px}}
  @media(max-width:520px){.tivals-fab-wrap{left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));gap:10px}.tivals-assistant-pill{min-width:0;flex:1;height:58px;padding:0 16px;font-size:16px}.tivals-assistant-pill .orb{width:34px;height:34px}.tivals-fab{width:58px;height:58px;flex:0 0 58px}.tivals-flyout{right:0;bottom:70px;width:min(300px,86vw)}}
  `;
  document.head.appendChild(style);

  const wrap=document.createElement('div');
  wrap.className='tivals-fab-wrap';
  wrap.id='tivalsFloatingNav';
  wrap.innerHTML=`
    <button class="tivals-assistant-pill" id="tivalsAskAssistant" aria-label="Ask Assistant"><span class="orb">◡</span><span>Ask Assistant</span><span class="mic">🎙</span></button>
    <button class="tivals-fab" id="tivalsNavToggle" aria-label="Open quick navigation">＋</button>
    <div class="tivals-flyout" id="tivalsFlyout" role="menu">
      <button data-action="chats" class="active"><span class="icon">💬</span><span class="label">Chats</span></button>
      <button data-action="calendar"><span class="icon">📅</span><span class="label">Calendar</span></button>
      <button data-action="ai"><span class="icon">◡</span><span class="label">Tivals AI</span></button>
      <button data-action="business"><span class="icon">🏪</span><span class="label">Your business</span></button>
      <button data-action="settings"><span class="icon">⚙</span><span class="label">Settings</span></button>
    </div>`;
  document.body.appendChild(wrap);

  const sheet=document.createElement('section');
  sheet.className='tivals-mini-sheet';
  sheet.id='tivalsMiniSheet';
  document.body.appendChild(sheet);

  const toggle=wrap.querySelector('#tivalsNavToggle');
  const flyout=wrap.querySelector('#tivalsFlyout');
  const ask=wrap.querySelector('#tivalsAskAssistant');
  const closeMenu=()=>{flyout.classList.remove('open');toggle.classList.remove('open');toggle.textContent='＋'};
  toggle.addEventListener('click',()=>{const open=!flyout.classList.contains('open');flyout.classList.toggle('open',open);toggle.classList.toggle('open',open);toggle.textContent=open?'×':'＋'});
  ask.addEventListener('click',()=>{const prompt=document.querySelector('#prompt');if(prompt){prompt.focus();prompt.scrollIntoView({behavior:'smooth',block:'end'})}closeMenu()});

  function showSheet(title,body){sheet.innerHTML=`<h2>${title}</h2>${body}`;sheet.classList.add('open');closeMenu()}
  function closeSheet(){sheet.classList.remove('open')}
  document.addEventListener('click',e=>{if(!wrap.contains(e.target)&&!sheet.contains(e.target)) closeMenu()});

  flyout.addEventListener('click',e=>{
    const btn=e.target.closest('button[data-action]');if(!btn)return;
    flyout.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===btn));
    const action=btn.dataset.action;
    if(action==='chats'||action==='ai'){
      closeSheet();
      const chat=document.querySelector('#chat');if(chat)chat.scrollTo({top:chat.scrollHeight,behavior:'smooth'});
      const prompt=document.querySelector('#prompt');if(prompt)prompt.focus();
      closeMenu();
    }
    if(action==='calendar') showSheet('Calendar','<p>Keep AI-related events, follow-ups and reminders in one place.</p><div class="card"><b>Google Calendar</b><p>Calendar connection can be added here next.</p><button type="button" id="tivalsCalendarClose">Close</button></div>');
    if(action==='business'){
      const embed=document.querySelector('#embedBtn')||document.querySelector('#sideEmbed');
      if(embed){embed.click();closeMenu()} else showSheet('Your business','<p>Manage the website assistant and business integrations here.</p>');
    }
    if(action==='settings') showSheet('Settings','<div class="card"><b>AI model</b><p>Choose your preferred model using the model selector at the top of the app.</p></div><div class="card"><b>Gmail</b><p>Connect or manage Gmail from the existing Gmail controls.</p></div><div class="card"><b>Website widget</b><p>Use “Add to website” to install Tivals AI on your own site.</p><button type="button" id="tivalsSettingsClose">Done</button></div>');
  });
  sheet.addEventListener('click',e=>{if(e.target.id==='tivalsCalendarClose'||e.target.id==='tivalsSettingsClose')closeSheet()});
})();
