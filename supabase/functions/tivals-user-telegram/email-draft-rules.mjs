export function parseEmailRevision(value, currentSubject) {
  const input=String(value||'').trim();
  if(!input||input.length>10000||input.startsWith('/'))throw new Error('Send the revised email text, or /cancel to discard the draft.');
  const subjectLine=input.match(/^Subject:[ \t]*([^\r\n]+)\r?\n+([\s\S]+)$/i);
  if(/^Subject:/i.test(input)&&!subjectLine)throw new Error('Add an email body below the Subject line.');
  const subject=subjectLine?subjectLine[1].trim():String(currentSubject||'').trim();
  const body=(subjectLine?subjectLine[2]:input).trim();
  if(!subject||subject.length>200||/[\r\n]/.test(subject)||!body||body.length>10000)throw new Error('The subject or email body is too long or empty.');
  return {subject,body};
}
export function canSendDraft(status){return status==='pending';}
