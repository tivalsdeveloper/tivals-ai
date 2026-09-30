import test from "node:test";
import assert from "node:assert/strict";
import {bookingDate} from "../supabase/functions/tivals-user-telegram/booking-time.mjs";
test("accepts natural booking dates in the South Africa default timezone",()=>{
  const now=new Date("2026-09-30T12:00:00Z");
  assert.equal(bookingDate("tomorrow at 2pm",now),"2026-10-01T12:00:00.000Z");
  assert.equal(bookingDate("Friday morning",now),"2026-10-02T07:00:00.000Z");
  assert.equal(bookingDate("5 October at 14:30",now),"2026-10-05T12:30:00.000Z");
  assert.equal(bookingDate("next Monday",now),"2026-10-05T07:00:00.000Z");
  assert.equal(bookingDate("Saturday at 10",now),"2026-10-03T08:00:00.000Z");
  assert.equal(bookingDate("Requested time: tomorrow at 2pm. Original request: 2026-10-05 09:00",now),"2026-10-01T12:00:00.000Z");
  assert.equal(bookingDate("yesterday at 2pm",now),null);
});
