// app.js — 起動・ハッシュルーティング・ヘッダー描画・同期状態表示
import { state, esc, loadAll, fmtDate } from "./store.js";
import { pullAll, pushDirty, initSyncTriggers, onSyncChange, onDataChange } from "./sync.js";
import { renderShelf } from "./ui-shelf.js";
import { renderItinerary } from "./ui-itinerary.js";
import { renderPacking } from "./ui-packing.js";
import { renderSettings } from "./ui-settings.js";

const view = document.getElementById("view");
const headerTrip = document.getElementById("header-trip");
const headerTabs = document.getElementById("header-tabs");

function navigate(hash) { location.hash = hash; }

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/"); // "", settings, trip/<id>/<tab>
  if (parts[0] === "settings") {
    setHeader(null, null);
    renderSettings(view);
    return;
  }
  if (parts[0] === "trip" && parts[1]) {
    const trip = state.trips[parts[1]];
    if (!trip) { navigate("#/"); return; }
    state.currentTripId = trip.id;
    const tab = parts[2] === "packing" ? "packing" : "shiori";
    setHeader(trip, tab);
    if (tab === "packing") renderPacking(view, trip);
    else renderItinerary(view, trip);
    return;
  }
  state.currentTripId = null;
  setHeader(null, null);
  renderShelf(view, navigate);
}

function setHeader(trip, tab) {
  if (!trip) {
    headerTrip.innerHTML = "";
    headerTabs.hidden = true;
    return;
  }
  headerTrip.innerHTML = `
    <div class="trip-title">${esc(trip.title)}</div>
    <div class="trip-sub">${esc(fmtDate(trip.start))} − ${esc(fmtDate(trip.end))} ・ ${esc(trip.members.join("・"))}</div>`;
  headerTabs.hidden = false;
  for (const el of headerTabs.querySelectorAll(".pill")) {
    el.classList.toggle("on", el.dataset.tab === tab);
    el.href = `#/trip/${trip.id}/${el.dataset.tab}`;
  }
}

function renderSyncBar(sync) {
  const dot = document.querySelector("#syncbar .dot");
  const msg = document.getElementById("sync-msg");
  dot.className = `dot ${sync.st}`;
  msg.textContent = sync.msg;
}

function main() {
  loadAll();
  onSyncChange(renderSyncBar);
  // pullでリモート文書を取り込んだら再描画し、画面が古いtripオブジェクトを掴み続けないようにする。
  // ただし入力中・モーダル表示中は上書きしない(打鍵消失防止)
  onDataChange(() => {
    const dlg = document.getElementById("modal");
    const ae = document.activeElement;
    const editing = (dlg && dlg.open) || (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
    if (!editing) route();
  });
  window.addEventListener("hashchange", route);
  route();
  initSyncTriggers();
  // 起動時: pull → 表示最新化 → ローカルの方が新しい分を送信(B-3対応)
  pullAll().then(() => {
    route();
    return pushDirty();
  }).catch(() => {});
  // Service Worker は本番(https)のみ。localhost開発時はキャッシュが邪魔なので登録しない
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // ストレージ退避(iOSのbest-effort削除)をなるべく防ぐ
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

main();
