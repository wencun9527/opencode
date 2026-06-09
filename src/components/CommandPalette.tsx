import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, Search } from 'lucide-react';
import { opencodeClient, type CommandInfo } from '../services/opencodeClient';

interface CommandPaletteProps {
  onSelect: (command: string) => void;
  visible: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ onSelect, visible, onClose }) => {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      opencodeClient.getCommands().then(setCommands).catch(() => setCommands([]));
      setFilter('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  const filtered = commands.filter((c) =>
    c.id.toLowerCase().includes(filter.toLowerCase()) ||
    c.name.toLowerCase().includes(filter.toLowerCase())
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      onSelect(`/${filtered[selectedIndex].id}`);
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filtered, selectedIndex, onSelect, onClose]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: 0,
      right: 0,
      marginBottom: 4,
      borderRadius: 10,
      border: '1px solid rgb(var(--bd1))',
      background: 'rgb(var(--b1))',
      boxShadow: '0 -4px 20px rgba(0,0,0,.3)',
      zIndex: 50,
      maxHeight: 260,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Search input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgb(var(--bd1))' }}>
        <Search size={12} style={{ color: 'rgb(var(--t3))' }} />
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setSelectedIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder="搜索命令..."
          style={{
            flex: 1, border: 0, background: 'transparent', color: 'rgb(var(--t1))',
            fontSize: 11, outline: 'none',
          }}
        />
      </div>

      {/* Command list */}
      <div style={{ overflowY: 'auto', padding: 4, flex: 1 }}>
        {filtered.length === 0 ? (
          <p style={{ fontSize: 11, color: 'rgb(var(--t3))', padding: '8px 12px' }}>无匹配命令</p>
        ) : (
          filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={() => { onSelect(`/${cmd.id}`); onClose(); }}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '6px 10px',
                borderRadius: 6, border: 0,
                background: i === selectedIndex ? 'rgb(var(--b3))' : 'transparent',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <Terminal size={11} style={{ color: 'rgb(var(--purple))', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'rgb(var(--t1))', fontWeight: 500 }}>/{cmd.id}</span>
              {cmd.name && cmd.name !== cmd.id && (
                <span style={{ fontSize: 10, color: 'rgb(var(--t3))', flex: 1 }}>{cmd.name}</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
};
