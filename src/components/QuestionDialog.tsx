import React, { useState, useCallback } from 'react';
import { MessageCircleQuestion, Send, Ban } from 'lucide-react';
import { opencodeClient } from '../services/opencodeClient';
import { useChatStore } from '../stores/useChatStore';
import type { QuestionRequest } from '../types';

interface QuestionDialogProps {
  question: QuestionRequest;
}

export const QuestionDialog: React.FC<QuestionDialogProps> = ({ question }) => {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customAnswer, setCustomAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { removeQuestionRequest, setAgentStatus } = useChatStore();

  const toggleOption = useCallback((opt: string) => {
    setSelectedOptions((prev) =>
      prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const answers = selectedOptions.length > 0
        ? selectedOptions
        : customAnswer.trim() ? [customAnswer.trim()] : [];
      if (answers.length === 0) return;
      await opencodeClient.replyQuestion(
        question.sessionID,
        question.id,
        answers,
      );
      removeQuestionRequest(question.id);
    } catch (err) {
      console.error('回复问答失败:', err);
    } finally {
      setSubmitting(false);
    }
  }, [selectedOptions, customAnswer, question, removeQuestionRequest]);

  const handleReject = useCallback(async () => {
    setSubmitting(true);
    try {
      await opencodeClient.rejectQuestion(
        question.sessionID,
        question.id,
      );
      removeQuestionRequest(question.id);
      setAgentStatus('idle');
    } catch (err) {
      console.error('拒绝问答失败:', err);
    } finally {
      setSubmitting(false);
    }
  }, [question, removeQuestionRequest, setAgentStatus]);

  const hasOptions = question.options && question.options.length > 0;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '10px 14px',
      margin: '4px 8px',
      borderRadius: 10,
      background: 'rgb(var(--purple) / .08)',
      border: '1px solid rgb(var(--purple) / .2)',
      animation: 'fadeUp .25s ease-out',
    }}>
      <MessageCircleQuestion size={14} style={{ color: 'rgb(var(--purple))', marginTop: 2, flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Question text */}
        <p style={{ fontSize: 12, color: 'rgb(var(--t1))', fontWeight: 500, marginBottom: 8, lineHeight: 1.5 }}>
          {question.question}
        </p>

        {/* Options */}
        {hasOptions && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {question.options!.map((opt) => {
              const isSelected = selectedOptions.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => toggleOption(opt)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    border: `1px solid ${isSelected ? 'rgb(var(--purple))' : 'rgb(var(--bd1))'}`,
                    background: isSelected ? 'rgb(var(--purple) / .15)' : 'rgb(var(--b2))',
                    color: isSelected ? 'rgb(var(--purple))' : 'rgb(var(--t2))',
                    cursor: 'pointer',
                    transition: 'all .15s',
                    fontWeight: isSelected ? 500 : 400,
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {/* Custom answer input */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            type="text"
            value={customAnswer}
            onChange={(e) => setCustomAnswer(e.target.value)}
            placeholder={hasOptions ? '或输入自定义回答...' : '输入你的回答...'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            style={{
              flex: 1,
              padding: '5px 10px',
              borderRadius: 6,
              fontSize: 11,
              border: '1px solid rgb(var(--bd1))',
              background: 'rgb(var(--b1))',
              color: 'rgb(var(--t1))',
              outline: 'none',
            }}
          />
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button
            onClick={handleReject}
            disabled={submitting}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, fontSize: 10,
              fontWeight: 500,
              background: 'rgb(var(--rose) / .1)', color: 'rgb(var(--rose))',
              border: 0, cursor: 'pointer', opacity: submitting ? 0.5 : 1,
            }}
          >
            <Ban size={10} /> 跳过
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || (!selectedOptions.length && !customAnswer.trim())}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, fontSize: 10,
              fontWeight: 500,
              background: 'rgb(var(--purple) / .1)', color: 'rgb(var(--purple))',
              border: 0, cursor: 'pointer',
              opacity: (submitting || (!selectedOptions.length && !customAnswer.trim())) ? 0.5 : 1,
            }}
          >
            <Send size={10} /> 提交
          </button>
        </div>
      </div>
    </div>
  );
};
