// 純ロジックのテスト(DOM不要)。実行: node --test test/
import test from "node:test";
import assert from "node:assert/strict";

// store.js は localStorage をモジュール読込時には触らないためそのまま import できる
const { normalizeTrip, dateRange, ymd } = await import("../js/store.js");
const { pickNow } = await import("../js/ui-record.js");

test("normalizeTrip: 壊れた文書(null混入)を例外なく補完する", () => {
  const t = normalizeTrip({ days: [null, { items: [null, { id: "a" }] }], packing: { shared: [null] }, editLog: [null], title: 7 });
  assert.equal(t.days.length, 1);
  assert.equal(t.days[0].items.length, 1);
  assert.equal(t.packing.shared.length, 0);
  assert.equal(t.title, "無題の旅");
});

test("normalizeTrip: 写真参照はパス形式まで検証して弾く", () => {
  const t = normalizeTrip({
    days: [{ date: "2026-09-16", items: [{ id: "i1", photos: [
      { id: "ok1", path: "photos/trip-1/abc.jpg" },
      { id: "bad1", path: "photos/../secrets.json" },
      { id: "bad2", path: "trips/index.json" },
      { id: "bad3" },
      null,
    ] }] }],
  });
  const photos = t.days[0].items[0].photos;
  assert.equal(photos.length, 1);
  assert.equal(photos[0].id, "ok1");
});

test("dateRange: ローカルTZで日付がずれない・不正期間は開始日のみ", () => {
  assert.deepEqual(dateRange("2026-09-16", "2026-09-18"),
    ["2026-09-16", "2026-09-17", "2026-09-18"]);
  assert.deepEqual(dateRange("2026-09-16", "2026-09-15"), ["2026-09-16"]);
});

test("ymd: ゼロ埋めしたローカル日付", () => {
  assert.equal(ymd(new Date(2026, 8, 6)), "2026-09-06");
});

test("pickNow: 開始前はつぎの予定、開始後はいまの予定、通過後は最後の予定", () => {
  const items = [{ time: "09:00", title: "A" }, { time: "14:30", title: "B" }, { time: "", title: "時刻なし" }];
  assert.equal(pickNow(items, "08:00").label, "つぎの予定");
  assert.equal(pickNow(items, "08:00").item.title, "A");
  assert.equal(pickNow(items, "10:00").label, "いまの予定");
  assert.equal(pickNow(items, "10:00").item.title, "A");
  assert.equal(pickNow(items, "23:00").item.title, "B");
  assert.equal(pickNow([{ time: "", title: "x" }], "10:00"), null);
  assert.equal(pickNow([], "10:00"), null);
});
