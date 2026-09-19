/* Tivals AI response sanitizer — removes provider/tool protocol without damaging normal English spacing. */
(()=>{
 const HIST='tivals-ai-history',SAVED='tivals-saved-chats';
 const TOKEN_RE=/<\|(?:tool_call_(?:begin|start|end)|tool_(?:call|result)(?:_start|_end)?|assistant|system|im_start|im_end)[^|>]*\|>/gi;
 const TOOL_BLOCK_RE=/<\|tool_call_(?:begin|start)\|>[\s\S]*?(?:<\|tool_call_end\|>|$)/gi;
 const XML_TOOL_BLOCK_RE=/<tool_call\b[^>]*>[\s\S]*?<\/tool_call\s*>/gi;
 const XML_INVOKE_BLOCK_RE=/<invoke\b[^>]*>[\s\S]*?<\/invoke\s*>/gi;
 const XML_FUNCTION_BLOCK_RE=/<function(?:=|\s+name=)[^>]*>[\s\S]*?<\/function\s*>/gi;
 const XML_ORPHAN_RE=/<\/?(?:tool_call|invoke|function|parameter)\b[^>]*>|<\/?(?:function|parameter)=[^>]*>/gi;
 const TOOL_LINE_RE=/^\s*\[?(?:youtube_search|web_search|gmail_search|search|browser|tool)\s*\([^\n]*\)\]?\s*$/gim;
 const SAFETY_RE=/^\s*(?:User|Response)\s+Safety\s*:\s*(?:safe|unsafe|\w+)\s*$/gim;
 function clean(v){
   if(typeof v!=='string')return v;
   let s=v.replace(TOOL_BLOCK_RE,'').replace(XML_TOOL_BLOCK_RE,'').replace(XML_INVOKE_BLOCK_RE,'').replace(XML_FUNCTION_BLOCK_RE,'').replace(TOKEN_RE,'').replace(TOOL_LINE_RE,'').replace(SAFETY_RE,'').replace(XML_ORPHAN_RE,'');
   /* Only normalize excessive blank lines for complete strings. Never trim individual DOM text nodes: trimming text nodes joined by <strong>/<em> caused words such as "Makhadziis" and "ofNdivhudzannyi". */
   s=s.replace(/(?:\n[\t ]*){3,}/g,'\n\n');
   return s;
 }
 function cleanMessages(a){if(!Array.isArray(a))return false;let changed=false;for(const m of a){if(m&&m.role==='assistant'&&typeof m.content==='string'&&!m.content.startsWith('[YouTube Search]')){const c=clean(m.content).trim();if(c!==m.content){m.content=c;changed=true}}}return changed}
 function cleanHistory(){try{const raw=localStorage.getItem(HIST);if(raw){const a=JSON.parse(raw);if(cleanMessages(a))localStorage.setItem(HIST,JSON.stringify(a))}const savedRaw=localStorage.getItem(SAVED);if(savedRaw){const chats=JSON.parse(savedRaw);let changed=false;if(Array.isArray(chats))for(const chat of chats){if(cleanMessages(chat?.history))changed=true}if(changed)localStorage.setItem(SAVED,JSON.stringify(chats))}}catch(e){console.warn('Tivals sanitizer history cleanup failed',e)}}
 function shouldSkip(n){return n.parentElement?.closest?.('script,style,textarea,input,pre,code,.tivals-youtube-results')}
 function cleanNode(n){
   if(n.nodeType===Node.TEXT_NODE&&!shouldSkip(n)){
     /* Preserve leading/trailing whitespace because adjacent inline elements depend on it. */
     const c=clean(n.nodeValue);
     if(c!==n.nodeValue)n.nodeValue=c;
   }else if(n.nodeType===Node.ELEMENT_NODE&&!shouldSkip(n))n.childNodes.forEach(cleanNode)
 }
 function sweep(root=document){cleanNode(root);cleanHistory()}
 const mo=new MutationObserver(ms=>{for(const m of ms){m.addedNodes.forEach(cleanNode);if(m.type==='characterData')cleanNode(m.target)}cleanHistory()});
 function start(){sweep();mo.observe(document.body,{subtree:true,childList:true,characterData:true})}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 window.addEventListener('storage',e=>{if(e.key===HIST||e.key===SAVED)cleanHistory()});
 window.TivalsResponseSanitizer={clean,sweep,cleanHistory};
})();
