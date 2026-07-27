// ui-shelf.js — 旅の棚(ホーム): 旅一覧+新規作成
import { state, esc, tripIndex, createTrip, fmtDate, daysUntil } from "./store.js";
import { markDirty } from "./sync.js";
import { openModal } from "./modal.js";

const COVERS = [
  "linear-gradient(150deg, #6fc7dc, #1b7f9e)",
  "linear-gradient(150deg, #e0a069, #a65b40)",
  "linear-gradient(150deg, #9ec79a, #4e7d52)",
  "linear-gradient(150deg, #b79ad6, #6a4e8f)",
];

function coverFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COVERS[h % COVERS.length];
}

export function renderShelf(view, navigate) {
  const trips = tripIndex();
  let html = "";
  if (!trips.length) {
    html += `<div class="empty">まだ旅がありません。<br>「＋ 新しい旅をつくる」から始めましょう</div>`;
  }
  for (const m of trips) {
    const t = state.trips[m.id];
    const left = daysUntil(m.start);
    const leftEnd = daysUntil(m.end || m.start);
    const status = left > 0
      ? `<span class="badge plan">計画中</span>`
      : (leftEnd >= 0
        ? `<span class="badge plan">旅行中</span>`
        : `<span class="badge done">記録済み</span>`);
    const cnt = left > 0 ? `<div class="cnt">あと${left}日</div>` : "";
    const itemCount = t ? t.days.reduce((n, d) => n + d.items.length, 0) : 0;
    const packDone = t ? t.packing.shared.filter(p => p.checked).length : 0;
    const packAll = t ? t.packing.shared.length : 0;
    html += `
      <div class="card trip-card" data-id="${esc(m.id)}">
        <div class="cover" style="background:${coverFor(m.id)}">
          <div class="d">${esc(fmtDate(m.start))} − ${esc(fmtDate(m.end))}</div>${cnt}
        </div>
        <div class="t"><span>${esc(m.title)}</span>${status}</div>
        <div class="m">${t ? esc(t.members.join("・")) : ""} ・ しおり${itemCount}件 ・ 持ち物 ${packDone}/${packAll}</div>
      </div>`;
  }
  html += `<button class="btn ghost" id="new-trip">＋ 新しい旅をつくる</button>`;
  view.innerHTML = html;

  for (const el of view.querySelectorAll(".trip-card")) {
    el.addEventListener("click", () => navigate(`#/trip/${el.dataset.id}/shiori`));
  }
  view.querySelector("#new-trip").addEventListener("click", () => openNewTrip(navigate));
}

function openNewTrip(navigate) {
  openModal({
    title: "新しい旅をつくる",
    okLabel: "作成",
    html: `
      <label class="f">旅のタイトル</label>
      <input type="text" name="title" placeholder="例: 沖縄 家族旅行" required>
      <label class="f">出発日</label>
      <input type="date" name="start" required>
      <label class="f">帰着日</label>
      <input type="date" name="end" required>
      <label class="f">メンバー(「・」や読点で区切り)</label>
      <input type="text" name="members" placeholder="例: パパ・ママ・むすめ">
      <div class="form-note">メンバー名は持ち物の担当や感想の名前に使います。あとで設定からも直せます。旅程は最大30日分まで作られます。</div>`,
    onOk(v) {
      if (!v.title || !v.start || !v.end) return false;
      if (v.end < v.start) { alert("帰着日が出発日より前になっています"); return false; }
      const members = v.members.split(/[・,、\s]+/).filter(Boolean);
      const trip = createTrip({ title: v.title, start: v.start, end: v.end, members });
      markDirty(trip.id);
      navigate(`#/trip/${trip.id}/shiori`);
    },
  });
}
