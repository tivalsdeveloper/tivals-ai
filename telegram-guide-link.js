document.addEventListener("DOMContentLoaded",()=>{
  const tools=document.querySelector(".sideTools");
  if(tools){
    const link=document.createElement("a");
    link.href="./telegram-guide.html";
    link.className="sideTool";
    link.textContent="✈ Telegram bot guide";
    tools.append(link);
  }
  const trust=document.querySelector(".authTrust");
  if(trust){
    const link=document.createElement("a");
    link.href="./telegram-guide.html";
    link.textContent="Telegram bot setup guide →";
    link.style.cssText="display:inline-flex;color:#8ed5ff;font-weight:750;padding:7px 0";
    trust.after(link);
  }
});
