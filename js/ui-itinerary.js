// ui-itinerary.js — しおり(日別タブ+タイムライン、予定の追加・編集・削除)
import { state, esc, uid, logEdit, fmtDate } from "./store.js";
import { markDirty } from "./sync.js";
import { openModal } from "./modal.js";

export function renderItinerary(view, trip) {
  // 同期で days が欠けた文書が来ても、追加した予定が捨てられないよう実体を補う(B-4)
  if (!trip.days.length) trip.days.push({ date: trip.start, items: [] });
  if (state.currentDay >= trip.days.length) state.currentDay = 0;
  const day = trip.days[state.currentDay];

  let tabs = "";
  trip.days.forEach((d, i) => {
    tabs += `<button class="day-tab${i === state.currentDay ? " on" : ""}" data-i="${i}">${esc(fmtDate(d.date))}</button>`;
  });

  const items = [...day.items].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  let tl = "";
  for (const it of items) {
    // 描画側でもスキーム検証する(同期経由の文書に javascript: が混入しても実行させない。A-1)
    const safeUrl = /^https?:\/\//i.test(it.url || "") ? it.url : "";
    const linkChip = safeUrl
      ? `<a class="chip" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">🔗 リンク</a>`
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

  // 編集履歴(後勝ち同期で上書きされたときの確認手段。C-2)
  const logRows = [...trip.editLog].slice(-10).reverse().map(e =>
    `<div class="form-note">${esc(e.at.slice(5, 16).replace("T", " "))} ${esc(e.by)}: ${esc(e.action)}</div>`).join("");

  view.innerHTML = `
    <div class="day-tabs">${tabs}</div>
    <div class="tl">${tl}</div>
    <button class="add-dashed" id="add-item">＋ 予定を追加</button>
    <details class="card" style="margin-top:14px;">
      <summary style="font-size:12px; font-weight:700; color:var(--text-sub); cursor:pointer;">編集履歴(直近10件)</summary>
      ${logRows || `<div class="form-note">まだありません</div>`}
    </details>`;

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

// 書き込み先を常に最新のtripオブジェクトへ解決する。
// 編集中に同期pullが文書を差し替えても、確定した内容が旧オブジェクトへ消えない(B-2)
function resolveTarget(trip, day) {
  const t = state.trips[trip.id] || trip;
  let d = t.days.find(x => x.date === day.date);
  if (!d) { d = { date: day.date, items: [] }; t.days.push(d); }
  return { t, d };
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
      const { t, d } = resolveTarget(trip, day);
      const patch = { time: vals.time, title: vals.title, memo: vals.memo, url: vals.url };
      const target = isNew ? null : d.items.find(x => x.id === item.id);
      if (target) {
        Object.assign(target, patch);
        logEdit(t, `予定を編集: ${vals.title}`);
      } else {
        d.items.push({ id: isNew ? uid() : item.id, ...patch });
        logEdit(t, `予定を追加: ${vals.title}`);
      }
      markDirty(t.id);
      renderItinerary(view, t);
    },
    onDanger() {
      const { t, d } = resolveTarget(trip, day);
      d.items = d.items.filter(x => x.id !== item.id);
      logEdit(t, `予定を削除: ${item.title}`);
      markDirty(t.id);
      renderItinerary(view, t);
    },
  });
}
