import assert from "node:assert/strict";
import test from "node:test";
import { guardCronCall, reminderContext, vietnamTime } from "../src/reminder-policy.js";

const now = Date.parse("2026-10-18T22:26:51+07:00");
const addAt = (at: unknown) => ({ action: "add", job: { schedule: { kind: "at", at } } });

test("Vietnam clock rolls over at local midnight regardless of host timezone", () => {
  assert.equal(vietnamTime(Date.parse("2026-10-18T17:01:00Z")), "2026-10-19T00:01:00.000+07:00");
  assert.match(reminderContext(now), /2026-10-18T22:26:51.000\+07:00/);
});

test("rejects the observed UTC mistake and ambiguous schedule representations", () => {
  for (const at of ["2026-10-18T22:28:00Z", "2026-10-18T22:28:00", "22:28", "+2m", 1792337280000]) {
    assert.equal(guardCronCall("cron", addAt(at), now)?.block, true);
  }
});

test("accepts correct future Vietnam time and rejects the observed past 22:20 request", () => {
  assert.equal(guardCronCall("cron", addAt("2026-10-18T22:28:00+07:00"), now), undefined);
  assert.match(guardCronCall("cron", addAt("2026-10-18T22:20:00+07:00"), now)!.blockReason, /already passed/);
  assert.equal(guardCronCall("cron", addAt("2026-10-18T22:26:51+07:00"), now)?.block, true);
});

test("rejects impossible calendar dates", () => {
  for (const at of ["2027-02-30T10:00:00+07:00", "2027-13-01T10:00:00+07:00", "2027-01-01T24:00:00+07:00"]) {
    assert.equal(guardCronCall("cron", addAt(at), now)?.block, true);
  }
});

test("applies the guard to updates and requires explicit Vietnam recurring timezone", () => {
  assert.equal(guardCronCall("cron", { action: "update", patch: { schedule: { kind: "at", at: "2026-10-18T22:20:00+07:00" } } }, now)?.block, true);
  for (const tz of [undefined, "UTC"]) {
    assert.equal(guardCronCall("cron", { action: "add", job: { schedule: { kind: "cron", expr: "0 18 * * *", tz } } }, now)?.block, true);
  }
  assert.equal(guardCronCall("cron", { action: "add", job: { schedule: { kind: "cron", expr: "0 18 * * *", tz: "Asia/Ho_Chi_Minh" } } }, now), undefined);
});

test("leaves unrelated tools, relative intervals, reads and disabling schedules unchanged", () => {
  assert.equal(guardCronCall("other", addAt("bad"), now), undefined);
  for (const params of [{ action: "list" }, { action: "remove", jobId: "old" }, { action: "update", patch: { enabled: false } }, { action: "add", job: { schedule: { kind: "every", everyMs: 60000 } } }]) {
    assert.equal(guardCronCall("cron", params, now), undefined);
  }
});
