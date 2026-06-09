import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { opencodeClient, type SkillInfo } from '../services/opencodeClient';

export const SkillPanel: React.FC = () => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const result = await opencodeClient.getSkills();
      setSkills(result);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-t-2 flex items-center gap-1.5">
          <Sparkles size={12} className="text-brand-purple" />
          技能列表 ({skills.length})
        </h4>
        <button
          onClick={loadSkills}
          disabled={loading}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-t-3 hover:text-t-1 hover:bg-bg-3 transition-colors border-0 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={9} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>

      {skills.length === 0 ? (
        <p className="text-[11px] text-t-3 px-1">暂无可用技能</p>
      ) : (
        <div className="space-y-1">
          {skills.map((skill) => (
            <div key={skill.id}>
              <button
                onClick={() => setExpanded(expanded === skill.id ? null : skill.id)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-3/30 hover:bg-bg-3/60 transition-colors border-0 cursor-pointer text-left"
              >
                <Sparkles size={11} className="text-brand-purple" />
                <span className="text-[11px] text-t-1 flex-1 truncate">{skill.name || skill.id}</span>
                {expanded === skill.id ? (
                  <ChevronDown size={10} className="text-t-3" />
                ) : (
                  <ChevronRight size={10} className="text-t-3" />
                )}
              </button>
              {expanded === skill.id && skill.description && (
                <div className="px-6 py-1.5 text-[10px] text-t-3 leading-relaxed">
                  {skill.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
