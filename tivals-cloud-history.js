/* Tivals AI — Supabase cloud conversation sync. Local storage remains the fast offline cache. */
(() => {
  const URL='https://kxuszpixwfecawdeqkrx.supabase.co';
  const KEY='sb_publishable__auyhjNpepXiYdGV5HEJ_A_AGsPbBuS';
  const LOCAL_HISTORY='tivals-ai-history', SAVED='tivals-saved-chats', ACTIVE='tivals-active-chat';
  let syncing=false,lastFingerprint='';
  async function session(){try{if(window.sb?.auth){const {data}=await window.sb.auth.getSession();if(data?.session)return data.session}}catch{}try{for(const k of Object.keys(localStorage).filter(k=>k.startsWith('sb-')&&k.endsWith('-auth-token'))){const v=JSON.parse(localStorage.getItem(k)||'{}'),s=v?.currentSession||v;if(s?.access_token&&s?.user?.id)return s}}catch{}return null}
  function headers(s,extra={}){return {apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json',...extra}}
  function activeId(){return localStorage.getItem(ACTIVE)||'default'}
  function localMessages(){try{const h=JSON.parse(localStorage.getItem(LOCAL_HISTORY)||'[]');return Array.isArray(h)?h:[]}catch{return[]}}
  function savedChats(){try{const x=JSON.parse(localStorage.getItem(SAVED)||'[]');return Array.isArray(x)?x:[]}catch{return[]}}
  function titleFor(id,msgs){const saved=savedChats().find(c=>String(c.id)===String(id));if(saved?.title)return String(saved.title).slice(0,160);const first=msgs.find(m=>m.role==='user')?.content||'New chat';return String(first).replace(/\s+/g,' ').slice(0,80)||'New chat'}
  async function pushCurrent(){if(syncing)return;const s=await session();if(!s?.user?.id)return;const id=activeId(),msgs=localMessages(),fp=id+'|'+JSON.stringify(msgs);if(fp===lastFingerprint)return;syncing=true;try{
    await fetch(URL+'/rest/v1/tivals_chats?on_conflict=user_id,id',{method:'POST',headers:headers(s,{Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify({id,user_id:s.user.id,title:titleFor(id,msgs),updated_at:new Date().toISOString()})});
    await fetch(URL+'/rest/v1/tivals_messages?user_id=eq.'+encodeURIComponent(s.user.id)+'&chat_id=eq.'+encodeURIComponent(id),{method:'DELETE',headers:headers(s)});
    if(msgs.length){const rows=msgs.map(m=>({user_id:s.user.id,chat_id:id,role:['user','assistant','system'].includes(m.role)?m.role:'assistant',content:String(m.content??'')}));await fetch(URL+'/rest/v1/tivals_messages',{method:'POST',headers:headers(s,{Prefer:'return=minimal'}),body:JSON.stringify(rows)})}
    lastFingerprint=fp;
  }catch(e){console.warn('Tivals cloud history sync failed',e)}finally{syncing=false}}
  async function pullCloud(){const s=await session();if(!s?.user?.id)return;try{const cr=await fetch(URL+'/rest/v1/tivals_chats?user_id=eq.'+encodeURIComponent(s.user.id)+'&select=id,title,created_at,updated_at&order=updated_at.desc&limit=20',{headers:headers(s)});if(!cr.ok)return;const chats=await cr.json();if(!Array.isArray(chats)||!chats.length){await pushCurrent();return}const local=savedChats();const merged=[...chats.map(c=>({id:c.id,title:c.title,updatedAt:c.updated_at,cloud:true})),...local.filter(l=>!chats.some(c=>String(c.id)===String(l.id)))].slice(0,20);localStorage.setItem(SAVED,JSON.stringify(merged));const current=activeId();const target=chats.some(c=>String(c.id)===String(current))?current:chats[0].id;const mr=await fetch(URL+'/rest/v1/tivals_messages?user_id=eq.'+encodeURIComponent(s.user.id)+'&chat_id=eq.'+encodeURIComponent(target)+'&select=role,content&order=id.asc&limit=200',{headers:headers(s)});if(mr.ok){const msgs=await mr.json();if(Array.isArray(msgs)&&msgs.length){localStorage.setItem(ACTIVE,String(target));localStorage.setItem(LOCAL_HISTORY,JSON.stringify(msgs.map(m=>({role:m.role,content:m.content}))));window.dispatchEvent(new CustomEvent('tivals:cloud-history-loaded',{detail:{chatId:target,messages:msgs}}));}}
  }catch(e){console.warn('Tivals cloud history load failed',e)}}
  const schedule=()=>setTimeout(pushCurrent,250);
  const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){originalSet.call(this,k,v);if(this===localStorage&&(k===LOCAL_HISTORY||k===SAVED||k===ACTIVE))schedule()};
  window.addEventListener('beforeunload',()=>{pushCurrent()});
  window.addEventListener('tivals:image-generated',schedule);
  setTimeout(pullCloud,1200);setInterval(pushCurrent,15000);
  window.TivalsCloudHistory={push:pushCurrent,pull:pullCloud};
})();