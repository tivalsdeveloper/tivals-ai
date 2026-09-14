/* Tivals AI image generation client. API key remains in Supabase Edge Function secrets. */
(() => {
  const ENDPOINT = 'https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/pixazo-studio';
  const DEFAULT_MODEL = 'pixazo/flux';
  const HISTORY_KEY = 'tivals-generated-images';

  async function generate(prompt, options = {}) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('Describe the image you want to create.');
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({type:'image', prompt:text, model:options.model || DEFAULT_MODEL, steps:options.steps || 20, width:options.width || 1024, height:options.height || 1024})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Image generation failed (${response.status})`);
    const item = {
      id: data.id || data.request_id || String(Date.now()),
      prompt: text,
      model: options.model || DEFAULT_MODEL,
      url: data.url || data.image_url || data.output?.url || data.output?.[0]?.url || data.images?.[0]?.url || '',
      createdAt: new Date().toISOString(),
      raw: data
    };
    let history=[]; try { history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]'); } catch {}
    history.unshift(item); localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(0,100)));
    window.dispatchEvent(new CustomEvent('tivals:image-generated',{detail:item}));
    return item;
  }

  function history(){ try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')}catch{return[]} }
  window.TivalsImageGenerator={generate,history,model:DEFAULT_MODEL};
})();