/* Tivals AI — image generation inside the main conversation */
(() => {
  const IMAGE_RE = /^(?:\s*)(?:generate|create|make|draw|design|render)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|artwork|illustration)\b/i;
  const IMAGE_OF_RE = /\b(?:generate|create|make|draw|render)\b.{0,18}\b(?:image|picture|photo|artwork|illustration)\s+(?:of|showing|with)\b/i;

  function isImageRequest(text){ return IMAGE_RE.test(text) || IMAGE_OF_RE.test(text); }
  function cleanPrompt(text){
    return String(text).replace(/^\s*(?:please\s+)?(?:generate|create|make|draw|design|render)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|artwork|illustration)\s*(?:of|showing)?\s*/i,'').trim() || text.trim();
  }
  function imageCard(item,prompt){
    const msg=add('ai','');
    const bubble=msg.querySelector('.bubble');
    bubble.innerHTML='';
    const card=document.createElement('div'); card.className='tivalsImageCard';
    const title=document.createElement('div'); title.className='tivalsImageTitle'; title.textContent='Generated image';
    card.appendChild(title);
    if(item.url){
      const img=document.createElement('img'); img.className='tivalsGeneratedImage'; img.src=item.url; img.alt=prompt; img.loading='eager'; card.appendChild(img);
      const actions=document.createElement('div'); actions.className='tivalsImageActions';
      const open=document.createElement('a'); open.href=item.url; open.target='_blank'; open.rel='noopener'; open.textContent='Open image'; actions.appendChild(open);
      const again=document.createElement('button'); again.type='button'; again.textContent='Generate again'; again.onclick=()=>runImage(prompt); actions.appendChild(again); card.appendChild(actions);
    } else {
      const pre=document.createElement('pre'); pre.textContent=JSON.stringify(item.raw||{},null,2); card.appendChild(pre);
    }
    const cap=document.createElement('p'); cap.className='tivalsImagePrompt'; cap.textContent=prompt; card.appendChild(cap);
    bubble.appendChild(card); scrollToLatest();
  }
  async function runImage(text){
    if(!window.TivalsImageGenerator){ add('ai','Image generator is still loading. Please try again.'); return; }
    const p=cleanPrompt(text); add('user',text); history.push({role:'user',content:text}); save();
    const wait=add('ai','Generating your image…'); busy(true);
    try{
      const item=await window.TivalsImageGenerator.generate(p);
      wait.remove(); imageCard(item,p);
      history.push({role:'assistant',content:'[Generated image] '+p+(item.url?'\n'+item.url:'')}); save();
    }catch(error){
      wait.querySelector('.bubble').innerHTML='<p>'+esc(error.message||'Image generation failed. Please try again.')+'</p>';
    }finally{ busy(false); }
  }
  function intercept(){
    const text=promptBox.value.trim(); if(!text || !isImageRequest(text)) return false;
    promptBox.value=''; promptBox.style.height='auto'; runImage(text); return true;
  }
  sendBtn.addEventListener('click',e=>{ if(intercept()){e.preventDefault();e.stopImmediatePropagation();} },true);
  promptBox.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&isImageRequest(promptBox.value)){e.preventDefault();e.stopImmediatePropagation();intercept();} },true);

  const tools=document.querySelector('.tools');
  if(tools){ const b=document.createElement('button'); b.className='toolBtn'; b.type='button'; b.textContent='▧ Generate image'; b.onclick=()=>{promptBox.value='Generate an image of ';promptBox.focus();promptBox.setSelectionRange(promptBox.value.length,promptBox.value.length)}; tools.prepend(b); }
  const sideTools=document.querySelector('.sideTools');
  if(sideTools){ const b=document.createElement('button'); b.className='sideTool'; b.type='button'; b.textContent='▧ Image generator'; b.onclick=()=>{promptBox.value='Generate an image of ';promptBox.focus();document.querySelector('#sidebar')?.classList.remove('open');document.querySelector('#sideOverlay')?.classList.remove('open')}; sideTools.prepend(b); }

  const style=document.createElement('style'); style.textContent=`
    .tivalsImageCard{display:grid;gap:12px}.tivalsImageTitle{font-weight:750}.tivalsGeneratedImage{display:block;width:min(100%,720px);max-height:720px;object-fit:contain;border-radius:16px;border:1px solid #454545;background:#111}.tivalsImagePrompt{color:#aaa;font-size:13px;margin:0!important}.tivalsImageActions{display:flex;gap:8px;flex-wrap:wrap}.tivalsImageActions a,.tivalsImageActions button{border:1px solid #555;background:#2f2f2f;color:#fff;border-radius:10px;padding:9px 12px;text-decoration:none}.logo img,.authBrand .logo img,.sideBrand .logo img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
  `; document.head.appendChild(style);

  document.querySelectorAll('.logo').forEach(el=>{el.textContent='';const img=document.createElement('img');img.src='./app-icon.svg';img.alt='Tivals AI';el.appendChild(img)});
})();