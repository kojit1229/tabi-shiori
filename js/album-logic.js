// album-logic.js — アルバムの純ロジック(DOM非依存・テスト対象)
import { MAX_PHOTOS_PER_ITEM } from "./photos.js";

export const MAX_DAY_BUCKET = 20; // 日別「その他の写真」の上限

// 撮影日時から置き場所を決める:
//  - 日付が旅程内 → その日。時刻があれば「開始時刻を過ぎた最後の予定」に付ける(空きがある場合)。
//    先頭の予定より前に撮った写真は先頭の予定に付ける
//  - 予定が無い/満杯/時刻不明 → その日の「その他の写真」(day.photos)
//  - 日付が旅程外・不明 → null(呼び出し側がDay 1のその他へ入れる)
export function placePhoto(days, shot) {
  if (!shot || !shot.date) return null;
  const dayIdx = days.findIndex(d => d.date === shot.date);
  if (dayIdx < 0) return null;
  const day = days[dayIdx];
  if (shot.time) {
    const timed = (day.items || []).filter(x => x && x.time)
      .sort((a, b) => a.time.localeCompare(b.time));
    const target = [...timed].reverse().find(x => x.time <= shot.time) || timed[0];
    if (target && (target.photos || []).length < MAX_PHOTOS_PER_ITEM) {
      return { dayIdx, itemId: target.id };
    }
  }
  return { dayIdx, itemId: null };
}

// 日見出しの行程サマリ(最初の3件を「→」で繋ぐ)
export function daySummary(day) {
  const titles = (day.items || []).filter(x => x && x.title && !x.extra).map(x => x.title);
  if (!titles.length) return "";
  return titles.slice(0, 3).join(" → ") + (titles.length > 3 ? " …" : "");
}
