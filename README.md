# Local Knowledge Cockpit

GitHub Pagesで配信する、ローカルJSON参照専用の静的Webアプリです。

## Privacy design

- 公開リポジトリに実ナレッジを含めません。
- 利用者が明示的に選択したJSONだけを、このタブのメモリ内で処理します。
- ファイルハンドル、ナレッジ、問い合わせ本文を永続保存しません。
- `connect-src 'none'` のCSPで、アプリからの外部通信を禁止します。
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
3. `GドライブのJSONを選択` から自分のナレッジJSONを1ファイルだけ選択します。
4. ページを再読込した場合は、プライバシー保護のため再選択します。

`knowledge.example.json` は形式確認用です。実データの保存先として使用しないでください。
実ナレッジJSONはGドライブ側だけに置き、公開リポジトリへ強制追加しないでください。
