// sync.js — ローカルファースト同期(pull起動時/復帰時、pushはデバウンス、後勝ち)
// 方針: リモートとローカルの updatedAt を比べ、新しい方を正とする(トリップ文書単位の後勝ち)。
// AI・サーバ不在でも全機能がローカルで動き、同期は「強化レイヤー」に留める。

import { state, saveTrips, normalizeTrip, nowIso } from "./store.js";
import { getJson, putJson, GithubError } from "./github.js";

const PUSH_DEBOUNCE_MS = 3000;
let pushTimer = null;
let dirtyIds = new Set();
let listeners = [];
let dataListeners = [];
let pulling = false;   // 再入防止(visibilitychange連続発火・同期ボタン連打)
let pushing = false;

export function onSyncChange(fn) { listeners.push(fn); }
// pullでリモート文書を取り込んだ(=stateのオブジェクトが差し替わった)ときに通知。
// UI側はこれを受けて再描画し、古いtrip参照を持ち続けない(孤児化防止)。
export function onDataChange(fn) { dataListeners.push(fn); }
function notifyDataChange() { for (const fn of dataListeners) fn(); }

function setStatus(st, msg) {
  state.sync = { st, msg, at: nowIso() };
  for (const fn of listeners) fn(state.sync);
}

function hasToken() {
  return Boolean(state.settings.token && state.settings.dataRepo);
}

export function markDirty(tripId) {
  saveTrips();
  if (!hasToken()) { setStatus("notoken", "ローカル保存のみ(同期は設定から)"); return; }
  dirtyIds.add(tripId);
  setStatus("dirty", "変更あり — まもなく同期します");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushDirty().catch(() => {}), PUSH_DEBOUNCE_MS);
}

// 起動時・フォアグラウンド復帰時に呼ぶ
export async function pullAll() {
  if (!hasToken()) { setStatus("notoken", "ローカル保存のみ(同期は設定から)"); return; }
  if (!navigator.onLine) { setStatus("offline", "オフライン — 電波回復時に同期します"); return; }
  if (pulling) return;
  pulling = true;
  const { dataRepo, token } = state.settings;
  setStatus("syncing", "同期中…");
  try {
    const idx = await getJson(dataRepo, "trips/index.json", token);
    const ids = new Set(Object.keys(state.trips));
    for (const meta of idx ? idx.data : []) {
      if (meta && meta.id) ids.add(meta.id);
    }
    let changed = false;
    for (const id of ids) changed = (await pullTrip(id)) || changed;
    setStatus("ok", `同期済み ${timeLabel()}`);
    if (changed) notifyDataChange();
  } catch (e) {
    setStatus("error", `同期エラー: ${e.message}`);
  } finally {
    pulling = false;
  }
}

// リモートを取り込んだら true を返す
async function pullTrip(id) {
  const { dataRepo, token } = state.settings;
  const remote = await getJson(dataRepo, `trips/${id}.json`, token);
  if (!remote) return false; // リモート未作成(ローカルのみ) → push側で作られる
  const local = state.trips[id];
  const r = normalizeTrip(remote.data);
  if (!local || (r.updatedAt || "") > (local.updatedAt || "")) {
    state.trips[id] = r; // 後勝ち: リモートが新しい
    saveTrips();
    return true;
  }
  if ((local.updatedAt || "") > (r.updatedAt || "")) {
    dirtyIds.add(id);    // ローカルが新しい → push対象
  }
  return false;
}

export async function pushDirty() {
  if (!hasToken()) return;
  if (!navigator.onLine) { setStatus("offline", "オフライン — 電波回復時に同期します"); return; }
  if (pushing || !dirtyIds.size) return;
  pushing = true;
  setStatus("syncing", "同期中…");
  try {
    for (const id of [...dirtyIds]) {
      if (await pushTrip(id)) dirtyIds.delete(id); // 競合で再キューされた分は消さない
    }
    await pushIndex();
    if (dirtyIds.size) {
      // 競合分が残っている: 「同期済み」とは言わず再試行を予約する
      setStatus("dirty", "未送信の変更あり — まもなく再送します");
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => pushDirty().catch(() => {}), PUSH_DEBOUNCE_MS);
    } else {
      setStatus("ok", `同期済み ${timeLabel()}`);
    }
  } catch (e) {
    if (e instanceof GithubError && (e.status === 401 || e.status === 404)) {
      // 設定不備は自動再試行しても直らない(永久リトライ防止)
      setStatus("error", "同期エラー: トークンとデータ置き場の設定を確認してください");
    } else {
      setStatus("error", `同期エラー: ${e.message}(自動で再試行します)`);
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => pushDirty().catch(() => {}), PUSH_DEBOUNCE_MS * 5);
    }
  } finally {
    pushing = false;
  }
}

// 成功(送信済み or リモート採用)なら true、競合再キューなら false
async function pushTrip(id) {
  const { dataRepo, token } = state.settings;
  const local = state.trips[id];
  if (!local) return true;
  const path = `trips/${id}.json`;
  const remote = await getJson(dataRepo, path, token);
  if (remote && (remote.data.updatedAt || "") > (local.updatedAt || "")) {
    state.trips[id] = normalizeTrip(remote.data); // 相手が新しければ取り込んで終わり(後勝ち)
    saveTrips();
    notifyDataChange();
    return true;
  }
  try {
    await putJson(dataRepo, path, token, local, remote ? remote.sha : null,
      `${local.title}: ${state.settings.memberName || "?"} が更新`);
    return true;
  } catch (e) {
    if (e instanceof GithubError && (e.status === 409 || e.status === 422)) {
      await pullTrip(id); // 競合 → 引き直して再push対象に残す
      dirtyIds.add(id);
      return false;
    }
    throw e;
  }
}

async function pushIndex() {
  const { dataRepo, token } = state.settings;
  const remote = await getJson(dataRepo, "trips/index.json", token);
  const map = new Map();
  for (const m of remote ? remote.data : []) if (m && m.id) map.set(m.id, m);
  for (const t of Object.values(state.trips)) {
    map.set(t.id, { id: t.id, title: t.title, start: t.start, end: t.end, updatedAt: t.updatedAt });
  }
  const merged = [...map.values()].sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  await putJson(dataRepo, "trips/index.json", token, merged,
    remote ? remote.sha : null, "index更新");
}

function timeLabel() {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function initSyncTriggers() {
  document.addEventListener("visibilitychange", () => {
    // 復帰時: pull→(ローカルが新しい分があれば)push。B-2/B-3対応
    if (document.visibilityState === "visible") pullAll().then(() => pushDirty()).catch(() => {});
  });
  window.addEventListener("online", () => pushDirty().then(() => pullAll()).catch(() => {}));
  window.addEventListener("offline", () => setStatus("offline", "オフライン — 端末に保存中"));
}
