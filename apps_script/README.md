# Gemini API Bridge

GitHub Pages版の問い合わせ画面から、APIキーを公開せずにGemini APIを利用するためのGoogle Apps Scriptです。

## Script Properties

Apps Scriptの「プロジェクトの設定」から次を登録します。

| Property | Value |
|---|---|
| `GEMINI_API_KEY` | Google AI Studioで発行したAPIキー |
| `GEMINI_MODEL` | `gemini-3.5-flash` |
| `ALLOWED_PARENT_ORIGIN` | `https://iwakirishun-wq.github.io` |

## Deploy

1. Google Apps Scriptで新しいプロジェクトを作成します。
2. `Code.gs`、`Bridge.html`、`appsscript.json`を登録します。
3. 「デプロイ」からウェブアプリとしてデプロイします。
4. 実行ユーザーは自分、アクセス権は自分のみを選択します。
5. 発行された`https://script.google.com/macros/s/.../exec`を問い合わせ画面へ入力します。

APIキーはHTML、GitHub、ナレッジJSONへ保存しません。
