import React, { useState } from 'react';
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import type { ToolCall, ToolCallStatus } from '../types';

interface ToolCallCardProps {
  toolCall: ToolCall;
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  void copied;

  const getStatusConfig = (status: ToolCallStatus) => {
    switch (status) {
      case 'running':
        return { icon: <Loader2 size={10} className="anim-spin" />, text: '运行中', color: 'rgb(var(--cyan))', bg: 'rgb(var(--cyan) / .1)', cls: 'run' };
      case 'completed':
        return { icon: <CheckCircle size={10} />, text: '成功', color: 'rgb(var(--green))', bg: 'rgb(var(--green) / .1)', cls: 'ok' };
      case 'error':
        return { icon: <XCircle size={10} />, text: '失败', color: 'rgb(var(--rose))', bg: 'rgb(var(--rose) / .1)', cls: 'ok' };
      case 'pending_approval':
        return { icon: <Loader2 size={10} className="anim-spin" />, text: '待审批', color: 'rgb(var(--amber))', bg: 'rgb(var(--amber) / .1)', cls: 'run' };
    }
  };

  const statusConfig = getStatusConfig(toolCall.status);
  const duration =
    toolCall.endTime && toolCall.endTime > toolCall.startTime
      ? `${(toolCall.endTime - toolCall.startTime).toFixed(0)}ms`
      : null;

  const _handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };
  void _handleCopy;

  return (
    <div className={`tc ${statusConfig.cls}`}>
      {/* Header */}
      <button className="tc-h" onClick={() => setExpanded(!expanded)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--t3))" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
        <span className="tc-n">{toolCall.name}</span>
        <span className="tc-sp" />
        {duration && <span className="tc-e">{duration}</span>}
        <div className="tc-st" style={{ background: statusConfig.bg, color: statusConfig.color }}>
          {statusConfig.icon}
          {statusConfig.text}
        </div>
        {expanded ? <ChevronDown size={12} style={{ color: 'rgb(var(--t3))' }} /> : <ChevronRight size={12} style={{ color: 'rgb(var(--t3))' }} />}
      </button>

      {/* Detail */}
      {expanded && (
        <div className="tc-d">
          <div className="dl">参数</div>
          <pre>{JSON.stringify(toolCall.arguments, null, 2)}</pre>
          {toolCall.result !== undefined && (
            <div style={{ marginTop: 6 }}>
              <div className="dl">结果</div>
              <pre>{typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
