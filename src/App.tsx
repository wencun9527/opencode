import React, { useEffect, useState } from 'react';
import { useThemeStore } from './stores/useThemeStore';
import { opencodeClient } from './services/opencodeClient';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { PvfEditor } from './components/PvfEditor';
import { FileExplorer } from './components/FileExplorer';

const App: React.FC = () => {
  const themeMode = useThemeStore((s) => s.themeMode);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<'pvf' | 'files'>('pvf');

  useEffect(() => {
    const init = async () => {
      try {
        const status = await opencodeClient.getServerStatus();
        if (!status.connected) {
          await opencodeClient.startServer();
        }
      } catch {
        // 非 Tauri 环境忽略
      }
    };
    init();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  return (
    <div className="h-screen w-screen overflow-hidden">
      {/* Titlebar */}
      <div className="tb">
        <div className="lights">
          <span className="l-c" />
          <span className="l-m" />
          <span className="l-x" />
        </div>
        <span className="tt">PVF AI Editor</span>
      </div>

      {/* Shell + Card */}
      <div className="shell">
        <div className="card">
          {/* Sidebar */}
          <div className={`sb ${sidebarCollapsed ? 'n' : 'w'}`}>
            <Sidebar
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
              onSettingsClick={() => setSettingsOpen(true)}
            />
          </div>

          {/* Main Chat Area */}
          <ChatPanel
            rightOpen={rightPanelOpen}
            onToggleRight={() => setRightPanelOpen(!rightPanelOpen)}
            settingsOpen={settingsOpen}
            onToggleSettings={() => setSettingsOpen(!settingsOpen)}
          />

          {/* Right Panel */}
          <div className={`rp ${rightPanelOpen ? 'open' : 'shut'}`}>
            <div className="rp-in">
              {rightPanelOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  {/* Tab Switcher */}
                  <div style={{ display: 'flex', borderBottom: '1px solid rgb(var(--bd1))' }}>
                    <button
                      onClick={() => setRightPanelTab('pvf')}
                      style={{
                        flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 500,
                        color: rightPanelTab === 'pvf' ? 'rgb(var(--blue))' : 'rgb(var(--t3))',
                        background: 'transparent', border: 0, cursor: 'pointer',
                        borderBottom: rightPanelTab === 'pvf' ? '2px solid rgb(var(--blue))' : '2px solid transparent',
                      }}
                    >
                      PVF 编辑器
                    </button>
                    <button
                      onClick={() => setRightPanelTab('files')}
                      style={{
                        flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 500,
                        color: rightPanelTab === 'files' ? 'rgb(var(--blue))' : 'rgb(var(--t3))',
                        background: 'transparent', border: 0, cursor: 'pointer',
                        borderBottom: rightPanelTab === 'files' ? '2px solid rgb(var(--blue))' : '2px solid transparent',
                      }}
                    >
                      文件浏览器
                    </button>
                  </div>
                  {/* Tab Content */}
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    {rightPanelTab === 'pvf' ? <PvfEditor /> : <FileExplorer />}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Toast Container */}
      <div className="toast-c" id="toastC" />
    </div>
  );
};

export default App;
