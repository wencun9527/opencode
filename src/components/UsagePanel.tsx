import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { Zap, Crown, BarChart3 } from 'lucide-react';

interface QuotaInfo {
  plan: string;
  usage: number;
  limit: number;
  remaining: number;
  today: {
    tool_calls: number;
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
  };
}

export const UsagePanel: React.FC = () => {
  const { serverUrl, accessToken, user } = useAuthStore();
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchQuota = async () => {
      try {
        const res = await fetch(`${serverUrl}/auth/quota`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setQuota(data);
        }
      } catch {
        // 静默失败
      } finally {
        setLoading(false);
      }
    };
    fetchQuota();
    // 每 30 秒刷新
    const timer = setInterval(fetchQuota, 30_000);
    return () => clearInterval(timer);
  }, [serverUrl, accessToken]);

  if (loading) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 10, color: 'rgb(var(--t3))' }}>
        加载用量...
      </div>
    );
  }

  if (!quota) {
    return null;
  }

  const pct = quota.limit > 0 ? Math.min(100, (quota.usage / quota.limit) * 100) : 0;
  const planLabel: Record<string, string> = { free: '免费版', pro: '专业版', enterprise: '企业版', admin: '管理员' };
  const planColor: Record<string, string> = { free: 'rgb(var(--t3))', pro: 'rgb(var(--blue))', enterprise: 'rgb(var(--amber))', admin: 'rgb(var(--green))' };

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* Plan Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <Crown size={10} style={{ color: planColor[quota.plan] || 'rgb(var(--t3))' }} />
        <span style={{ fontSize: 10, fontWeight: 600, color: planColor[quota.plan] || 'rgb(var(--t3))' }}>
          {planLabel[quota.plan] || quota.plan}
        </span>
        <span style={{ fontSize: 9, color: 'rgb(var(--t3))', marginLeft: 'auto' }}>
          {user?.email}
        </span>
      </div>

      {/* Usage Bar */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'rgb(var(--t3))', marginBottom: 2 }}>
          <span>工具调用</span>
          <span>{quota.usage} / {quota.limit === 999999 ? '∞' : quota.limit}</span>
        </div>
        <div style={{ height: 3, borderRadius: 2, background: 'rgb(var(--bd1))', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              borderRadius: 2,
              background: pct > 90 ? 'rgb(var(--rose))' : pct > 70 ? 'rgb(var(--amber))' : 'rgb(var(--blue))',
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>

      {/* Token Usage */}
      {(quota.today.input_tokens > 0 || quota.today.output_tokens > 0) && (
        <div style={{ display: 'flex', gap: 8, fontSize: 9, color: 'rgb(var(--t3))', marginTop: 4 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <BarChart3 size={8} />
            {(quota.today.input_tokens + quota.today.output_tokens).toLocaleString()} tokens
          </span>
        </div>
      )}

      {/* Remaining */}
      <div style={{ fontSize: 9, color: 'rgb(var(--t3))', marginTop: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Zap size={8} />
        剩余 {quota.remaining} 次调用
      </div>
    </div>
  );
};
