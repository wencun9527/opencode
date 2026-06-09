import React, { useState, useEffect, useCallback } from 'react';
import { Server, RefreshCw } from 'lucide-react';
import { opencodeClient, type SkillInfo, type CommandInfo } from '../services/opencodeClient';
import type { McpServerStatus } from '../types';

interface McpToolGroup {
  name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  tools: string[];
}

export const McpPanel: React.FC = () => {
  const [toolGroups, setToolGroups] = useState<McpToolGroup[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (!opencodeClient.isServerMode()) {
        setToolGroups([
          { name: 'pvfutility', status: 'disconnected', tools: ['pvf_browse', 'pvf_search', 'pvf_edit', 'pvf_save'] },
        ]);
        setMcpServers([]);
        return;
      }

      // 并行获取 MCP 服务器状态 + skills/commands
      const [mcpData, skills, commands] = await Promise.all([
        opencodeClient.getMcpStatus().catch(() => [] as McpServerStatus[]),
        opencodeClient.getSkills().catch(() => [] as SkillInfo[]),
        opencodeClient.getCommands().catch(() => [] as CommandInfo[]),
      ]);

      setMcpServers(mcpData);

      const groups: McpToolGroup[] = [];

      // 优先使用真实的 MCP 服务器数据
      if (mcpData.length > 0) {
        for (const srv of mcpData) {
          groups.push({
            name: srv.name,
            status: srv.status,
            tools: srv.tools?.map((t) => t.name) ?? [],
          });
        }
      }

      // Skills / Commands 作为补充
      if (skills.length > 0) {
        groups.push({
          name: 'Skills',
          status: 'connected',
          tools: skills.map((s) => s.id),
        });
      }

      if (commands.length > 0) {
        groups.push({
          name: 'Commands',
          status: 'connected',
          tools: commands.map((c) => c.id),
        });
      }

      // PVFut 本地工具
      const serverUrl = opencodeClient.getServerUrl();
      if (serverUrl) {
        try {
          const authHeader = 'Basic ' + btoa(`opencode:${import.meta.env.VITE_OPENCODE_PASSWORD || ''}`);
          const resp = await fetch(`${serverUrl}/api/health`, {
            headers: { 'Authorization': authHeader },
          });
          groups.push({
            name: 'PVFut',
            status: resp.ok ? 'connected' : 'disconnected',
            tools: ['pvf_browse', 'pvf_search', 'pvf_edit', 'pvf_save'],
          });
        } catch {
          groups.push({
            name: 'PVFut',
            status: 'disconnected',
            tools: ['pvf_browse', 'pvf_search', 'pvf_edit', 'pvf_save'],
          });
        }
      }

      if (groups.length === 0) {
        groups.push({ name: 'pvfutility', status: 'disconnected', tools: ['pvf_browse', 'pvf_search', 'pvf_edit', 'pvf_save'] });
      }

      setToolGroups(groups);
    } catch {
      setToolGroups([{ name: 'pvfutility', status: 'error', tools: [] }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleConnect = async (name: string) => {
    await opencodeClient.connectMcpServer(name);
    refresh();
  };

  const handleDisconnect = async (name: string) => {
    await opencodeClient.disconnectMcpServer(name);
    refresh();
  };

  const statusDotClass = (s: string) => {
    switch (s) {
      case 'connected': return 'bg-brand-green';
      case 'connecting': return 'bg-brand-amber';
      case 'error': return 'bg-brand-rose';
      default: return 'bg-t-3';
    }
  };

  const statusPillClass = (s: string) => {
    switch (s) {
      case 'connected': return 'bg-brand-green/10 text-brand-green';
      case 'connecting': return 'bg-brand-amber/10 text-brand-amber';
      case 'error': return 'bg-brand-rose/10 text-brand-rose';
      default: return 'bg-bg-3 text-t-3';
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case 'connected': return '已连接';
      case 'connecting': return '连接中';
      case 'error': return '错误';
      default: return '未连接';
    }
  };

  return (
    <div className="rounded-xl border border-bdr-1 bg-bg-2 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-bdr-1">
        <div className="flex items-center gap-2 text-sm font-medium text-t-1">
          <Server size={15} className="text-brand-blue" />
          MCP 服务状态
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-t-3 hover:text-t-1 hover:bg-bg-3 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>
      <div className="p-3">
        {toolGroups.length === 0 ? (
          <p className="text-t-3 text-sm">无 MCP 服务</p>
        ) : (
          <div className="space-y-3">
            {toolGroups.map((group) => {
              const srv = mcpServers.find((s) => s.name === group.name);
              return (
                <div key={group.name}>
                  <div
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => setExpanded(expanded === group.name ? null : group.name)}
                  >
                    <span className={`w-2 h-2 rounded-full ${statusDotClass(group.status)}`} />
                    <span className="text-sm font-medium text-t-1">{group.name}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${statusPillClass(group.status)}`}>
                      {statusLabel(group.status)}
                    </span>
                    {group.tools.length > 0 && (
                      <span className="text-[10px] text-t-3 ml-auto">{group.tools.length} 工具</span>
                    )}
                    {/* Connect / Disconnect buttons for real MCP servers */}
                    {srv && (
                      <div className="flex gap-1 ml-1">
                        {srv.status === 'connected' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDisconnect(srv.name); }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-bg-3 text-t-3 hover:text-t-1 transition-colors"
                          >
                            断开
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleConnect(srv.name); }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-brand-blue/10 text-brand-blue hover:bg-brand-blue/20 transition-colors"
                          >
                            连接
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {expanded === group.name && group.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5 pl-4">
                      {group.tools.map((tool) => (
                        <span key={tool} className="text-[11px] px-1.5 py-0.5 rounded bg-bg-3 text-t-2">
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
