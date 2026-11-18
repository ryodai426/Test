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

### 時間どおりの通知を動かす（10分おきの呼び出し）

会議の30分前・未記入メモなどの通知は、サーバーが **`/api/cron` を呼ばれたとき** にまとめて送ります。
リアルタイムでなくてよいので、**10分おき** に呼びます（通知は最大10分ほど遅れて届きます）。
Vercel の Hobby プランの Cron は1日1回までなので、無料の外部サービスを使います。

1. **Upstash Redis を追加する（Neon の無料枠を守るため。おすすめ）**
   - Vercel のプロジェクト → Storage → Create Database → Upstash（Redis）→ 無料プランで作って、このプロジェクトにつなぐ → Redeploy
   - 「次に通知を送る時刻」をここに置き、呼び出しのたびにデータベースを起こさずに済みます（時刻が来たときだけデータベースを見る）
   - なくても動きますが、その場合は呼び出しのたびにデータベースが起き、Neon の無料枠（月100 CU時間）を使い切る恐れがあります
2. [cron-job.org](https://cron-job.org) などで、次の設定のジョブを作る
   - URL：`https://<あなたのドメイン>/api/cron`
   - 間隔：10分おき（Every 10 minutes）
   - ヘッダー：`Authorization: Bearer <CRON_SECRET>`
3. `/api/health` の「通知の時刻の保存場所（Upstash Redis）」が OK になっていることを確かめる

`/api/cron` の返事の `checked` は、その回にデータベースを見たか（false ならデータベースを起こしていない）、`nextAt` は次に送る時刻です。`?force=1` を付けると、時刻に関係なく今すぐ確かめます。

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
