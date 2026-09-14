/* Tivals AI image generation client. Pixazo API key remains in Supabase Edge Function secrets. */
(() => {
  const ENDPOINT = 'https://kxuszpixwfecawdeqkrx.supabase.co/functions/v1/pixazo-studio';
  const SUPABASE_ANON_KEY = 'sb_publishable__auyhjNpepXiYdGV5HEJ_A_AGsPbBuS';
  const DEFAULT_MODEL = 'pixazo/flux';
  const HISTORY_KEY = 'tivals-generated-images';

  async function accessToken() {
    try {
      if (window.sb?.auth) {
        const {data} = await window.sb.auth.getSession();
        if (data?.session?.access_token) return data.session.access_token;
      }
      const keys = Object.keys(localStorage).filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      for (const key of keys) {
        try {
          const stored = JSON.parse(localStorage.getItem(key) || '{}');
          const token = stored?.access_token || stored?.currentSession?.access_token;
          if (token) return token;
        } catch {}
      }
    } catch {}
    return '';
  }

  function firstUrl(value) {
    if (!value) return '';
    if (typeof value === 'string') {
      const s=value.trim();
      if (/^https?:\/\//i.test(s)) return s;
      try { return firstUrl(JSON.parse(s)); } catch {}
      const m=s.match(/https?:\/\/[^\s"'<>}\\]+/i); return m ? m[0] : '';
    }
    if (Array.isArray(value)) { for (const v of value) { const u=firstUrl(v); if(u) return u; } return ''; }
    if (typeof value === 'object') {
      for (const key of ['url','image_url','imageUrl','output','images','data','result','response']) {
        const u=firstUrl(value[key]); if(u) return u;
      }
      for (const v of Object.values(value)) { const u=firstUrl(v); if(u) return u; }
    }
    return '';
  }

  async function generate(prompt, options = {}) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('Describe the image you want to create.');
    const token = await accessToken();
    if (!token) throw new Error('Your sign-in session is missing. Sign in again, then retry image generation.');
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_ANON_KEY},
      body: JSON.stringify({type:'image',prompt:text,model:options.model||DEFAULT_MODEL,steps:options.steps||20,width:options.width||1024,height:options.height||1024})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error('Your Tivals AI session expired. Sign in again and retry.');
      throw new Error(data.error || data.message || `Image generation failed (${response.status})`);
    }
    const url=firstUrl(data);
    if(!url) throw new Error('The image service responded successfully but did not return an image URL.');
    const item={id:data.id||data.request_id||String(Date.now()),prompt:text,model:options.model||DEFAULT_MODEL,url,createdAt:new Date().toISOString(),raw:data};
    let history=[]; try{history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')}catch{}
    history.unshift(item); localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(0,100)));
    window.dispatchEvent(new CustomEvent('tivals:image-generated',{detail:item}));
    return item;
  }
  function history(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]')}catch{return[]}}
  window.TivalsImageGenerator={generate,history,model:DEFAULT_MODEL};
})();