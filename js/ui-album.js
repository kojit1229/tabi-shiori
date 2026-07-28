// ui-album.js — アルバム(旅行後): 行程×写真×感想の日別旅行記+EXIF自動配置の写真取込
import { state, esc, uid, logEdit, fmtDate, nowIso } from "./store.js";
import { markDirty } from "./sync.js";
import { openModal } from "./modal.js";
import { capturePhotos, removeLocalPhoto } from "./photos.js";
import { readShotDateTime } from "./exif.js";
import { placePhoto, daySummary, MAX_DAY_BUCKET } from "./album-logic.js";
import { fillThumbs } from "./ui-thumbs.js";

export function renderAlbum(view, trip) {
  // 同期で days が空の文書が来ても落ちない(他タブと同じガード)
  if (!trip.days.length) trip.days.push({ date: trip.start, items: [] });
  const daysHtml = trip.days.map((day, i) => {
    const items = [...day.items].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    const itemCards = items.map(it => {
      const quotes = [];
      if (it.note) quotes.push(quoteHtml(it.note, "旅行中のメモ"));
      for (const c of it.comments || []) quotes.push(quoteHtml(c.text, `${c.by || "?"} ・ あとから追加`, true));
      const thumbs = (it.photos || []).map(p => thumbHtml(p)).join("");
      return `
        <div class="card alb-card" data-item="${esc(it.id)}" data-day="${i}">
          <div class="alb-head">
            <span class="t">${esc(it.title)}</span>
            <span class="time">${esc(it.time || "")}</span>
            ${it.extra ? `<span class="badge extra">予定外の立ち寄り</span>` : ""}
            ${it.done ? `<span class="badge plan">✓</span>` : ""}
          </div>
          ${thumbs ? `<div class="alb-grid">${thumbs}</div>` : ""}
          ${quotes.join("")}
          <button class="alb-comment" data-item="${esc(it.id)}" data-day="${i}">＋ 感想を書く</button>
        </div>`;
    }).join("");
    const bucket = (day.photos || []).map(p => thumbHtml(p)).join("");
    const bucketCard = bucket
      ? `<div class="card alb-card" data-item="" data-day="${i}">
           <div class="alb-head"><span class="t">その他の写真</span></div>
           <div class="alb-grid">${bucket}</div>
         </div>`
      : "";
    return `
      <div class="day-head">Day ${i + 1} <small>${esc(fmtDate(day.date))}${daySummary(day) ? " " + esc(daySummary(day)) : ""}</small></div>
      ${itemCards || `<div class="empty">この日の記録はまだありません</div>`}
      ${bucketCard}`;
  }).join("");

  const albumLink = trip.albumUrl
    ? `<a class="linkout" href="${esc(trip.albumUrl)}" target="_blank" rel="noopener noreferrer">▶ この旅の写真・動画を全部見る(共有アルバム)</a>
       <button class="alb-linkedit" id="edit-album-url">リンクを変更</button>`
    : `<button class="add-dashed" id="edit-album-url">🔗 iCloud共有アルバムのリンクを設定</button>`;

  view.innerHTML = `
    <label class="btn ghost" style="margin-top:8px;">📷 写真を足す(撮影日時で自動配置)
      <input type="file" id="album-add" accept="image/*" multiple hidden>
    </label>
    ${daysHtml}
    <div style="margin-top:14px;">${albumLink}</div>`;

  // ---- 結線(書き込みは常に最新tripへ解決) ----
  const fresh = () => state.trips[trip.id] || trip;
  const rerender = () => renderAlbum(view, fresh());
  // 取込は長時間になり得るため、完了時にアルバムタブを離れていたら描き直さない(他タブの画面を壊さない)
  const rerenderIfActive = () => {
    if (view.isConnected && location.hash === `#/trip/${trip.id}/album`) rerender();
  };

  view.querySelector("#album-add").addEventListener("change", (e) =>
    importPhotos(e.target, trip.id).then(rerenderIfActive).catch(() => {
      alert("写真の取込中にエラーが発生しました");
      rerenderIfActive();
    }));
  view.querySelector("#edit-album-url").addEventListener("click", () => openAlbumUrlModal(view, trip));
  for (const el of view.querySelectorAll(".alb-comment")) {
    el.addEventListener("click", () => openCommentModal(view, trip, el.dataset.item));
  }
  for (const el of view.querySelectorAll(".ph-thumb")) {
    el.querySelector(".ph-del")?.addEventListener("click", (e) => { e.stopPropagation(); deletePhoto(view, trip, el); });
    el.addEventListener("click", () => openViewer(el));
  }
  fillThumbs(view);
}

function quoteHtml(text, by, blue) {
  return `<div class="quote${blue ? " blue" : ""}">${esc(text)}<div class="by">— ${esc(by)}</div></div>`;
}

function thumbHtml(p) {
  return `<span class="ph-thumb alb-thumb" data-pid="${esc(p.id)}"><img alt="写真"><button class="ph-del" data-pid="${esc(p.id)}">✕</button></span>`;
}

// 写真取込: EXIFの撮影日時 → placePhoto で行程へ自動配置。
// 重い処理(縮小・保存)の前に置き場所と空きを判定し、入らない写真はデコードすらしない
async function importPhotos(input, tripId) {
  const files = [...input.files];
  if (!files.length || !state.trips[tripId]) return;
  let placed = 0, bucketed = 0, unknown = 0, full = 0, failed = 0, changed = 0;
  for (const file of files) {
    try {
      const shot = await readShotDateTime(file); // 先頭256KBだけ読む軽い処理
      let cur = state.trips[tripId];
      if (!cur) break;
      if (!cur.days.length) cur.days.push({ date: cur.start, items: [] });
      const pos = placePhoto(cur.days, shot);
      const bucketDay = () => cur.days[pos ? pos.dayIdx : 0] || cur.days[0];
      if (!(pos && pos.itemId) && (bucketDay().photos || []).length >= MAX_DAY_BUCKET) {
        full++; continue; // 満杯なら縮小・保存をしない
      }
      const { refs, failed: f } = await capturePhotos([file], tripId);
      failed += f;
      if (!refs.length) continue;
      const ref = refs[0];
      cur = state.trips[tripId]; // 縮小(await)中の同期pullに備えて引き直す
      if (!cur) { await removeLocalPhoto(ref.id).catch(() => {}); break; }
      if (!cur.days.length) cur.days.push({ date: cur.start, items: [] });
      const pos2 = placePhoto(cur.days, shot);
      if (pos2 && pos2.itemId) {
        const item = cur.days[pos2.dayIdx].items.find(x => x.id === pos2.itemId);
        item.photos = (item.photos || []).concat([ref]);
        placed++;
      } else {
        const day = cur.days[pos2 ? pos2.dayIdx : 0] || cur.days[0];
        day.photos = day.photos || [];
        if (day.photos.length >= MAX_DAY_BUCKET) { full++; await removeLocalPhoto(ref.id).catch(() => {}); continue; }
        day.photos.push(ref);
        if (pos2) bucketed++; else unknown++;
      }
      changed++;
    } catch { failed++; }
  }
  const t = state.trips[tripId];
  if (changed && t) {
    logEdit(t, `アルバムに写真を${changed}枚追加`);
    markDirty(t.id);
  }
  const notes = [];
  if (placed) notes.push(`${placed}枚を予定に自動配置しました`);
  if (bucketed) notes.push(`${bucketed}枚は「その他の写真」へ`);
  if (unknown) notes.push(`${unknown}枚は撮影日が旅程外・不明のためDay 1の「その他」へ`);
  if (full) notes.push(`${full}枚は上限(1日${MAX_DAY_BUCKET}枚)のため取り込みませんでした`);
  if (failed) notes.push(`${failed}枚は取り込めませんでした`);
  if (notes.length) alert(notes.join("\n"));
}

function findPhotoContext(trip, thumbEl) {
  const card = thumbEl.closest(".alb-card");
  const dayIdx = Number(card.dataset.day);
  const itemId = card.dataset.item;
  const day = trip.days[dayIdx];
  if (!day) return null;
  const list = itemId ? (day.items.find(x => x.id === itemId) || {}).photos : day.photos;
  return { list: list || [], pid: thumbEl.dataset.pid };
}

function deletePhoto(view, trip, thumbEl) {
  if (!confirm("この写真をアルバムから外しますか?")) return;
  const t = state.trips[trip.id] || trip;
  const ctx = findPhotoContext(t, thumbEl);
  if (!ctx) return;
  const idx = ctx.list.findIndex(p => p.id === ctx.pid);
  if (idx >= 0) ctx.list.splice(idx, 1);
  removeLocalPhoto(ctx.pid).catch(() => {});
  logEdit(t, "アルバムの写真を削除");
  markDirty(t.id);
  renderAlbum(view, t);
}

function openViewer(thumbEl) {
  const img = thumbEl.querySelector("img");
  if (!img || !img.src || thumbEl.classList.contains("ph-wait")) return;
  openModal({
    title: "写真",
    okLabel: "閉じる",
    html: `<img src="${esc(img.src)}" style="max-width:100%; border-radius:10px;" alt="写真拡大">`,
    onOk() {},
  });
}

function openCommentModal(view, trip, itemId) {
  openModal({
    title: "感想を書く",
    okLabel: "追加",
    html: `
      <label class="f">名前</label>
      <input type="text" name="by" value="${esc(state.settings.memberName)}" placeholder="例: パパ">
      <label class="f">感想</label>
      <textarea name="text" placeholder="例: ジンベエザメでかすぎて固まった" required></textarea>`,
    onOk(v) {
      if (!v.text) return false;
      const t = state.trips[trip.id] || trip;
      // dayIdxは同期pullで並びが変わり得るため、item idで全日から引き直す
      let item = null;
      for (const d of t.days) {
        item = d.items.find(x => x.id === itemId);
        if (item) break;
      }
      if (!item) {
        alert("この予定は他の端末で変更されたため、感想を追加できませんでした");
        renderAlbum(view, t);
        return;
      }
      item.comments = item.comments || [];
      item.comments.push({ id: uid(), by: v.by || "(名前未設定)", text: v.text, at: nowIso() });
      logEdit(t, `感想: ${item.title}`);
      markDirty(t.id);
      renderAlbum(view, t);
    },
  });
}

function openAlbumUrlModal(view, trip) {
  openModal({
    title: "共有アルバムのリンク",
    okLabel: "保存",
    danger: trip.albumUrl ? "リンクを外す" : null,
    html: `
      <label class="f">iCloud共有アルバムのURL</label>
      <input type="url" name="url" value="${esc(trip.albumUrl || "")}" placeholder="https://www.icloud.com/sharedalbum/…">
      <div class="form-note">iPhoneの写真アプリで共有アルバムを作り「公開Webサイト」をオンにするとリンクをコピーできます。リンクを知っている人は誰でも見られる点に注意。</div>`,
    onOk(v) {
      if (v.url && !/^https:\/\//.test(v.url)) { alert("https:// で始まるURLを入れてください"); return false; }
      const t = state.trips[trip.id] || trip;
      t.albumUrl = v.url;
      logEdit(t, "共有アルバムリンクを設定");
      markDirty(t.id);
      renderAlbum(view, t);
    },
    onDanger() {
      const t = state.trips[trip.id] || trip;
      t.albumUrl = "";
      logEdit(t, "共有アルバムリンクを解除");
      markDirty(t.id);
      renderAlbum(view, t);
    },
  });
}
