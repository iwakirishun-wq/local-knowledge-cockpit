# Local Knowledge Cockpit

GitHub Pagesで配信する、ローカルJSON参照とGemini API返信作成用のWebアプリです。

## Privacy design

- 公開リポジトリに実ナレッジを含めません。
- 利用者が明示的に選択したJSONだけを、このタブのメモリ内で処理します。
- ファイルハンドル、ナレッジ、問い合わせ本文を永続保存しません。
- Gemini APIキーはGoogle Apps ScriptのScript Propertiesに保存し、HTMLやGitHubへ含めません。
- Apps Scriptは公開ウェブアプリとして動作しますが、Script Propertiesの`BRIDGE_TOKEN`が一致しない呼出しを拒否します。
- 問い合わせと検索で絞った最大8件の根拠だけを、自分のApps Script中継へ送ります。
- Apps Script中継はiframe内で動作し、許可したGitHub Pagesのオリジンだけを受け付けます。
- 個人情報の可能性があるメールアドレス、電話番号、長い番号を検出した場合は分析を停止します。
- `knowledge.example.json` は架空データだけを収録しています。
- `.gitignore` で `knowledge.example.json` 以外のJSONをGit管理対象外にします。

## GitHub Pages

1. このフォルダの内容だけを専用リポジトリのルートへ配置します。
2. Repository settings の Pages で `Deploy from a branch` を選択します。
3. `main` ブランチの `/(root)` を公開元に指定します。

以後はGitHub上でファイルを更新して `main` に反映すると、同じPages URLのアプリが更新されます。

## Use

1. Google Drive for desktopで自分のGドライブをPCへ同期します。
2. Pages URLをEdgeまたはChromeで開きます。
3. 自分のApps ScriptウェブアプリURLと`BRIDGE_TOKEN`を入力して`Geminiへ接続`を選択します。
4. Gドライブに同期した`チケット対応ナレッジ.json`を選択します。
5. ページを再読込した場合は、プライバシー保護のため再接続・再選択します。

`knowledge.example.json` は形式確認用です。実データの保存先として使用しないでください。
実ナレッジJSONはGドライブ側だけに置き、公開リポジトリへ強制追加しないでください。
アプリが参照する実データのファイル名は`チケット対応ナレッジ.json`です。選択後は画面にファイル名、根拠件数、生成日時が表示されます。

Gemini中継の導入手順とソースは`apps_script/README.md`にあります。
