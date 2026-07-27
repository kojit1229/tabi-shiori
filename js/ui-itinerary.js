// ui-itinerary.js — しおり(日別タブ+タイムライン、予定の追加・編集・削除)
import { state, esc, uid, logEdit, fmtDate } from "./store.js";
import { markDirty } from "./sync.js";
import { openModal } from "./modal.js";

export function renderItinerary(view, trip) {
  if (state.currentDay >= trip.days.length) state.currentDay = 0;
  const day = trip.days[state.currentDay] || { date: trip.start, items: [] };

  let tabs = "";
  trip.days.forEach((d, i) => {
    tabs += `<button class="day-tab${i === state.currentDay ? " on" : ""}" data-i="${i}">${esc(fmtDate(d.date))}</button>`;
  });

  const items = [...day.items].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  let tl = "";
  for (const it of items) {
    const linkChip = it.url
      ? `<a class="chip" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">🔗 リンク</a>`
      : "";
    tl += `
      <div class="tl-item">
        <div class="tl-card" data-id="${esc(it.id)}">
          <div class="time">${esc(it.time || "--:--")}</div>
          <div class="t">${esc(it.title)}</div>
          ${it.memo ? `<div class="m">${esc(it.memo)}</div>` : ""}
          ${linkChip}
        </div>
      </div>`;
  }
  if (!items.length) tl = `<div class="empty">この日の予定はまだありません</div>`;

  view.innerHTML = `
    <div class="day-tabs">${tabs}</div>
    <div class="tl">${tl}</div>
    <button class="add-dashed" id="add-item">＋ 予定を追加</button>`;

  for (const el of view.querySelectorAll(".day-tab")) {
    el.addEventListener("click", () => {
      state.currentDay = Number(el.dataset.i);
      renderItinerary(view, trip);
    });
  }
  for (const el of view.querySelectorAll(".tl-card")) {
    el.addEventListener("click", (e) => {
      if (e.target.closest("a")) return; // リンクチップはそのまま開く
      const it = day.items.find(x => x.id === el.dataset.id);
      if (it) openItemModal(view, trip, day, it);
    });
  }
  view.querySelector("#add-item").addEventListener("click", () => openItemModal(view, trip, day, null));
}

function openItemModal(view, trip, day, item) {
  const isNew = !item;
  const v = item || { time: "", title: "", memo: "", url: "" };
  openModal({
    title: isNew ? `予定を追加(${fmtDate(day.date)})` : "予定を編集",
    danger: isNew ? null : "削除",
    html: `
      <label class="f">時刻</label>
      <input type="time" name="time" value="${esc(v.time)}">
      <label class="f">タイトル</label>
      <input type="text" name="title" value="${esc(v.title)}" placeholder="例: 美ら海水族館" required>
      <label class="f">メモ</label>
      <textarea name="memo" placeholder="例: ジンベエザメの餌やり 15:00">${esc(v.memo)}</textarea>
      <label class="f">リンク(地図・予約ページなど)</label>
      <input type="url" name="url" value="${esc(v.url)}" placeholder="https://…">`,
    onOk(vals) {
      if (!vals.title) return false;
      if (vals.url && !/^https?:\/\//.test(vals.url)) {
        alert("リンクは https:// で始まるURLを入れてください");
        return false;
      }
      if (isNew) {
        day.items.push({ id: uid(), time: vals.time, title: vals.title, memo: vals.memo, url: vals.url });
        logEdit(trip, `予定を追加: ${vals.title}`);
      } else {
        Object.assign(item, { time: vals.time, title: vals.title, memo: vals.memo, url: vals.url });
        logEdit(trip, `予定を編集: ${vals.title}`);
      }
      markDirty(trip.id);
      renderItinerary(view, trip);
    },
    onDanger() {
      day.items = day.items.filter(x => x.id !== item.id);
      logEdit(trip, `予定を削除: ${item.title}`);
      markDirty(trip.id);
      renderItinerary(view, trip);
    },
  });
}
