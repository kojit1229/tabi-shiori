// modal.js — <dialog>ベースの共通モーダル。フォームHTMLを受け取り、確定時に値を返す。
// 注意: html には esc() 済みの文字列のみ埋め込むこと(XSS防止はレンダリング側の責務)。

export function openModal({ title, html, okLabel = "保存", danger, onOk, onDanger }) {
  const dlg = document.getElementById("modal");
  dlg.innerHTML = `
    <h3>${title}</h3>
    <form method="dialog" id="modal-form">${html}
      <div class="modal-btns">
        <button type="button" class="btn ghost" data-act="cancel">キャンセル</button>
        ${danger ? `<button type="button" class="btn danger" data-act="danger">${danger}</button>` : ""}
        <button type="submit" class="btn" data-act="ok">${okLabel}</button>
      </div>
    </form>`;
  const form = dlg.querySelector("#modal-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const values = {};
    for (const el of form.querySelectorAll("[name]")) values[el.name] = el.value.trim();
    if (onOk && onOk(values) === false) return; // バリデーション失敗時は閉じない
    dlg.close();
  });
  dlg.querySelector('[data-act="cancel"]').addEventListener("click", () => dlg.close());
  const dbtn = dlg.querySelector('[data-act="danger"]');
  if (dbtn) dbtn.addEventListener("click", () => { if (onDanger) onDanger(); dlg.close(); });
  dlg.showModal();
}
