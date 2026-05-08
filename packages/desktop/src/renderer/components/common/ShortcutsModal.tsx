import React, { useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';

const SHORTCUTS = [
  { keys: ['?'], description: 'Show this shortcuts guide' },
  { keys: ['Cmd', 'Option', 'I'], description: 'Toggle DevTools' },
  { keys: ['Cmd', 'R'], description: 'Reload app' },
  { keys: ['Esc'], description: 'Close modal / cancel operation' },
  { keys: ['Cmd', 'N'], description: 'New case' },
  { keys: ['Cmd', 'O'], description: 'Open existing case' },
  { keys: ['Cmd', ','], description: 'Open settings' },
];

interface ShortcutsModalProps {
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ onClose }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard size={18} className="text-[#6495ED]" />
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 transition hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div
              key={s.description}
              className="flex items-center justify-between rounded-lg px-3 py-2"
              style={{ background: 'var(--bg-secondary)' }}
            >
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {s.description}
              </span>
              <div className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded px-2 py-0.5 text-xs font-mono font-semibold"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Press <kbd className="rounded px-1 py-0.5 text-xs font-mono" style={{ border: '1px solid var(--border-color)' }}>?</kbd> anywhere to show this guide
        </p>
      </div>
    </div>
  );
};
