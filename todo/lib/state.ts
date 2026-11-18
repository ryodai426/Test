import { q } from './db';

/**
 * 画面に必要なデータを「1回の問い合わせ」でまとめて取る。
 * サーバーとデータベースが離れていると、問い合わせ1回ごとに往復の待ち時間がかかるため、
 * ログインの確認も含めて1往復で済ませる（以前は8往復していた）。
 */
const STATE_SQL = `
WITH me AS (
  SELECT u.id, u.name, u.tz, s.last_used_at
    FROM sessions s JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = $1 AND s.last_used_at > now() - interval '180 days'
),
my_groups AS (
  SELECT m.group_id FROM memberships m JOIN me ON m.user_id = me.id
),
g AS (
  SELECT g.id, g.name, g.description, g.color, g.is_personal, g.owner_id, g.notify_create, g.notify_done, g.created_at,
         CASE WHEN g.is_personal THEN null ELSE g.invite_token END AS invite_token,
         COALESCE(json_agg(json_build_object('id', mu.id, 'name', mu.name) ORDER BY m2.joined_at) FILTER (WHERE mu.id IS NOT NULL), '[]') AS members
    FROM groups g
    LEFT JOIN memberships m2 ON m2.group_id = g.id
    LEFT JOIN users mu ON mu.id = m2.user_id
   WHERE g.id IN (SELECT group_id FROM my_groups)
   GROUP BY g.id
),
t AS (
  SELECT t.id, t.user_id, t.group_id, t.status, t.title, t.description, t.kind, t.kind_id, t.assignees, t.starred, t.color,
         to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.duration_min, t.reminders, t.remind_all, t.repeat,
         t.captured_at, t.detailed_at, t.done_at, t.done_by, t.updated_at, t.created_at, t.date AS sort_date
    FROM tasks t
   WHERE t.group_id IN (SELECT group_id FROM my_groups)
     AND (t.status = 'ready' OR t.user_id = (SELECT id FROM me))
     AND (t.repeat IS NOT NULL OR t.date IS NULL OR t.date >= current_date - 70 OR t.done_at IS NULL)
),
cl AS (
  SELECT c.id, c.name, c.trigger, c.show_at, c.weekdays, c.position, c.created_at,
         COALESCE(json_agg(json_build_object('id', i.id, 'label', i.label, 'checked', cc.item_id IS NOT NULL) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
    FROM checklists c
    LEFT JOIN checklist_items i ON i.checklist_id = c.id
    LEFT JOIN checklist_checks cc ON cc.item_id = i.id AND cc.day = COALESCE($2::date, current_date)
   WHERE c.user_id = (SELECT id FROM me)
   GROUP BY c.id
)
SELECT
  (SELECT json_build_object('id', id, 'name', name, 'tz', tz, 'last_used_at', last_used_at) FROM me) AS me,
  COALESCE((SELECT json_agg(g ORDER BY g.is_personal DESC, g.created_at) FROM g), '[]') AS groups,
  COALESCE((SELECT json_agg(t ORDER BY t.sort_date NULLS LAST, t.time NULLS FIRST, t.created_at) FROM t), '[]') AS tasks,
  COALESCE((SELECT json_agg(json_build_object('task_id', d.task_id, 'occ_date', to_char(d.occ_date, 'YYYY-MM-DD'), 'user_id', d.user_id))
              FROM task_done d WHERE d.task_id IN (SELECT id FROM t) AND d.occ_date >= current_date - 70), '[]') AS done,
  COALESCE((SELECT json_agg(json_build_object('id', i.id, 'task_id', i.task_id, 'label', i.label, 'checked', i.checked, 'position', i.position) ORDER BY i.position, i.label)
              FROM task_items i WHERE i.task_id IN (SELECT id FROM t)), '[]') AS items,
  COALESCE((SELECT json_agg(json_build_object('task_id', r.task_id, 'occ_date', to_char(r.occ_date, 'YYYY-MM-DD'), 'user_id', r.user_id, 'emoji', r.emoji))
              FROM reactions r WHERE r.task_id IN (SELECT id FROM t) AND r.occ_date >= current_date - 70), '[]') AS reactions,
  COALESCE((SELECT json_agg(json_build_object('task_id', f.task_id, 'occ_date', to_char(f.occ_date, 'YYYY-MM-DD'), 'state', f.state, 'next_at', f.next_at, 'snooze_count', f.snooze_count))
              FROM task_followups f WHERE f.task_id IN (SELECT id FROM t) AND f.occ_date >= current_date - 2), '[]') AS followups,
  COALESCE((SELECT json_agg(cl ORDER BY cl.position, cl.created_at) FROM cl), '[]') AS checklists,
  COALESCE((SELECT json_agg(json_build_object('id', k.id, 'group_id', k.group_id, 'name', k.name) ORDER BY k.created_at)
              FROM task_kinds k WHERE k.group_id IN (SELECT group_id FROM my_groups)), '[]') AS kinds,
  COALESCE((SELECT json_agg(n) FROM (
              SELECT n.id, n.kind, n.task_id, to_char(n.occ_date, 'YYYY-MM-DD') AS occ_date, n.body, n.created_at, n.read_at, a.name AS actor
                FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
               WHERE n.user_id = (SELECT id FROM me) ORDER BY n.id DESC LIMIT 40) n), '[]') AS notifications
`;

export type LoadedState = {
  me: { id: string; name: string; tz: string; last_used_at: string } | null;
  groups: any[]; tasks: any[]; done: any[]; items: any[]; reactions: any[];
  checklists: any[]; kinds: any[]; notifications: any[]; followups: any[];
};

export async function loadState(tokenHash: string, day: string | null): Promise<LoadedState> {
  const [row] = await q<LoadedState>(STATE_SQL, [tokenHash, day]);
  for (const t of row.tasks) { delete t.sort_date; delete t.created_at; }
  for (const g of row.groups) delete g.created_at;
  for (const c of row.checklists) delete c.created_at;
  return row;
}
