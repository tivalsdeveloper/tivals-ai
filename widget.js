(() => {
  if (window.__TIVALS_AI_WIDGET__) return;
  window.__TIVALS_AI_WIDGET__ = true;
  const script = document.currentScript;
  const config = { widgetId: script?.dataset.widgetId || '', name: script?.dataset.name || 'Tivals AI', position: script?.dataset.position === 'left' ? 'left' : 'right', welcome: script?.dataset.welcome || 'Hi! How can I help?', model: script?.dataset.model || 'auto' };
  const API = 'https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/tivals-ai-chat';
  const WIDGET_API = `${API}?widget=${encodeURIComponent(config.widgetId)}`;
  const side = config.position;
  let history = [], busy = false, availableModels = [config.model];
  const historyKey = `tivals-ai-widget-history:${config.widgetId || 'unconfigured'}`;
  try { history = JSON.parse(localStorage.getItem(historyKey) || '[]'); } catch {}
  const host = document.createElement('div');
  host.id = 'tivals-ai-widget'; document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>*{box-sizing:border-box;font-family:system-ui,sans-serif}.fab{position:fixed;${side}:18px;bottom:18px;width:60px;height:60px;border:0;border-radius:20px;background:linear-gradient(135deg,#7657ff,#00c2ff);color:#fff;font-weight:800;font-size:19px;box-shadow:0 10px 35px #0007;z-index:2147483646;cursor:pointer}.panel{display:none;position:fixed;${side}:18px;bottom:88px;width:min(390px,calc(100vw - 24px));height:min(610px,calc(100dvh - 110px));background:#0b0e14;color:#f6f7fb;border:1px solid #303746;border-radius:20px;overflow:hidden;z-index:2147483647;box-shadow:0 20px 70px #0009}.panel.open{display:flex;flex-direction:column}.head{height:60px;padding:10px 12px;display:flex;align-items:center;gap:9px;border-bottom:1px solid #252b38}.icon{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#7657ff,#00c2ff);display:grid;place-items:center;font-weight:800}.title{font-weight:800;flex:1}.close{border:0;background:#171c26;color:#fff;width:36px;height:36px;border-radius:10px;font-size:20px;cursor:pointer}.chat{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:13px}.msg{margin:10px 0;display:flex}.msg.user{justify-content:flex-end}.bubble{max-width:88%;padding:10px 12px;border-radius:15px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.user .bubble{background:#6c4cff}.ai .bubble{background:#171c26;border:1px solid #29303d}.compose{padding:10px;border-top:1px solid #252b38;display:flex;gap:7px;align-items:flex-end}.input{flex:1;resize:none;height:46px;max-height:110px;border:1px solid #303746;border-radius:13px;background:#121620;color:#fff;padding:12px;font-size:16px;line-height:1.35;outline:0}.send{width:46px;height:46px;flex:0 0 46px;border:0;border-radius:13px;background:#7657ff;color:#fff;font-size:18px;cursor:pointer}.send:disabled{opacity:.55;cursor:not-allowed}.foot{text-align:center;color:#8f99aa;font-size:11px;padding:0 8px 8px}@media(max-width:480px){.fab{${side}:12px;bottom:max(12px,env(safe-area-inset-bottom))}.panel{${side}:6px;bottom:76px;width:calc(100vw - 12px);height:calc(100dvh - 88px);border-radius:18px}}</style><button class="fab" type="button" aria-label="Open ${config.name}">AI</button><section class="panel" role="dialog" aria-label="${config.name} assistant"><div class="head"><div class="icon">AI</div><div class="title"></div><button class="close" type="button" aria-label="Close ${config.name}">×</button></div><div class="chat" aria-live="polite"></div><div class="compose"><textarea class="input" rows="1" aria-label="Message ${config.name}" placeholder="Ask anything..."></textarea><button class="send" type="button" aria-label="Send message">➤</button></div><div class="foot">Powered by tivalsdeveloper</div></section>`;
  const fab = root.querySelector('.fab'), panel = root.querySelector('.panel'), chat = root.querySelector('.chat'), input = root.querySelector('.input'), sendButton = root.querySelector('.send');
  root.querySelector('.title').textContent = config.name;
  function add(role, text) { const message = document.createElement('div'); message.className = `msg ${role}`; const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = text; message.appendChild(bubble); chat.appendChild(message); requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; }); return message; }
  function save() { localStorage.setItem(historyKey, JSON.stringify(history.slice(-30))); }
  if (!config.widgetId) add('ai', 'This widget has not been configured. The website owner must create it in the Tivals AI dashboard.');
  else if (!history.length) add('ai', config.welcome); else history.slice(-30).forEach(item => add(item.role === 'assistant' ? 'ai' : 'user', item.content));
  fetch(API+'?models=1').then(response=>response.json()).then(data=>{const ids=(data.models||[]).map(item=>item.id).filter(Boolean);availableModels=[config.model,...ids].filter((id,index,all)=>all.indexOf(id)===index)}).catch(()=>{});
  async function askWithFallback(messages,signal,onRetry){let lastError=new Error('All AI models are unavailable.');for(let i=0;i<availableModels.length;i++){if(signal.aborted)throw new DOMException('Stopped','AbortError');if(i>0)onRetry(i+1,availableModels.length);try{const response=await fetch(WIDGET_API,{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({model:availableModels[i],messages})});let data={};try{data=await response.json()}catch{}if(response.ok&&data.reply)return data.reply;if(data.code==='DOMAIN_NOT_ALLOWED')throw new Error('This website is not authorized to use this AI widget.');lastError=new Error(data.error||`Model failed (${response.status}).`)}catch(error){if(error.name==='AbortError')throw error;if(/not authorized|not been configured/i.test(error.message))throw error;lastError=error}}throw lastError}
  async function send() {
    const text = input.value.trim(); if (!text || busy || !config.widgetId) return;
    busy = true; sendButton.disabled = true; input.value = ''; input.style.height = '46px'; add('user', text); history.push({ role: 'user', content: text }); save();
    const waiting = add('ai', 'Thinking…'), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
    try { const reply=await askWithFallback(history.slice(-10),controller.signal,(attempt,total)=>{waiting.querySelector('.bubble').textContent=`Trying another model… (${attempt}/${total})`}); waiting.remove(); add('ai', reply); history.push({ role: 'assistant', content: reply }); save(); }
    catch (error) { waiting.querySelector('.bubble').textContent = error.name === 'AbortError' ? 'The response took too long. Please try again.' : (error.message || 'Unable to reach Tivals AI.'); }
    finally { clearTimeout(timer); busy = false; sendButton.disabled = false; input.focus(); }
  }
  function close() { panel.classList.remove('open'); fab.hidden = false; }
  fab.onclick = () => { panel.classList.add('open'); fab.hidden = true; input.focus(); };
  root.querySelector('.close').onclick = close; sendButton.onclick = send;
  input.oninput = () => { input.style.height = '46px'; input.style.height = `${Math.min(input.scrollHeight, 110)}px`; };
  input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); } };
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && panel.classList.contains('open')) close(); });
})();
