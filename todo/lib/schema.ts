// DB設計。初回にアプリが自動で実行する（何度実行しても安全）。
// 手で流したいときは npm run db:migrate
export const SCHEMA_SQL = `
-- わすれないYO スキーマ（何度実行しても安全）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  tz          text NOT NULL DEFAULT 'Asia/Tokyo',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 端末ごとのログイン（スマホ・会社PCなど）。使うたびに期限が延びる
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device       text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

-- 別の端末を追加するための6桁コード（10分間有効・1回限り）
CREATE TABLE IF NOT EXISTS link_codes (
  code        text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  color         text NOT NULL DEFAULT '#2BA0FF',
  is_personal   boolean NOT NULL DEFAULT false,
  owner_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_token  text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  notify_create boolean NOT NULL DEFAULT true,
  notify_done   boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- タスクと予定は1つの表にまとめる（「会議」は予定でもありタスクでもあるため）
CREATE TABLE IF NOT EXISTS tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id      uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'ready' CHECK (status IN ('draft','ready')),
  title         text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  kind          text NOT NULL DEFAULT 'general' CHECK (kind IN ('general','meeting','duty','shopping','reminder')),
  color         text,
  date          date,
  time          text,              -- 'HH:MM'。null なら終日／時刻なし
  duration_min  integer NOT NULL DEFAULT 60,
  reminders     text[] NOT NULL DEFAULT '{}',  -- '30' = 30分前, '0' = ちょうど, 'eve' = 前日20:00
  remind_all    boolean NOT NULL DEFAULT false, -- 共有グループのメンバー全員にも通知
  repeat        jsonb,             -- {freq:'daily'|'weekly'|'monthly', interval, weekdays:[0-6], until}
  captured_at   timestamptz NOT NULL DEFAULT now(),
  detailed_at   timestamptz,
  done_at       timestamptz,       -- 繰り返しなしタスクの完了
  done_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_group_idx ON tasks(group_id);

-- グループごとに自分たちで足せるタスクの種類（グループのメンバーで共有）
CREATE TABLE IF NOT EXISTS task_kinds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_kinds_name_idx ON task_kinds(group_id, lower(name));
-- 自分で足した種類を選んだタスク（kind は 'general' のまま、通知のタイミングも一般と同じ）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind_id uuid REFERENCES task_kinds(id) ON DELETE SET NULL;
-- 予定を表示する人（グループの予定）。NULL ＝「共通」（グループの全員）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignees uuid[];
-- 夕方の「今日の振り返り」を聞かない設定
ALTER TABLE users ADD COLUMN IF NOT EXISTS review_skip boolean NOT NULL DEFAULT false;
-- 星マーク（重要）。月表示などで、時間の長さより優先して出す
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false;

-- 「完了しましたか？」への返事（その日の分ごと）。snoozed ＝ まだ（next_at にもう一度）、held ＝ 保留
CREATE TABLE IF NOT EXISTS task_followups (
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occ_date     date NOT NULL,
  state        text NOT NULL CHECK (state IN ('snoozed','held')),
  snooze_count integer NOT NULL DEFAULT 0,
  next_at      timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, occ_date)
);

-- 繰り返しタスクの「その日の分」の完了
CREATE TABLE IF NOT EXISTS task_done (
  task_id   uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occ_date  date NOT NULL,
  user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  done_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, occ_date)
);

-- 買い物リストの品目（買い物タスクにぶら下がる）
CREATE TABLE IF NOT EXISTS task_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id   uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label     text NOT NULL,
  checked   boolean NOT NULL DEFAULT false,
  position  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reactions (
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occ_date   date NOT NULL,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, occ_date, user_id, emoji)
);

-- 持ち物チェックリスト
CREATE TABLE IF NOT EXISTS checklists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  trigger    text NOT NULL DEFAULT 'time' CHECK (trigger IN ('time','after_shopping','manual')),
  show_at    text,                 -- 'HH:MM'（trigger = time のとき）
  weekdays   integer[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  label        text NOT NULL,
  position     integer NOT NULL DEFAULT 0
);

-- チェック状態は「その日だけ」有効（毎日まっさらに戻る）
CREATE TABLE IF NOT EXISTS checklist_checks (
  item_id  uuid NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  day      date NOT NULL,
  PRIMARY KEY (item_id, day)
);

-- アプリ内のお知らせ（付箋）と履歴
CREATE TABLE IF NOT EXISTS notifications (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,        -- created | done | reaction | reminder | draft
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  task_id    uuid REFERENCES tasks(id) ON DELETE CASCADE,
  occ_date   date,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 同じリマインドを二重に送らないための記録
CREATE TABLE IF NOT EXISTS sent_reminders (
  key      text PRIMARY KEY,
  sent_at  timestamptz NOT NULL DEFAULT now()
);

-- アプリの情報（スキーマの版など）
CREATE TABLE IF NOT EXISTS app_meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- 端末追加コードの総当たり対策
CREATE TABLE IF NOT EXISTS auth_failures (
  ip  text NOT NULL,
  at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_failures_idx ON auth_failures(ip, at);
`;
