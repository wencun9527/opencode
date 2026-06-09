import { create } from 'zustand';
import type { ThemeMode } from '../types';

/** 主题状态管理 */
interface ThemeState {
  /** 当前主题模式 */
  themeMode: ThemeMode;
  /** 切换主题 */
  toggleTheme: () => void;
  /** 设置主题 */
  setTheme: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeMode: 'light',

  toggleTheme: () => {
    const newMode = get().themeMode === 'light' ? 'dark' : 'light';
    set({ themeMode: newMode });
  },

  setTheme: (mode: ThemeMode) => {
    set({ themeMode: mode });
  },
}));
