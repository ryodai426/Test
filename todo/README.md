# わすれないYO

「忘れる前に気づかせる」共同タスク管理アプリ。スマホと会社のPCの両方から、同じ予定・メモを入れられます。

- **引き継ぎ用の要件定義書（最新・これを正とする）：[docs/要件定義書_引き継ぎ.md](docs/要件定義書_引き継ぎ.md)**
- 初期の検討メモ（古い）：[docs/要件定義書_ブラッシュアップ.md](docs/要件定義書_ブラッシュアップ.md)
- 構成：Next.js 15（App Router）＋ Postgres（Neon）＋ Web Push、Vercel にデプロイ

## デプロイ手順（Vercel + Neon）

このリポジトリのルートには別のアプリ（発明日記）があるので、**Vercel では別プロジェクトとして作り、Root Directory を `todo` にします。**

1. **Vercel** で「Add New → Project」→ このリポジトリを選び、**Root Directory = `todo`**
2. プロジェクトの「Storage」タブから **Neon** を追加（`DATABASE_URL` が自動で入る）
   - 表（テーブル）は、アプリが初めてデータベースを使うときに自動で作られます。SQL を流す作業は不要です
3. プッシュ通知の鍵を用意する（`npm run vapid` で出る2つの値。パソコンがなければ、Web の VAPID 鍵生成ツールでも可）
4. Environment Variables に以下を設定（`.env.example` 参照）
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`（`mailto:自分のメール`）
   - `CRON_SECRET`（長いランダム文字列）
5. 環境変数を入れたら Redeploy

### 時間どおりの通知を動かす（1分ごとの呼び出し）

会議の30分前・未記入メモの2分後などの通知は、サーバーが **1分ごとに `/api/cron` を呼ばれたとき** に送ります。
Vercel の Hobby プランの Cron は1日1回までなので、無料の外部サービスを使います。

- [cron-job.org](https://cron-job.org) などで、次の設定のジョブを作る
  - URL：`https://<あなたのドメイン>/api/cron`
  - 間隔：毎分
  - ヘッダー：`Authorization: Bearer <CRON_SECRET>`
- Vercel Pro なら `vercel.json` の `crons` で `* * * * *` を設定しても可（Vercel は `CRON_SECRET` を自動で付けて呼びます）

> アプリを開いている間は、ブラウザ側でも同じタイミングで画面に大きく表示します。外部の呼び出しがなくても、開いている間は気づけます。

### iPhone で通知を受け取るには
Safari で開き、共有ボタン →「ホーム画面に追加」→ ホーム画面のアイコンから開いて、⚙ 設定 →「この端末で通知を受け取る」。（iOS 16.4 以降）

## ローカル開発

```bash
cd todo
npm install
cp .env.example .env.local   # DATABASE_URL などを書く
npm run db:migrate
npm run dev
```

## ファイル構成

[docs/要件定義書_引き継ぎ.md](docs/要件定義書_引き継ぎ.md) の「4. ファイル構成」を見てください。
