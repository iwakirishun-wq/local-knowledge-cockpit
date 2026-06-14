# Gemini API Bridge

GitHub Pages版の問い合わせ画面から、APIキーを公開せずにGemini APIを利用するためのGoogle Apps Scriptです。

## Script Properties

Apps Scriptの「プロジェクトの設定」から次を登録します。

| Property | Value |
|---|---|
| `GEMINI_API_KEY` | Google AI Studioで発行したAPIキー |
| `GEMINI_MODEL` | `gemini-3.5-flash` |
| `ALLOWED_PARENT_ORIGIN` | `https://iwakirishun-wq.github.io` |
| `BRIDGE_TOKEN` | 32文字以上の推測困難なランダム文字列 |

## Deploy

1. Google Apps Scriptで新しいプロジェクトを作成します。
2. `Code.gs`、`Bridge.html`、`appsscript.json`を登録します。
3. 「デプロイ」からウェブアプリとしてデプロイします。
4. 実行ユーザーは自分、アクセス権は全員を選択します。
5. 発行された`https://script.google.com/macros/s/.../exec`を問い合わせ画面へ入力します。
6. 問い合わせ画面の`中継トークン`にはScript Propertiesへ登録した`BRIDGE_TOKEN`を入力します。

APIキーと中継トークンはHTML、GitHub、ナレッジJSONへ保存しません。接続成功後、Apps Script URLと中継トークンはEdgeまたはChromeのパスワード管理へ保存され、次回は自動接続します。Web Storageへ平文保存はしません。

コード更新時は「デプロイを管理」から既存デプロイを編集し、バージョンを必ず「新バージョン」にして再デプロイしてください。コードを保存しただけでは`/exec`へ反映されません。

`generation_config.response_format.text.mime_type`のエラーが出る場合は、`Code.gs`の`mimeType`が`APPLICATION_JSON`になっている最新版を登録して再デプロイしてください。
