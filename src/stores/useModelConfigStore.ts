import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 自定义模型配置 */
export interface CustomModel {
  /** 模型 ID（传给 OpenCode 的标识） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 提供商（用于分组标记） */
  provider: string;
}

/** 模型配置状态 */
interface ModelConfigState {
  /** 自定义 API Base URL（如 https://api.deepseek.com、https://api.openai.com/v1） */
  apiBaseUrl: string;
  /** 自定义 API Key */
  apiKey: string;
  /** 自定义模型列表 */
  customModels: CustomModel[];

  // 操作方法
  setApiBaseUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  addCustomModel: (model: CustomModel) => void;
  removeCustomModel: (id: string) => void;
  updateCustomModel: (id: string, updates: Partial<CustomModel>) => void;
  /** 获取合并后的模型列表（内置 + 自定义） */
  getAllModels: () => CustomModel[];
}

/** 内置默认模型 */
const BUILTIN_MODELS: CustomModel[] = [
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek' },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'DeepSeek' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'Anthropic' },
  { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4', provider: 'Anthropic' },
];

export const useModelConfigStore = create<ModelConfigState>()(
  persist(
    (set, get) => ({
      apiBaseUrl: '',
      apiKey: '',
      customModels: [],

      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
      setApiKey: (key) => set({ apiKey: key }),

      addCustomModel: (model) => {
        set((state) => ({
          customModels: [...state.customModels.filter((m) => m.id !== model.id), model],
        }));
      },

      removeCustomModel: (id) => {
        set((state) => ({
          customModels: state.customModels.filter((m) => m.id !== id),
        }));
      },

      updateCustomModel: (id, updates) => {
        set((state) => ({
          customModels: state.customModels.map((m) =>
            m.id === id ? { ...m, ...updates } : m
          ),
        }));
      },

      getAllModels: () => {
        const customs = get().customModels;
        // 去重：自定义模型覆盖同 id 的内置模型
        const customIds = new Set(customs.map((m) => m.id));
        const filteredBuiltins = BUILTIN_MODELS.filter((m) => !customIds.has(m.id));
        return [...filteredBuiltins, ...customs];
      },
    }),
    {
      name: 'model-config-storage',
      partialize: (state) => ({
        apiBaseUrl: state.apiBaseUrl,
        apiKey: state.apiKey,
        customModels: state.customModels,
      }),
    }
  )
);
