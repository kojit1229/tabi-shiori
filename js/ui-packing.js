// ui-packing.js — 持ち物: 共通(担当つき)+ メンバー別リスト
import { state, esc, uid, logEdit } from "./store.js";
import { markDirty } from "./sync.js";

export function renderPacking(view, trip) {
  const me = state.settings.memberName;
  const members = trip.members.length ? trip.members : (me ? [me] : []);
  const viewing = members.includes(state.packingViewer) ? state.packingViewer
    : (members.includes(me) ? me : members[0] || "");
  state.packingViewer = viewing;
  if (viewing && !trip.packing.personal[viewing]) trip.packing.personal[viewing] = [];

  const sharedRows = trip.packing.shared.map(p => row(p, true)).join("")
    || `<div class="empty">まだありません</div>`;
  const personal = viewing ? (trip.packing.personal[viewing] || []) : [];
  const personalRows = personal.map(p => row(p, false)).join("")
    || `<div class="empty">まだありません</div>`;

  const memberOpts = members.map(m =>
    `<option value="${esc(m)}"${m === viewing ? " selected" : ""}>${esc(m)}</option>`).join("");
  const assigneeOpts = `<option value="">担当なし</option>` + members.map(m =>
    `<option value="${esc(m)}">${esc(m)}</option>`).join("");

  view.innerHTML = `
    <div class="sec-h">みんなで1つ(担当を決める)</div>
    <div class="card" id="shared-list">${sharedRows}
      <div class="add-row">
        <input type="text" id="shared-text" placeholder="持ち物を追加">
        <select id="shared-assignee">${assigneeOpts}</select>
        <button class="btn small" id="shared-add">追加</button>
      </div>
    </div>
    <div class="sec-h">ひとりずつ ${members.length ? `<select id="viewer-sel" style="width:auto; padding:4px 8px; font-size:12px;">${memberOpts}</select>` : ""}</div>
    <div class="card" id="personal-list">${personalRows}
      <div class="add-row">
        <input type="text" id="personal-text" placeholder="${esc(viewing || "メンバー")}の持ち物を追加">
        <button class="btn small" id="personal-add">追加</button>
      </div>
    </div>`;

  const rerender = () => renderPacking(view, trip);

  view.querySelector("#shared-add").addEventListener("click", () => {
    const text = view.querySelector("#shared-text").value.trim();
    if (!text) return;
    const assignee = view.querySelector("#shared-assignee").value;
    trip.packing.shared.push({ id: uid(), text, assignee, checked: false });
    logEdit(trip, `持ち物を追加: ${text}`);
    markDirty(trip.id); rerender();
  });
  view.querySelector("#personal-add").addEventListener("click", () => {
    const text = view.querySelector("#personal-text").value.trim();
    if (!text || !viewing) return;
    trip.packing.personal[viewing].push({ id: uid(), text, checked: false });
    logEdit(trip, `${viewing}の持ち物を追加: ${text}`);
    markDirty(trip.id); rerender();
  });
  const sel = view.querySelector("#viewer-sel");
  if (sel) sel.addEventListener("change", () => { state.packingViewer = sel.value; rerender(); });

  view.querySelectorAll(".check-row").forEach(el => {
    const shared = el.dataset.shared === "1";
    const list = shared ? trip.packing.shared : trip.packing.personal[viewing];
    const item = list.find(x => x.id === el.dataset.id);
    if (!item) return;
    el.querySelector(".cb").addEventListener("click", () => {
      item.checked = !item.checked;
      logEdit(trip, `${item.checked ? "✓" : "□"} ${item.text}`);
      markDirty(trip.id); rerender();
    });
    el.querySelector(".del").addEventListener("click", () => {
      if (!confirm(`「${item.text}」を削除しますか?`)) return;
      const idx = list.indexOf(item);
      if (idx >= 0) list.splice(idx, 1);
      logEdit(trip, `持ち物を削除: ${item.text}`);
      markDirty(trip.id); rerender();
    });
  });
}

function row(p, shared) {
  return `
    <div class="check-row${p.checked ? " on" : ""}" data-id="${esc(p.id)}" data-shared="${shared ? 1 : 0}">
      <button class="cb${p.checked ? " on" : ""}" aria-label="チェック"></button>
      <span class="txt">${esc(p.text)}</span>
      ${shared && p.assignee ? `<span class="who">${esc(p.assignee)}</span>` : ""}
      <button class="del" aria-label="削除">✕</button>
    </div>`;
}
