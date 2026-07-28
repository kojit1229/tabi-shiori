// ui-thumbs.js — サムネイル流し込みの共通処理(記録タブ・アルバムで共用)
// 未アップロード分(404)は「同期待ち」表示にし、画面が生きている間は20秒ごとに取り直す。
// 写真本体は文書より後に届き updatedAt も変わらないため、pull通知では再描画されない。
import { state } from "./store.js";
import { photoURL } from "./photos.js";

export async function fillThumbs(view) {
  const { dataRepo, token } = state.settings;
  const all = new Map();
  for (const t of Object.values(state.trips)) {
    for (const d of t.days) {
      for (const p of d.photos || []) all.set(p.id, p);
      for (const it of d.items) for (const p of it.photos || []) all.set(p.id, p);
    }
  }
  let waiting = false;
  for (const el of view.querySelectorAll(".ph-thumb")) {
    const ref = all.get(el.dataset.pid);
    if (!ref) continue;
    const url = await photoURL(ref, dataRepo, token);
    const img = el.querySelector("img");
    if (!img) continue;
    if (url) { img.src = url; el.classList.remove("ph-wait"); }
    else { el.classList.add("ph-wait"); waiting = true; }
  }
  if (waiting && view.isConnected) {
    setTimeout(() => { if (view.isConnected) fillThumbs(view); }, 20000);
  }
}
