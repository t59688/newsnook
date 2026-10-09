-- 设备与登录会话的绑定。
--
-- 只记 Better Auth 的 session id（不记 token），撤销设备时据此把那台设备
-- 手里的会话一并作废——否则「撤销」只挡住了 deviceId 这一层，
-- 攻击者换一个 deviceId 就能拿同一个 token 继续同步。

CREATE TABLE IF NOT EXISTS device_sessions (
  user_id text NOT NULL,
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  session_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, session_id)
);

CREATE INDEX IF NOT EXISTS device_sessions_user_session_idx
  ON device_sessions (user_id, session_id);
