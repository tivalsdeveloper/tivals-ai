export function bookingDate(text,now=new Date()){
  const value=String(text||"");
  if(value.startsWith("Requested time: ")){const first=value.slice(16).split(". Original request:")[0];return bookingDate(first,now);}
  const match=value.match(/\b(20\d\d-\d\d-\d\d)[ T](\d\d:\d\d)(?:\s*(Z|[+-]\d\d:\d\d))?/);
  if(match){
    const date=new Date(`${match[1]}T${match[2]}${match[3]||'+02:00'}`);
    return Number.isFinite(date.getTime())&&date.getTime()>now.getTime()&&date.getTime()<now.getTime()+366*86400000?date.toISOString():null;
  }
  // Interpret common natural dates in the business's current default timezone.
  // The preview makes inferred time choices visible before the customer submits.
  const lower=value.toLowerCase();
  const time=lower.match(/(?:\bat\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)||lower.match(/\bat\s*(\d{1,2})(?::(\d{2}))?\b/);
  const hour=time?(Number(time[1])% (time[3]?12:24))+(time[3]==="pm"?12:0):/\bmorning\b/.test(lower)?9:/\bafternoon\b/.test(lower)?14:/\bevening\b/.test(lower)?18:/\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lower)?9:-1;
  const minute=time?Number(time[2]||0):0;
  if(hour<0||hour>23||minute>59)return null;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Africa/Johannesburg",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const pick=(name)=>Number(parts.find(part=>part.type===name)?.value);
  const year=pick("year"),month=pick("month"),day=pick("day");
  const base=new Date(Date.UTC(year,month-1,day));
  if(/\btomorrow\b/.test(lower))base.setUTCDate(base.getUTCDate()+1);
  else if(!/\btoday\b/.test(lower)){
    const days=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
    const dayMatch=lower.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    const named=lower.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
    if(dayMatch){let distance=(days.indexOf(dayMatch[1])-base.getUTCDay()+7)%7;if(!distance)distance=7;base.setUTCDate(base.getUTCDate()+distance);}
    else if(named){const months=["january","february","march","april","may","june","july","august","september","october","november","december"];base.setUTCMonth(months.indexOf(named[2]),Number(named[1]));if(base.getTime()<now.getTime()-86400000)base.setUTCFullYear(base.getUTCFullYear()+1);}
    else return null;
  }
  const date=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),base.getUTCDate(),hour-2,minute));
  return date.getTime()>now.getTime()&&date.getTime()<now.getTime()+366*86400000?date.toISOString():null;
}
