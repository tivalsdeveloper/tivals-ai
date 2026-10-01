import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEmailRevision,canSendDraft} from '../supabase/functions/tivals-user-telegram/email-draft-rules.mjs';

test('email edit replaces body and keeps original subject by default',()=>{
  assert.deepEqual(parseEmailRevision('Thanks, I will check the details.','Re: Spring offer'),{subject:'Re: Spring offer',body:'Thanks, I will check the details.'});
});
test('email edit can replace subject and body without changing recipient',()=>{
  assert.deepEqual(parseEmailRevision('Subject: Re: Updated plan\nHello team,\nPlease send the list.','Old'),{subject:'Re: Updated plan',body:'Hello team,\nPlease send the list.'});
});
test('email edit rejects empty, command, and oversized content',()=>{
  for(const body of ['', '/send', 'x'.repeat(10001), 'Subject: New\n'])assert.throws(()=>parseEmailRevision(body,'Old'));
});
test('a draft cannot send while editing or after claiming the send',()=>{
  assert.equal(canSendDraft('pending'),true);
  assert.equal(canSendDraft('editing'),false);
  assert.equal(canSendDraft('sending'),false);
});
