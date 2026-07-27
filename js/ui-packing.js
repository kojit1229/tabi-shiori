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
  // メンバーが1人もいない場合は追加欄の代わりに案内を出す(無言失敗防止。B-5)
  const personalBody = viewing
    ? `${personalRows}
      <div class="add-row">
        <input type="text" id="personal-text" placeholder="${esc(viewing)}の持ち物を追加">
        <button class="btn small" id="personal-add">追加</button>
      </div>`
    : `<div class="empty">メンバーが未設定です。<br>⚙️ 設定で「あなたの名前」を入れるか、旅のメンバーを登録してください</div>`;

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
    <div class="card" id="personal-list">${personalBody}</div>`;

  // 書き込み先を常に最新のtripオブジェクトへ解決する(同期pullで差し替わっても消えない。B-2)
  const fresh = () => state.trips[trip.id] || trip;
  const rerender = () => renderPacking(view, fresh());

  view.querySelector("#shared-add").addEventListener("click", () => {
    const text = view.querySelector("#shared-text").value.trim();
    if (!text) return;
    const assignee = view.querySelector("#shared-assignee").value;
    const t = fresh();
    t.packing.shared.push({ id: uid(), text, assignee, checked: false });
    logEdit(t, `持ち物を追加: ${text}`);
    markDirty(t.id); rerender();
  });
  const personalAdd = view.querySelector("#personal-add");
  if (personalAdd) personalAdd.addEventListener("click", () => {
    const text = view.querySelector("#personal-text").value.trim();
    if (!text || !viewing) return;
    const t = fresh();
    if (!t.packing.personal[viewing]) t.packing.personal[viewing] = [];
    t.packing.personal[viewing].push({ id: uid(), text, checked: false });
    logEdit(t, `${viewing}の持ち物を追加: ${text}`);
    markDirty(t.id); rerender();
  });
  const sel = view.querySelector("#viewer-sel");
  if (sel) sel.addEventListener("change", () => { state.packingViewer = sel.value; rerender(); });

  view.querySelectorAll(".check-row").forEach(el => {
    const shared = el.dataset.shared === "1";
    const pick = () => {
      const t = fresh();
      const list = shared ? t.packing.shared : (t.packing.personal[viewing] || []);
      return { t, list, item: list.find(x => x.id === el.dataset.id) };
    };
    el.querySelector(".cb").addEventListener("click", () => {
      const { t, item } = pick();
      if (!item) { rerender(); return; } // 同期で消えた項目 → 表示を最新化
      item.checked = !item.checked;
      logEdit(t, `${item.checked ? "✓" : "□"} ${item.text}`);
      markDirty(t.id); rerender();
    });
    el.querySelector(".del").addEventListener("click", () => {
      const { t, list, item } = pick();
      if (!item) { rerender(); return; }
      if (!confirm(`「${item.text}」を削除しますか?`)) return;
      const idx = list.indexOf(item);
      if (idx >= 0) list.splice(idx, 1);
      logEdit(t, `持ち物を削除: ${item.text}`);
      markDirty(t.id); rerender();
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
