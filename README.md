# 旅のしおり+

旅のしおり(行程表)と旅の記憶を家族で育てるWebアプリ(PWA)。
旅行前は「しおり・持ち物」、旅行中は「記録」、旅行後は「アルバム」として同じデータが育っていく。

- 配信: GitHub Pages(このrepoは公開。**個人データは置かない**)
- データ: private repo `tabi-shiori-data` に保存(fine-grained PATで読み書き)
- 構成: Vanilla JS(ES modules)+ localStorageローカルファースト+GitHub Contents API同期(後勝ち)

## 実装済み
- 第1弾: 旅の棚 / しおり(日別タイムライン)/ 持ち物(共通+個人)/ 家族同期
- 第2弾: 記録タブ(いまの予定・行った✓・ひとことメモ・代表写真・予定外の立ち寄り)。写真は端末内IndexedDB+縮小1600pxコピーをデータrepoへ同期

## 予定
- 第3弾: 記憶アルバム(写真の撮影日時で行程へ自動配置・iCloud共有アルバム連携)

## 開発
ローカル実行: リポジトリ直下で `python -m http.server 8848` → http://localhost:8848
テスト: `node --test test/logic.test.mjs`(純ロジック)。UI・同期は手動確認。
Service Workerはhttps(本番)のみ登録。キャッシュ名は変更のたびに v+1 する。

## データ契約(監督者確定・変更禁止)
- `trips/index.json` = `[{id,title,start,end,updatedAt}]`
- `trips/<id>.json` = トリップ文書(schema:1)。詳細は `js/store.js` 冒頭コメント
- `photos/<tripId>/<photoId>.jpg` = 代表写真の縮小コピー(長辺1600px JPEG)。パスは取込時に確定し、文書の `items[].photos[]` が参照。未アップロード間の404は「同期待ち」表示
- 同期は文書単位の後勝ち(updatedAt比較)。アプリ側は寛容パース(未知フィールド無視・欠損補完)
- 写真参照を外してもリモートのjpgは残る(孤児ファイル許容。整理は第3弾で検討)
