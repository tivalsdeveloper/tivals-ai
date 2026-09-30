import test from "node:test";
import assert from "node:assert/strict";
import {automaticButtons,cleanAnswer,menuRows,matchingMenuOption} from "../supabase/functions/tivals-user-telegram/button-rules.mjs";
test("yes or no buttons come from a server controlled marker or binary question",()=>{
  assert.deepEqual(automaticButtons("May I help? [ASK: yes_no]"),["✅ Yes","❌ No"]);
  assert.deepEqual(automaticButtons("Would you like to continue?"),["✅ Yes","❌ No"]);
  assert.equal(cleanAnswer("Would you like to continue? [ASK: yes_no]"),"Would you like to continue?");
  assert.deepEqual(automaticButtons("What device do you have?"),[]);
});
test("continue buttons and persistent menu rows avoid duplicates",()=>{
  assert.deepEqual(automaticButtons("Ready to continue?"),["▶️ Continue","🏠 Main menu"]);
  assert.deepEqual(menuRows(["🍽 Menu","🍽 Menu","🛵 Order"]),[[{text:"🍽 Menu"},{text:"🛵 Order"}]]);
  assert.equal(matchingMenuOption("🍽 menu",["🍽 Menu","🛵 Order"]),"🍽 Menu");
});
