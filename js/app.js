// app.js — 起動・ハッシュルーティング・ヘッダー描画・同期状態表示
import { state, esc, loadAll, fmtDate } from "./store.js";
import { pullAll, initSyncTriggers, onSyncChange } from "./sync.js";
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
  window.addEventListener("hashchange", route);
  route();
  initSyncTriggers();
  pullAll().then(() => {
    // pull で他端末の変更を取り込んだ直後に表示を最新化する
    route();
  });
  // Service Worker は本番(https)のみ。localhost開発時はキャッシュが邪魔なので登録しない
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

main();
