import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useThemeStore } from '../stores/useThemeStore';

export const ThemeToggle: React.FC = () => {
  const { themeMode, toggleTheme } = useThemeStore();

  return (
    <button
      className="sbtn"
      onClick={toggleTheme}
      title={themeMode === 'light' ? '切换深色模式' : '切换浅色模式'}
    >
      {themeMode === 'light' ? <Moon size={13} /> : <Sun size={13} />}
    </button>
  );
};
