import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Trash2, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { opencodeClient, type PermissionSavedInfo } from '../services/opencodeClient';
import { useChatStore } from '../stores/useChatStore';

export const PermissionManager: React.FC = () => {
  const [savedPermissions, setSavedPermissions] = useState<PermissionSavedInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const { pendingPermissions, removePermissionRequest, setAgentStatus } = useChatStore();

  const loadSaved = useCallback(async () => {
    setLoading(true);
    try {
      const result = await opencodeClient.listSavedPermissions();
      setSavedPermissions(result);
    } catch {
      setSavedPermissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const handleDelete = async (id: string) => {
    try {
      await opencodeClient.removeSavedPermission(id);
      setSavedPermissions((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // 忽略
    }
  };

  const handleApproveAll = async () => {
    for (const perm of pendingPermissions) {
      const sessionId = perm.sessionID || opencodeClient.getCurrentSessionId() || '';
      await opencodeClient.approvePermission(sessionId, perm.id, 'allow');
      removePermissionRequest(perm.id);
    }
    setAgentStatus('idle');
  };

  const handleRejectAll = async () => {
    for (const perm of pendingPermissions) {
      const sessionId = perm.sessionID || opencodeClient.getCurrentSessionId() || '';
      await opencodeClient.approvePermission(sessionId, perm.id, 'deny');
      removePermissionRequest(perm.id);
    }
    setAgentStatus('idle');
  };

  return (
    <div className="space-y-4">
      {/* Pending Permissions */}
      {pendingPermissions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-t-2 flex items-center gap-1.5">
              <Shield size={12} className="text-amber-400" />
              待审批 ({pendingPermissions.length})
            </h4>
            <div className="flex gap-1.5">
              <button
                onClick={handleApproveAll}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors border-0 cursor-pointer"
              >
                <CheckCircle size={10} /> 全部允许
              </button>
              <button
                onClick={handleRejectAll}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors border-0 cursor-pointer"
              >
                <XCircle size={10} /> 全部拒绝
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            {pendingPermissions.map((perm) => (
              <div key={perm.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                <Shield size={11} className="text-amber-400 flex-shrink-0" />
                <span className="text-[11px] text-t-1 flex-1 truncate">
                  <strong>{perm.toolName}</strong>
                  {perm.description && <span className="text-t-3"> — {perm.description}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved Permissions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-t-2 flex items-center gap-1.5">
            <Shield size={12} className="text-brand-blue" />
            已保存权限 ({savedPermissions.length})
          </h4>
          <button
            onClick={loadSaved}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-t-3 hover:text-t-1 hover:bg-bg-3 transition-colors border-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={9} className={loading ? 'animate-spin' : ''} /> 刷新
          </button>
        </div>
        {savedPermissions.length === 0 ? (
          <p className="text-[11px] text-t-3 px-1">暂无已保存权限规则</p>
        ) : (
          <div className="space-y-1">
            {savedPermissions.map((perm) => (
              <div key={perm.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-3/50 group">
                <CheckCircle size={10} className="text-brand-green flex-shrink-0" />
                <span className="text-[11px] text-t-2 flex-1 truncate">
                  {perm.toolName || perm.id}
                  {perm.description && <span className="text-t-3"> — {perm.description}</span>}
                </span>
                <button
                  onClick={() => handleDelete(perm.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-rose-500/10 border-0 cursor-pointer bg-transparent"
                >
                  <Trash2 size={10} className="text-rose-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
