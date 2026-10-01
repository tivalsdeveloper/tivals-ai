import test from "node:test";
import assert from "node:assert/strict";
import {automaticButtons,cleanAnswer,menuRows,inlineChoiceRows,matchingMenuOption,selectionKey} from "../supabase/functions/tivals-user-telegram/button-rules.mjs";
test("yes or no buttons come from a server controlled marker or binary question",()=>{
  assert.deepEqual(automaticButtons("May I help? [ASK: yes_no]"),["✅ Yes","❌ No"]);
  assert.deepEqual(automaticButtons("Would you like to continue?"),["✅ Yes","❌ No"]);
  assert.equal(cleanAnswer("Would you like to continue? [ASK: yes_no]"),"Would you like to continue?");
  assert.deepEqual(automaticButtons("What device do you have?"),[]);
});
test("continue buttons and inline menu rows avoid duplicates",()=>{
  assert.deepEqual(automaticButtons("Ready to continue?"),["▶️ Continue","🏠 Main menu"]);
  assert.deepEqual(menuRows(["🍽 Menu","🍽 Menu","🛵 Order"]),[[{text:"🍽 Menu"},{text:"🛵 Order"}]]);
  assert.equal(matchingMenuOption("🍽 menu",["🍽 Menu","🛵 Order"]),"🍽 Menu");
});
test("choices render under a message with callback actions",()=>{
  assert.deepEqual(inlineChoiceRows(["✅ Yes","❌ No"]),[[
    {text:"✅ Yes",callback_data:"quick:yes"},{text:"❌ No",callback_data:"quick:no"}
  ]]);
  assert.deepEqual(inlineChoiceRows(["▶️ Continue","🏠 Main menu"]),[[
    {text:"▶️ Continue",callback_data:"quick:continue"},{text:"🏠 Main menu",callback_data:"quick:menu"}
  ]]);
});
test("one question has one selection key across callback retries and fast taps",()=>{
  assert.equal(selectionKey(12345,678),"selected:12345:678");
  assert.equal(selectionKey(12345,678),selectionKey(12345,678));
  assert.notEqual(selectionKey(12345,678),selectionKey(12345,679));
  assert.equal(selectionKey(12345,0),null);
});
