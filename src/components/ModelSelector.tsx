import React, { useEffect, useState } from 'react';
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { Zap, Bot, ChevronDown } from 'lucide-react';
import { opencodeClient, type ServerModel, type ServerAgent } from '../services/opencodeClient';
import { useModelConfigStore } from '../stores/useModelConfigStore';

interface ModelSelectorProps {
  currentModel?: string;
  currentAgent?: string;
  onModelChange?: (model: string) => void;
  onAgentChange?: (agent: string) => void;
  disabled?: boolean;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentModel, currentAgent, onModelChange, onAgentChange, disabled,
}) => {
  const getAllModels = useModelConfigStore((s) => s.getAllModels);
  const builtinModels = getAllModels();
  const [serverModels, setServerModels] = useState<ServerModel[]>([]);
  const [serverAgents, setServerAgents] = useState<ServerAgent[]>([]);
  const [loaded, setLoaded] = useState(false);
  void loaded;

  useEffect(() => {
    // 从服务端动态获取模型和 Agent 列表
    const fetchServerData = async () => {
      try {
        const [models, agents] = await Promise.all([
          opencodeClient.getModels(),
          opencodeClient.getAgents(),
        ]);
        if (models.length > 0) setServerModels(models);
        if (agents.length > 0) setServerAgents(agents);
      } catch {
        // 使用本地缓存
        setServerModels(opencodeClient.availableModels);
        setServerAgents(opencodeClient.availableAgents);
      }
      setLoaded(true);
    };
    fetchServerData();
  }, []);

  // 合并：服务端优先，fallback 到本地
  const models = serverModels.length > 0
    ? serverModels.map(m => ({ id: m.id, name: m.name || m.id, provider: m.providerID }))
    : builtinModels;

  const agents = serverAgents.length > 0
    ? serverAgents.filter(a => !a.hidden).map(a => ({ id: a.id, name: a.name || a.id, description: a.description || '' }))
    : [
        { id: 'build', name: 'Build Agent', description: '代码助手（默认）' },
        { id: 'plan', name: 'Plan Agent', description: '规划模式（只读）' },
      ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Model Selector */}
      <Listbox value={currentModel || 'deepseek-chat'} onChange={onModelChange || (() => {})} disabled={disabled}>
        <div style={{ position: 'relative' }}>
          <ListboxButton style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 7, background: 'rgb(var(--b2))', border: '1px solid rgb(var(--bd1))', fontSize: 12, color: 'rgb(var(--t1))', cursor: 'pointer' }}>
            <Zap size={12} style={{ color: 'rgb(var(--amber))' }} />
            <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentModel || 'deepseek-chat'}</span>
            <ChevronDown size={12} style={{ color: 'rgb(var(--t3))' }} />
          </ListboxButton>
          <ListboxOptions style={{ position: 'absolute', zIndex: 50, marginTop: 4, maxHeight: 240, width: 220, overflow: 'auto', borderRadius: 8, border: '1px solid rgb(var(--bd1))', background: 'rgb(var(--b1))', padding: 4, boxShadow: '0 4px 20px rgba(0,0,0,.4)' }}>
            {models.map((m) => (
              <ListboxOption key={m.id} value={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 5, color: 'rgb(var(--t2))' }}>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'rgb(var(--b3))', color: 'rgb(var(--t3))', fontWeight: 500 }}>{m.provider}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>

      {/* Agent Selector */}
      <Listbox value={currentAgent || 'code'} onChange={onAgentChange || (() => {})} disabled={disabled}>
        <div style={{ position: 'relative' }}>
          <ListboxButton style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 7, background: 'rgb(var(--b2))', border: '1px solid rgb(var(--bd1))', fontSize: 12, color: 'rgb(var(--t1))', cursor: 'pointer' }}>
            <Bot size={12} style={{ color: 'rgb(var(--purple))' }} />
            <span style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agents.find(a => a.id === (currentAgent || 'code'))?.name || 'Code Agent'}</span>
            <ChevronDown size={12} style={{ color: 'rgb(var(--t3))' }} />
          </ListboxButton>
          <ListboxOptions style={{ position: 'absolute', zIndex: 50, marginTop: 4, width: 176, overflow: 'auto', borderRadius: 8, border: '1px solid rgb(var(--bd1))', background: 'rgb(var(--b1))', padding: 4, boxShadow: '0 4px 20px rgba(0,0,0,.4)' }}>
            {agents.map((a) => (
              <ListboxOption key={a.id} value={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 5, color: 'rgb(var(--t2))' }}>
                <span>{a.name}</span>
                {a.description && <span style={{ fontSize: 10, color: 'rgb(var(--t3))' }}>{a.description}</span>}
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>
    </div>
  );
};
