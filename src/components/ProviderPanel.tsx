import React, { useState, useEffect, useCallback } from 'react';
import { Cloud, ChevronRight, RefreshCw, Key } from 'lucide-react';
import { opencodeClient, type ProviderInfo, type ServerModel } from '../services/opencodeClient';

export const ProviderPanel: React.FC = () => {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [providerModels, setProviderModels] = useState<ServerModel[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const result = await opencodeClient.getProviders();
      setProviders(result);
    } catch {
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  const handleSelectProvider = async (providerId: string) => {
    if (selectedProvider === providerId) {
      setSelectedProvider(null);
      setProviderModels([]);
      return;
    }
    setSelectedProvider(providerId);
    try {
      // 获取所有模型，然后过滤出属于当前 provider 的
      const allModels = await opencodeClient.getModels();
      setProviderModels(allModels.filter((m) => m.providerID === providerId));
    } catch {
      setProviderModels([]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-t-2 flex items-center gap-1.5">
          <Cloud size={12} className="text-brand-blue" />
          AI 提供商 ({providers.length})
        </h4>
        <button
          onClick={loadProviders}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-t-3 hover:text-t-1 hover:bg-bg-3 transition-colors border-0 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={9} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>

      {providers.length === 0 ? (
        <p className="text-[11px] text-t-3 px-1">暂无可用提供商</p>
      ) : (
        <div className="space-y-1">
          {providers.map((provider) => (
            <div key={provider.id}>
              <button
                onClick={() => handleSelectProvider(provider.id)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-3/30 hover:bg-bg-3/60 transition-colors border-0 cursor-pointer text-left"
              >
                <Cloud size={11} className={provider.enabled ? 'text-brand-green' : 'text-t-3'} />
                <span className="text-[11px] text-t-1 flex-1">{provider.name || provider.id}</span>
                {provider.enabled !== undefined && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${provider.enabled ? 'bg-green-500/10 text-green-400' : 'bg-rose-500/10 text-rose-400'}`}>
                    {provider.enabled ? '启用' : '禁用'}
                  </span>
                )}
                <ChevronRight size={10} className={`text-t-3 transition-transform ${selectedProvider === provider.id ? 'rotate-90' : ''}`} />
              </button>

              {selectedProvider === provider.id && (
                <div className="pl-6 pr-2 py-1 space-y-0.5">
                  {providerModels.length > 0 && providerModels.map((model) => (
                    <div key={model.id} className="flex items-center gap-2 px-2 py-1 rounded text-[10px]">
                      <span className="text-t-1 truncate flex-1">{model.name || model.id}</span>
                      <span className="text-t-3 text-[9px]">{model.providerID}</span>
                    </div>
                  ))}
                  {/* Auth buttons */}
                  <div className="flex gap-1 mt-1 px-2">
                    <button
                      onClick={async () => {
                        const key = prompt(`输入 ${provider.id} 的 API Key:`);
                        if (key) {
                          await opencodeClient.setAuthProvider(provider.id, { apiKey: key });
                        }
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] text-t-3 hover:text-t-1 hover:bg-bg-3 transition-colors border border-bdr-1 cursor-pointer bg-transparent"
                    >
                      <Key size={9} /> 设置认证
                    </button>
                    <button
                      onClick={async () => { await opencodeClient.removeAuthProvider(provider.id); }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] text-t-3 hover:text-rose-400 hover:bg-rose-500/10 transition-colors border border-bdr-1 cursor-pointer bg-transparent"
                    >
                      移除认证
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
