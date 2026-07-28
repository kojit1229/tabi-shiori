# CLAUDE.md — tabi-shiori(旅のしおり+)

親ワークスペース(ClaudeCode/CLAUDE.md)の規律に従う。ここは本repo固有の追加ルールのみ。

## 鉄則
- このrepoは**公開**(GitHub Pages配信)。個人データ・家族の実名・トークン・旅程の実データを絶対に置かない。実データはprivateの `tabi-shiori-data` のみ
- ユーザー入力をHTMLへ埋め込むときは必ず `store.js` の `esc()` を通す(XSS防止)
- URL入力は `https?://` スキーム検証を必ず維持する(`javascript:` 注入防止)
- Service Worker(`sw.js`)のキャッシュ名は変更のたびに必ず v+1
- データ契約(trips/index.json・trips/<id>.json、後勝ち同期)は README 記載。変更はK承認必須

## 構成
- ES modules構成。`app.js`(ルーティング)→ `ui-*.js`(画面)→ `store.js`(状態)/`sync.js`(同期)/`github.js`(API)
- 新しい画面を足すときは `ui-*.js` を1ファイル追加し、`app.js` の route に1分岐足す形を守る
- テスト: 純ロジックは `node --test test/logic.test.mjs`(push前に必ず実行。ディレクトリ指定はWindowsで不安定なためファイル指定)。UI・同期はローカルサーバでの主要導線の手動確認を行う
