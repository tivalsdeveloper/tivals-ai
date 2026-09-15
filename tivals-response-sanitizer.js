/* Tivals AI response sanitizer — prevents provider/tool protocol and safety metadata from leaking into visible chat/history. */
(()=>{
 const HIST='tivals-ai-history';
 const TOKEN_RE=/<\|(?:tool_call_(?:begin|start|end)|tool_(?:call|result)(?:_start|_end)?|assistant|system|im_start|im_end)[^|>]*\|>/gi;
 const TOOL_BLOCK_RE=/<\|tool_call_(?:begin|start)\|>[\s\S]*?(?:<\|tool_call_end\|>|$)/gi;
 const TOOL_LINE_RE=/^\s*\[?(?:youtube_search|web_search|search|browser|tool)\s*\([^\n]*\)\]?\s*$/gim;
 const SAFETY_RE=/^\s*(?:User|Response)\s+Safety\s*:\s*(?:safe|unsafe|\w+)\s*$/gim;
 function clean(v){if(typeof v!=='string')return v;let s=v.replace(TOOL_BLOCK_RE,'').replace(TOKEN_RE,'').replace(TOOL_LINE_RE,'').replace(SAFETY_RE,'');s=s.replace(/(?:\n\s*){3,}/g,'\n\n').trim();return s}
 function cleanHistory(){try{const raw=localStorage.getItem(HIST);if(!raw)return;const a=JSON.parse(raw);if(!Array.isArray(a))return;let changed=false;for(const m of a){if(m&&m.role==='assistant'&&typeof m.content==='string'&&!m.content.startsWith('[YouTube Search]')){const c=clean(m.content);if(c!==m.content){m.content=c;changed=true}}}if(changed)localStorage.setItem(HIST,JSON.stringify(a))}catch(e){console.warn('Tivals sanitizer history cleanup failed',e)}}
 function shouldSkip(n){return n.parentElement?.closest?.('script,style,textarea,input,pre,code,.tivals-youtube-results')}
 function cleanNode(n){if(n.nodeType===Node.TEXT_NODE&&!shouldSkip(n)){const c=clean(n.nodeValue);if(c!==n.nodeValue)n.nodeValue=c}else if(n.nodeType===Node.ELEMENT_NODE&&!shouldSkip(n)){n.childNodes.forEach(cleanNode)}}
 function sweep(root=document){cleanNode(root);cleanHistory()}
 const mo=new MutationObserver(ms=>{for(const m of ms){m.addedNodes.forEach(cleanNode);if(m.type==='characterData')cleanNode(m.target)}cleanHistory()});
 function start(){sweep();mo.observe(document.body,{subtree:true,childList:true,characterData:true})}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 window.addEventListener('storage',e=>{if(e.key===HIST)cleanHistory()});
 window.TivalsResponseSanitizer={clean,sweep,cleanHistory};
})();