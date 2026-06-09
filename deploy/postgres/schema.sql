-- PVF AI Editor - PostgreSQL Schema
-- Phase 2: 用户、用量统计、会话管理

-- ─── 用户表 ───

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(100),
  plan          VARCHAR(20) NOT NULL DEFAULT 'free',  -- free / pro / enterprise
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);

-- ─── 每日用量表 ───

CREATE TABLE IF NOT EXISTS daily_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  ai_tokens_in  INTEGER NOT NULL DEFAULT 0,
  ai_tokens_out INTEGER NOT NULL DEFAULT 0,
  sessions      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_usage_user_date ON daily_usage(user_id, date);

-- ─── 会话表 ───

CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id     VARCHAR(100),           -- OpenCode server session ID
  model         VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  token_count   INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_server ON sessions(server_id);

-- ─── 交易/支付记录表 ───

CREATE TABLE IF NOT EXISTS transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          VARCHAR(20) NOT NULL,     -- purchase / usage / refund
  amount_cents  INTEGER NOT NULL,         -- 金额（分）
  currency      VARCHAR(3) NOT NULL DEFAULT 'CNY',
  description   TEXT,
  payment_method VARCHAR(50),             -- alipay / wechat / stripe
  payment_id    VARCHAR(255),             -- 第三方支付 ID
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending / completed / failed / refunded
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_status ON transactions(status);

-- ─── 刷新令牌表 ───

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    VARCHAR(255) NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ─── 用量配额视图 ───

CREATE OR REPLACE VIEW v_user_quota AS
SELECT
  u.id AS user_id,
  u.email,
  u.plan,
  du.tool_calls,
  du.ai_tokens_in + du.ai_tokens_out AS total_tokens,
  CASE u.plan
    WHEN 'free' THEN 50
    WHEN 'pro' THEN 1000
    WHEN 'enterprise' THEN 999999
  END AS daily_tool_limit,
  CASE u.plan
    WHEN 'free' THEN du.tool_calls >= 50
    WHEN 'pro' THEN du.tool_calls >= 1000
    WHEN 'enterprise' THEN FALSE
  END AS quota_exceeded
FROM users u
LEFT JOIN daily_usage du ON u.id = du.user_id AND du.date = CURRENT_DATE;

-- ─── 触发器: 自动更新 updated_at ───

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_daily_usage_updated BEFORE UPDATE ON daily_usage
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
