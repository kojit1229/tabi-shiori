// ui-settings.js — 設定: 名前・同期トークン・接続テスト・今すぐ同期
import { state, esc, saveSettings } from "./store.js";
import { checkAccess } from "./github.js";
import { pullAll, pushDirty } from "./sync.js";

export function renderSettings(view) {
  const s = state.settings;
  const tokenSet = Boolean(s.token);
  view.innerHTML = `
    <div class="sec-h">あなたの名前</div>
    <div class="card">
      <input type="text" id="set-name" value="${esc(s.memberName)}" placeholder="例: パパ">
      <div class="form-note">しおりの編集履歴・持ち物の担当・感想の名前に使われます。旅のメンバー名と同じ表記にしてください。</div>
    </div>

    <div class="sec-h">家族同期(GitHubトークン)</div>
    <div class="card">
      <label class="f">データ置き場(リポジトリ)</label>
      <input type="text" id="set-repo" value="${esc(s.dataRepo)}">
      <label class="f">アクセストークン ${tokenSet ? "(設定済み)" : "(未設定)"}</label>
      <input type="password" id="set-token" placeholder="${tokenSet ? "変更する場合だけ入力" : "github_pat_… を貼り付け"}" autocomplete="off">
      <div class="form-note">
        このトークンはパスワードではなく、上のデータ置き場だけを読み書きできる<b>専用の鍵</b>です。
        万一漏れても、この鍵だけをGitHub上ですぐ無効化できます。鍵はこの端末の中にだけ保存され、
        家族の各端末にそれぞれ設定します(設定方法は家族の管理者に聞いてください)。
      </div>
      <div class="modal-btns">
        <button class="btn ghost" id="btn-test">接続テスト</button>
        <button class="btn" id="btn-save">保存</button>
      </div>
      <div class="form-note" id="test-result"></div>
    </div>

    <div class="sec-h">同期</div>
    <div class="card">
      <button class="btn ghost" id="btn-sync">今すぐ同期</button>
      <div class="form-note">通常は自動で同期されます(変更の3秒後・アプリを開いた時・復帰時)。</div>
    </div>

    <div class="form-note" style="text-align:center;">旅のしおり+ v1(第1弾: しおり・持ち物・家族同期)</div>`;

  view.querySelector("#btn-save").addEventListener("click", () => {
    s.memberName = view.querySelector("#set-name").value.trim();
    s.dataRepo = view.querySelector("#set-repo").value.trim();
    const t = view.querySelector("#set-token").value.trim();
    if (t) s.token = t;
    saveSettings();
    view.querySelector("#test-result").textContent = "保存しました";
    pullAll();
  });

  view.querySelector("#btn-test").addEventListener("click", async () => {
    const out = view.querySelector("#test-result");
    const repo = view.querySelector("#set-repo").value.trim();
    const token = view.querySelector("#set-token").value.trim() || s.token;
    if (!repo || !token) { out.textContent = "リポジトリとトークンを入力してください"; return; }
    out.textContent = "確認中…";
    try {
      const r = await checkAccess(repo, token);
      out.textContent = r.msg;
    } catch {
      out.textContent = "接続できません(ネットワークを確認)";
    }
  });

  view.querySelector("#btn-sync").addEventListener("click", async () => {
    await pushDirty();
    await pullAll();
  });
}
