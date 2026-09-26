document.addEventListener("DOMContentLoaded",()=>{
  const tools=document.querySelector(".sideTools");
  if(tools){
    const link=document.createElement("a");
    link.href="./telegram-bots.html";
    link.className="sideTool";
    link.textContent="✈ Telegram bots";
    tools.append(link);
  }
  const trust=document.querySelector(".authTrust");
  if(trust){
    const link=document.createElement("a");
    link.href="./telegram-bots.html";
    link.textContent="Explore Telegram bots →";
    link.style.cssText="display:inline-flex;color:#8ed5ff;font-weight:750;padding:7px 0";
    trust.after(link);
  }
});
