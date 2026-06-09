import React, { useState } from 'react';
import { Globe, Key, Plus, Trash2, Bot, Zap, } from 'lucide-react';
import { useModelConfigStore } from '../stores/useModelConfigStore';
import clsx from 'clsx';

const API_PRESETS: { label: string; value: string; provider: string }[] = [
  { label: 'DeepSeek 官方', value: 'https://api.deepseek.com', provider: 'DeepSeek' },
  { label: 'OpenAI 官方', value: 'https://api.openai.com/v1', provider: 'OpenAI' },
  { label: '硅基流动', value: 'https://api.siliconflow.cn/v1', provider: 'SiliconFlow' },
  { label: '自定义', value: '', provider: 'Custom' },
];

export const ModelConfigPanel: React.FC = () => {
  const {
    apiBaseUrl, apiKey, customModels,
    setApiBaseUrl, setApiKey, addCustomModel, removeCustomModel, getAllModels,
  } = useModelConfigStore();

  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelProvider, setNewModelProvider] = useState('Custom');
  const [showKey, setShowKey] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const allModels = getAllModels();

  const handleAddModel = () => {
    const id = newModelId.trim();
    const name = newModelName.trim();
    if (!id || !name) return;
    addCustomModel({ id, name, provider: newModelProvider });
    setNewModelId('');
    setNewModelName('');
    setNewModelProvider('Custom');
  };

  const handlePresetSelect = (presetUrl: string) => {
    setApiBaseUrl(presetUrl);
  };

  return (
    <div className="rounded-xl border border-bdr-1 bg-bg-2 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-bdr-1 text-sm font-medium text-t-1">
        <Zap size={15} className="text-brand-blue" />
        模型 & API 配置
      </div>

      <div className="p-4 space-y-5">
        {/* API Endpoint */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-t-2 mb-2">
            <Globe size={13} /> API 端点
          </label>
          <div className="relative">
            <Globe size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-t-3" />
            <input
              type="text"
              placeholder="API Base URL（如 https://api.deepseek.com）"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              className="w-full bg-bg-1 border border-bdr-1 rounded-lg py-2 pl-9 pr-3 text-sm text-t-1 outline-none focus:border-brand-blue/50 transition-colors"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {API_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => handlePresetSelect(preset.value)}
                className={clsx(
                  'text-[11px] px-2 py-0.5 rounded-full transition-colors cursor-pointer',
                  apiBaseUrl === preset.value
                    ? 'bg-brand-blue/10 text-brand-blue'
                    : 'bg-bg-3 text-t-3 hover:text-t-1'
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* API Key */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-t-2 mb-2">
            <Key size={13} /> API Key
          </label>
          <div className="relative">
            <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-t-3" />
            <input
              type={showKey ? 'text' : 'password'}
              placeholder="输入 API Key（优先于 .env 配置）"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-bg-1 border border-bdr-1 rounded-lg py-2 pl-9 pr-16 text-sm text-t-1 mono outline-none focus:border-brand-blue/50 transition-colors"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-t-3 hover:text-t-1 px-1.5 py-0.5 rounded transition-colors"
            >
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
          <p className="text-[11px] text-t-3 mt-1">留空则使用 .env 中的 VITE_DEEPSEEK_API_KEY</p>
        </div>

        {/* Custom Models */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-t-2 mb-2">
            <Bot size={13} /> 自定义模型
          </label>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {allModels.map((m) => {
              const isCustom = customModels.some((cm) => cm.id === m.id);
              return (
                <div
                  key={m.id}
                  className={clsx(
                    'flex items-center justify-between px-3 py-1.5 rounded-lg text-xs',
                    isCustom ? 'bg-brand-blue/5' : 'bg-bg-3/50'
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Bot size={11} className="text-t-3 flex-shrink-0" />
                    <span className="text-t-1">{m.name}</span>
                    <span className="text-[10px] px-1 py-0.5 rounded bg-bg-3 text-t-3">{m.provider}</span>
                    <span className="text-[10px] text-t-3 mono truncate">{m.id}</span>
                  </div>
                  {isCustom && (
                    <button
                      onClick={() => removeCustomModel(m.id)}
                      className="p-0.5 rounded text-t-3 hover:text-brand-rose transition-colors flex-shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add model form */}
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 text-xs text-t-3 hover:text-t-1 mt-2 transition-colors"
          >
            <Plus size={12} />
            添加自定义模型
          </button>

          {showAddForm && (
            <div className="mt-2 p-3 rounded-lg border border-bdr-1 bg-bg-1 space-y-2 animate-fade-in">
              <input
                type="text"
                placeholder="模型 ID（如 gpt-4o-custom）"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                className="w-full bg-bg-2 border border-bdr-1 rounded-lg py-1.5 px-3 text-xs text-t-1 outline-none focus:border-brand-blue/50 transition-colors"
              />
              <input
                type="text"
                placeholder="显示名称"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                className="w-full bg-bg-2 border border-bdr-1 rounded-lg py-1.5 px-3 text-xs text-t-1 outline-none focus:border-brand-blue/50 transition-colors"
              />
              <select
                value={newModelProvider}
                onChange={(e) => setNewModelProvider(e.target.value)}
                className="w-full bg-bg-2 border border-bdr-1 rounded-lg py-1.5 px-3 text-xs text-t-1 outline-none focus:border-brand-blue/50 transition-colors"
              >
                <option value="Custom">Custom</option>
                <option value="DeepSeek">DeepSeek</option>
                <option value="OpenAI">OpenAI</option>
                <option value="Anthropic">Anthropic</option>
                <option value="SiliconFlow">SiliconFlow</option>
                <option value="OpenRouter">OpenRouter</option>
              </select>
              <button
                onClick={handleAddModel}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-brand-blue text-white text-xs font-medium hover:bg-brand-blue/80 transition-colors"
              >
                <Plus size={12} />
                添加模型
              </button>
            </div>
          )}
        </div>

        <p className="text-[11px] text-t-3">
          配置保存后重启服务生效；模型列表自动同步到顶部模型选择器
        </p>
      </div>
    </div>
  );
};
