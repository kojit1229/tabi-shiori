// ui-record.js — 記録(旅行中): いまの予定・行った✓・ひとことメモ・代表写真・予定外の立ち寄り
import { state, esc, uid, logEdit, fmtDate, ymd } from "./store.js";
import { markDirty } from "./sync.js";
import { openModal } from "./modal.js";
import { capturePhotos, photoURL, removeLocalPhoto, MAX_PHOTOS_PER_ITEM } from "./photos.js";

// 「いまの予定」の選定: 開始時刻を過ぎた最後の予定、なければ次の予定(純ロジック・テスト対象)
export function pickNow(items, nowHM) {
  const timed = items.filter(x => x && x.time);
  const cur = [...timed].reverse().find(x => x.time <= nowHM);
  const nxt = timed.find(x => x.time > nowHM);
  if (cur) return { item: cur, label: "いまの予定" };
  if (nxt) return { item: nxt, label: "つぎの予定" };
  return null;
}

export function renderRecord(view, trip) {
  if (!trip.days.length) trip.days.push({ date: trip.start, items: [] });
  // このタブを最初に開いたとき、きょうの日付タブを既定にする(しおりタブの選択日とは独立)
  if (state.recordDayInit !== trip.id) {
    const ti = trip.days.findIndex(d => d.date === ymd(new Date()));
    state.recordDay = ti >= 0 ? ti : 0;
    state.recordDayInit = trip.id;
  }
  if (state.recordDay == null || state.recordDay >= trip.days.length) state.recordDay = 0;
  const day = trip.days[state.recordDay];
  const items = [...day.items].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const isToday = day.date === ymd(new Date());

  let tabs = "";
  trip.days.forEach((d, i) => {
    tabs += `<button class="day-tab${i === state.recordDay ? " on" : ""}" data-i="${i}">${esc(fmtDate(d.date))}</button>`;
  });

  // いまの予定(きょうのタブのみ)
  let nowCard = "";
  if (isToday && items.length) {
    const picked = pickNow(items, new Date().toTimeString().slice(0, 5));
    if (picked) {
      nowCard = `
        <div class="now">
          <div class="lbl">${picked.label} ・ ${esc(picked.item.time)}</div>
          <div class="t">${esc(picked.item.title)}</div>
          ${picked.item.memo ? `<div class="m">${esc(picked.item.memo)}</div>` : ""}
        </div>`;
    }
  }

  const cards = items.map(it => {
    const photos = (it.photos || []).map(p =>
      `<span class="ph-thumb" data-pid="${esc(p.id)}"><img alt="写真"><button class="ph-del" data-pid="${esc(p.id)}">✕</button></span>`).join("");
    const canAdd = (it.photos || []).length < MAX_PHOTOS_PER_ITEM;
    return `
      <div class="rec-card${it.done ? " rec-done" : ""}" data-id="${esc(it.id)}">
        <div class="rec-head">
          <span class="time">${esc(it.time || "--:--")}</span>
          <span class="t">${esc(it.title)}</span>
          ${it.extra ? `<span class="badge extra">予定外</span>` : ""}
          <button class="done-btn${it.done ? " on" : ""}" data-id="${esc(it.id)}">${it.done ? "✓ 行った" : "行った?"}</button>
        </div>
        <input type="text" class="rec-note" data-id="${esc(it.id)}" placeholder="ひとことメモ" value="${esc(it.note || "")}">
        <div class="photo-strip" data-id="${esc(it.id)}">
          ${photos}
          ${canAdd ? `<label class="ph-add">＋<input type="file" accept="image/*" multiple hidden></label>` : ""}
        </div>
      </div>`;
  }).join("") || `<div class="empty">この日の予定はまだありません。<br>下の「予定外の立ち寄り」からも記録できます</div>`;

  view.innerHTML = `
    <div class="day-tabs">${tabs}</div>
    ${nowCard}
    ${cards}
    <button class="add-dashed" id="add-extra">＋ 予定外の立ち寄りを追加</button>`;

  // ---- イベント結線(書き込みは常に最新tripへ解決) ----
  const fresh = () => state.trips[trip.id] || trip;
  const freshItem = (id) => {
    const t = fresh();
    // 同期pullで該当日が消えていたらstateに繋がる実体を作り直す(孤児dayへの書き込み防止)
    let d = t.days.find(x => x.date === day.date);
    if (!d) { d = { date: day.date, items: [] }; t.days.push(d); }
    return { t, d, item: d.items.find(x => x.id === id) };
  };
  const rerender = () => renderRecord(view, fresh());

  for (const el of view.querySelectorAll(".day-tab")) {
    el.addEventListener("click", () => { state.recordDay = Number(el.dataset.i); rerender(); });
  }
  for (const el of view.querySelectorAll(".done-btn")) {
    el.addEventListener("click", () => {
      const { t, item } = freshItem(el.dataset.id);
      if (!item) { rerender(); return; }
      item.done = !item.done;
      logEdit(t, `${item.done ? "✓ 行った" : "□ 取り消し"}: ${item.title}`);
      markDirty(t.id); rerender();
    });
  }
  for (const el of view.querySelectorAll(".rec-note")) {
    el.addEventListener("change", () => {
      const { t, item } = freshItem(el.dataset.id);
      if (!item) return;
      item.note = el.value.trim();
      logEdit(t, `メモ: ${item.title}`);
      markDirty(t.id); // 入力中の打鍵を守るため再描画はしない
    });
  }
  for (const el of view.querySelectorAll(".ph-add input")) {
    el.addEventListener("change", async () => {
      const itemId = el.closest(".photo-strip").dataset.id;
      const before = freshItem(itemId);
      if (!before.item || !el.files.length) return;
      const files = [...el.files];
      const room = MAX_PHOTOS_PER_ITEM - (before.item.photos || []).length;
      const { refs, failed } = await capturePhotos(files.slice(0, room), before.t.id);
      // 縮小(await)中に同期pullが文書を差し替えた可能性があるため、書き込み先を引き直す
      const { t, item } = freshItem(itemId);
      if (!item) { rerender(); return; }
      item.photos = (item.photos || []).concat(refs);
      if (refs.length) {
        logEdit(t, `写真${refs.length}枚: ${item.title}`);
        markDirty(t.id);
      }
      rerender();
      const notes = [];
      if (failed) notes.push(`${failed}枚は取り込めませんでした`);
      if (files.length > room) notes.push(`1つの予定に付けられる写真は${MAX_PHOTOS_PER_ITEM}枚まで(${files.length - room}枚は未取込)`);
      if (notes.length) alert(notes.join("\n"));
    });
  }
  for (const el of view.querySelectorAll(".ph-del")) {
    el.addEventListener("click", () => {
      if (!confirm("この写真をしおりから外しますか?")) return;
      const pid = el.dataset.pid;
      const itemId = el.closest(".photo-strip").dataset.id;
      const { t, item } = freshItem(itemId);
      if (!item) { rerender(); return; }
      item.photos = (item.photos || []).filter(p => p.id !== pid);
      removeLocalPhoto(pid).catch(() => {});
      logEdit(t, `写真を削除: ${item.title}`);
      markDirty(t.id); rerender();
    });
  }
  view.querySelector("#add-extra").addEventListener("click", () => openExtraModal(view, trip, day));

  fillThumbnails(view);
}

// サムネイルを非同期に流し込む(未アップロード他端末分は「待ち」表示→定期再試行)
async function fillThumbnails(view) {
  const { dataRepo, token } = state.settings;
  const tripsAllPhotos = new Map();
  for (const t of Object.values(state.trips)) {
    for (const d of t.days) for (const it of d.items) for (const p of it.photos || []) tripsAllPhotos.set(p.id, p);
  }
  let waiting = false;
  for (const el of view.querySelectorAll(".ph-thumb")) {
    const ref = tripsAllPhotos.get(el.dataset.pid);
    if (!ref) continue;
    const url = await photoURL(ref, dataRepo, token);
    const img = el.querySelector("img");
    if (!img) continue;
    if (url) { img.src = url; el.classList.remove("ph-wait"); }
    else { el.classList.add("ph-wait"); waiting = true; }
  }
  // 写真本体は文書より後に届く(updatedAtも変わらない)ため、待ちが残る間は自前で取り直す
  if (waiting && view.isConnected) {
    setTimeout(() => { if (view.isConnected) fillThumbnails(view); }, 20000);
  }
}

function openExtraModal(view, trip, day) {
  const nowHM = new Date().toTimeString().slice(0, 5);
  openModal({
    title: `予定外の立ち寄り(${fmtDate(day.date)})`,
    okLabel: "記録する",
    html: `
      <label class="f">時刻</label>
      <input type="time" name="time" value="${esc(nowHM)}">
      <label class="f">場所・タイトル</label>
      <input type="text" name="title" placeholder="例: 北谷サンセットビーチ" required>
      <label class="f">ひとことメモ</label>
      <input type="text" name="note" placeholder="例: 夕日がすごかった">`,
    onOk(v) {
      if (!v.title) return false;
      const t = state.trips[trip.id] || trip;
      const d = t.days.find(x => x.date === day.date) || day;
      d.items.push({ id: uid(), time: v.time, title: v.title, memo: "", url: "", note: v.note, done: true, extra: true, photos: [] });
      logEdit(t, `予定外の立ち寄り: ${v.title}`);
      markDirty(t.id);
      renderRecord(view, t);
    },
  });
}
