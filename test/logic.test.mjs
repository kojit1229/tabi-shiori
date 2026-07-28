// 純ロジックのテスト(DOM不要)。実行: node --test test/
import test from "node:test";
import assert from "node:assert/strict";

// store.js は localStorage をモジュール読込時には触らないためそのまま import できる
const { normalizeTrip, dateRange, ymd } = await import("../js/store.js");
const { pickNow } = await import("../js/ui-record.js");
const { placePhoto, daySummary } = await import("../js/album-logic.js");
const { parseShotDateTime } = await import("../js/exif.js");

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

test("placePhoto: 撮影日時で予定へ、満杯・時刻不明はその日のその他へ、旅程外はnull", () => {
  const days = [
    { date: "2026-09-16", items: [
      { id: "a", time: "09:00", photos: [] },
      { id: "b", time: "14:30", photos: [{}, {}, {}, {}] }, // 満杯(4枚)
    ] },
    { date: "2026-09-17", items: [] },
  ];
  assert.deepEqual(placePhoto(days, { date: "2026-09-16", time: "10:00" }), { dayIdx: 0, itemId: "a" });
  assert.deepEqual(placePhoto(days, { date: "2026-09-16", time: "15:00" }), { dayIdx: 0, itemId: null }); // bは満杯
  assert.deepEqual(placePhoto(days, { date: "2026-09-16", time: "08:00" }), { dayIdx: 0, itemId: "a" }); // 最初の予定へ
  assert.deepEqual(placePhoto(days, { date: "2026-09-17", time: "10:00" }), { dayIdx: 1, itemId: null }); // 予定なし
  assert.deepEqual(placePhoto(days, { date: "2026-09-16", time: "" }), { dayIdx: 0, itemId: null });      // 時刻不明
  assert.equal(placePhoto(days, { date: "2026-10-01", time: "10:00" }), null);                            // 旅程外
  assert.equal(placePhoto(days, null), null);
});

test("daySummary: 予定外を除いた先頭3件を→で繋ぐ", () => {
  const day = { items: [
    { title: "A" }, { title: "B", extra: true }, { title: "C" }, { title: "D" }, { title: "E" },
  ] };
  assert.equal(daySummary(day), "A → C → D …");
  assert.equal(daySummary({ items: [] }), "");
});

test("parseShotDateTime: 最小EXIFからDateTimeOriginalを読む", () => {
  // 手組みの最小JPEG+EXIF(リトルエンディアン、ExifIFDにDateTimeOriginalのみ)
  const ascii = "2026:09:16 14:32:10\0";
  const tiff = [];
  const pushU16 = (a, x) => a.push(x & 0xff, (x >> 8) & 0xff);
  const pushU32 = (a, x) => a.push(x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff, (x >> 24) & 0xff);
  tiff.push(0x49, 0x49); pushU16(tiff, 0x2a); pushU32(tiff, 8); // "II" 42 IFD0@8
  pushU16(tiff, 1); // IFD0: 1エントリ(ExifIFDポインタ)
  pushU16(tiff, 0x8769); pushU16(tiff, 4); pushU32(tiff, 1); pushU32(tiff, 26); // ExifIFD@26
  pushU32(tiff, 0); // 次IFDなし
  pushU16(tiff, 1); // ExifIFD: 1エントリ(DateTimeOriginal)
  pushU16(tiff, 0x9003); pushU16(tiff, 2); pushU32(tiff, ascii.length); pushU32(tiff, 44); // 値@44
  pushU32(tiff, 0);
  for (const ch of ascii) tiff.push(ch.charCodeAt(0));
  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"+TIFF
  const seg = [0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff, ...app1];
  const jpeg = new Uint8Array([0xff, 0xd8, ...seg, 0xff, 0xd9]);
  assert.deepEqual(parseShotDateTime(jpeg.buffer), { date: "2026-09-16", time: "14:32" });
  assert.equal(parseShotDateTime(new Uint8Array([0, 1, 2]).buffer), null); // 非JPEG
});

test("parseShotDateTime: ビッグエンディアン(MM)のEXIFも読める", () => {
  const ascii = "2025:12:31 23:59:59\0";
  const tiff = [];
  const pushU16 = (a, x) => a.push((x >> 8) & 0xff, x & 0xff);
  const pushU32 = (a, x) => a.push((x >> 24) & 0xff, (x >> 16) & 0xff, (x >> 8) & 0xff, x & 0xff);
  tiff.push(0x4d, 0x4d); pushU16(tiff, 0x2a); pushU32(tiff, 8); // "MM" 42 IFD0@8
  pushU16(tiff, 1);
  pushU16(tiff, 0x8769); pushU16(tiff, 4); pushU32(tiff, 1); pushU32(tiff, 26);
  pushU32(tiff, 0);
  pushU16(tiff, 1);
  pushU16(tiff, 0x9003); pushU16(tiff, 2); pushU32(tiff, ascii.length); pushU32(tiff, 44);
  pushU32(tiff, 0);
  for (const ch of ascii) tiff.push(ch.charCodeAt(0));
  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const seg = [0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff, ...app1];
  const jpeg = new Uint8Array([0xff, 0xd8, ...seg, 0xff, 0xd9]);
  assert.deepEqual(parseShotDateTime(jpeg.buffer), { date: "2025-12-31", time: "23:59" });
  // 宣言サイズが実バッファ超(切詰め)でも例外なくnull
  assert.equal(parseShotDateTime(jpeg.buffer.slice(0, 20)), null);
});

test("normalizeTrip: 第3弾フィールド(albumUrl/day.photos/comments)の検証", () => {
  const t = normalizeTrip({
    albumUrl: "javascript:alert(1)",
    days: [{ date: "2026-09-16", photos: [{ id: "p", path: "photos/t/p.jpg" }, { id: "x", path: "trips/x.json" }],
      items: [{ id: "i", comments: [{ id: "c", by: "パパ", text: "良かった" }, { text: 5 }, null] }] }],
  });
  assert.equal(t.albumUrl, "");
  assert.equal(t.days[0].photos.length, 1);
  assert.equal(t.days[0].items[0].comments.length, 1);
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
