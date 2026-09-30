import test from 'node:test';
import assert from 'node:assert/strict';
import {secureEqual,verifiedTelegramInitData} from '../supabase/functions/telegram-miniapp/security.mjs';
const enc=new TextEncoder();
async function sign(key,data){return crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']),enc.encode(data))}
async function signed(now,token='test-token'){
  const data=`auth_date=${now}\nuser={"id":123,"first_name":"Test"}`;
  const secret=await sign(enc.encode('WebAppData'),token);
  const hash=Array.from(new Uint8Array(await sign(secret,data)),x=>x.toString(16).padStart(2,'0')).join('');
  return `auth_date=${now}&user=${encodeURIComponent('{"id":123,"first_name":"Test"}')}&hash=${hash}`;
}
test('webhook secrets use fixed-size comparison',()=>{
  assert.equal(secureEqual('secret','secret'),true);
  assert.equal(secureEqual('secret','secrex'),false);
  assert.equal(secureEqual('secret','secret-more'),false);
});
test('initData verifies HMAC, freshness and identity',async()=>{
  const now=Math.floor(Date.now()/1000),valid=await signed(now);
  assert.equal((await verifiedTelegramInitData(valid,'test-token',now))?.id,123);
  assert.equal(await verifiedTelegramInitData(valid,'other-token',now),null);
  assert.equal(await verifiedTelegramInitData(valid.replace('Test','Attacker'),'test-token',now),null);
  assert.equal(await verifiedTelegramInitData(await signed(now-901),'test-token',now),null);
  assert.equal(await verifiedTelegramInitData(await signed(now+1),'test-token',now),null);
});
