# イベント申込ページ(独自版・Cloudflare Pages + Functions + KV)

Google フォームなどを使わず、完全に独自デザイン・独自ドメインで動く申込ページです。
複数イベントを管理画面から追加・編集・公開/非公開できます。

## 構成
- `index.html` … お客様向け。イベント選択→申込フォーム
- `admin.html` … 管理画面(パスコードで保護)。イベント作成・編集、申込一覧・ステータス管理
- `functions/api/events.js` … イベント情報のAPI
- `functions/api/entries.js` … 申込データのAPI
- データは Cloudflare KV(無料枠で十分)に保存されます

## デプロイ手順

### 1. KV Namespace を作る
Cloudflare ダッシュボード →「Workers & Pages」→「KV」→「Namespaceを作成」
名前は何でも良いですが、例:`hahatoko-events`

### 2. Pages プロジェクトを作る
すでにお持ちの haha-to-ko.jp のプロジェクトに追加するか、新しい Pages プロジェクトとして
このフォルダ一式(`index.html`・`admin.html`・`functions/`)をアップロード、または連携している
GitHubリポジトリにこのフォルダをそのまま追加してpushしてください。
(サブパス例:`haha-to-ko.jp/events/` に置く場合は、そのフォルダごとpushでOKです)

### 3. KV を Pages にバインドする
Pages プロジェクト →「設定」→「Functions」→「KV namespace bindings」→ 追加
- 変数名(Variable name): `EVENTS_KV`
- 選択する Namespace: 手順1で作ったもの

### 4. 管理画面のパスコードを設定する
Pages プロジェクト →「設定」→「環境変数」→ 追加
- 変数名: `ADMIN_PASSCODE`
- 値: 好きなパスコード(例:`hahatoko2026`など、他人に推測されにくいもの)

設定後、「再デプロイ」を1回行うと反映されます。

### 5. 公開URLを確認
- お客様向け:`https://(あなたのドメインまたはpages.devのURL)/`
- 管理画面:同じドメインの `/admin.html`

## 使い方
1. `/admin.html` を開いてパスコードでログイン
2. 「イベント管理」タブ →「＋新しいイベントを追加」でイベントを作成、「公開する」にチェックして保存
3. お客様には `/` のURL、または各イベントの「リンク取得」で発行される個別URL(`/?event=イベントID`)を案内
4. 申込内容は「申込一覧」タブから確認・ステータス管理

## 補足
- 辻堂9/18・doTERRA8/29 の内容は、以前Claude内で作ったフォームと同じ項目構成にしてあります。
  管理画面から同じ内容を入力し直せば、そのまま移行できます。
- パスコードはコード内に書かず環境変数にしているので、コードを人に見せても漏れません。
