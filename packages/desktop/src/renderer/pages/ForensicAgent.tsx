import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Bot,
  Send,
  Key,
  Eye,
  EyeOff,
  Trash2,
  Copy,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Paperclip,
  X,
  Sparkles,
  ShieldCheck,
  FileText,
  GitMerge,
  RotateCcw,
} from 'lucide-react';
import { IPC_CHANNELS } from '@rmpg/shared';
import { PageHeader } from '../components/common';
import { useIpc } from '../hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentRole = 'analyst' | 'workflow' | 'report' | 'custody';
type MessageRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  tokens?: { in: number; out: number };
  timestamp: number;
  context?: string;
}

// ---------------------------------------------------------------------------
// Role configuration
// ---------------------------------------------------------------------------

const ROLES: Record<AgentRole, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  analyst: {
    label: 'Evidence Analyst',
    icon: <Sparkles size={14} />,
    color: 'text-blue-400',
    description: 'Interprets and correlates extracted forensic artifacts',
  },
  workflow: {
    label: 'Workflow Guide',
    icon: <GitMerge size={14} />,
    color: 'text-green-400',
    description: 'Step-by-step guidance through acquisition procedures',
  },
  report: {
    label: 'Report Writer',
    icon: <FileText size={14} />,
    color: 'text-purple-400',
    description: 'Drafts professional forensic investigation reports',
  },
  custody: {
    label: 'Chain of Custody',
    icon: <ShieldCheck size={14} />,
    color: 'text-amber-400',
    description: 'Evidence integrity and admissibility guidance',
  },
};

// ---------------------------------------------------------------------------
// Quick prompt suggestions per role
// ---------------------------------------------------------------------------

const QUICK_PROMPTS: Record<AgentRole, string[]> = {
  analyst: [
    'Analyze the attached log and identify key artifacts',
    'What does this SQLite schema tell us about the app?',
    'Summarize the forensic significance of these findings',
    'Identify any anomalies or indicators of user activity',
  ],
  workflow: [
    'Walk me through an iOS backup acquisition step by step',
    'How do I extract WhatsApp data from a locked Android device?',
    'What should I do if mobilebackup2 returns error code 105?',
    'Explain the correct procedure for ADB backup with chain of custody',
  ],
  report: [
    'Draft an executive summary for these findings',
    'Write a chain of custody section for the attached acquisition log',
    'Generate a findings narrative from this timeline data',
    'Create a technical appendix describing the extraction method',
  ],
  custody: [
    'What steps are required before taking an ADB backup?',
    'How do I document hash values for chain of custody?',
    'What could compromise this evidence\'s admissibility?',
    'Review my procedure for any chain of custody gaps',
  ],
};

// ---------------------------------------------------------------------------
// Markdown-lite renderer for assistant messages
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;
  let inCode = false;
  let codeLines: string[] = [];
  let codeLang = '';

  const flushCode = () => {
    if (codeLines.length > 0) {
      elements.push(
        <pre
          key={key++}
          className="my-2 rounded p-3 text-[11px] font-mono overflow-x-auto"
          style={{ background: 'rgba(0,0,0,0.4)', color: '#a8d8a8', border: '1px solid var(--border-color)' }}
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      codeLines = [];
      codeLang = '';
    }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('### ')) {
      elements.push(<h3 key={key++} className="mt-3 mb-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{line.slice(4)}</h3>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={key++} className="mt-3 mb-1 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{line.slice(3)}</h2>);
    } else if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      elements.push(<p key={key++} className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{line.slice(2, -2)}</p>);
    } else if (line.match(/^[-*] /)) {
      elements.push(
        <li key={key++} className="ml-4 text-sm list-disc" style={{ color: 'var(--text-primary)' }}>
          {line.slice(2)}
        </li>
      );
    } else if (line.match(/^\d+\. /)) {
      elements.push(
        <li key={key++} className="ml-4 text-sm list-decimal" style={{ color: 'var(--text-primary)' }}>
          {line.replace(/^\d+\. /, '')}
        </li>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={key++} className="h-2" />);
    } else {
      elements.push(
        <p key={key++} className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          {line}
        </p>
      );
    }
  }

  if (inCode) flushCode();
  return <div className="space-y-0.5">{elements}</div>;
}

// ---------------------------------------------------------------------------
// Storage key for API key in localStorage
// ---------------------------------------------------------------------------

const API_KEY_STORAGE_KEY = 'rmpg-agent-api-key';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ForensicAgent: React.FC = () => {
  const ipc = useIpc();

  // API key state
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE_KEY) ?? '');
  const [showKey, setShowKey] = useState(false);
  const [showKeySetup, setShowKeySetup] = useState(() => !localStorage.getItem(API_KEY_STORAGE_KEY));

  // Role + conversation
  const [role, setRole] = useState<AgentRole>('analyst');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');

  // Context attachment
  const [contextText, setContextText] = useState('');
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [contextAttached, setContextAttached] = useState(false);

  // Copy state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamIdRef = useRef<string>('');

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamBuffer]);

  // Stream listener
  useEffect(() => {
    const cleanup = window.api.on(IPC_CHANNELS.AI_AGENT_STREAM, (data: Record<string, unknown>) => {
      if (data.streamId !== streamIdRef.current) return;

      if (data.type === 'delta') {
        setStreamBuffer((prev) => prev + (data.text as string));
      } else if (data.type === 'done') {
        setStreamBuffer((prev) => {
          const finalText = prev;
          setMessages((msgs) => [
            ...msgs,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: finalText,
              tokens: { in: data.inputTokens as number, out: data.outputTokens as number },
              timestamp: Date.now(),
            },
          ]);
          return '';
        });
        setIsLoading(false);
      } else if (data.type === 'error') {
        setMessages((msgs) => [
          ...msgs,
          {
            id: crypto.randomUUID(),
            role: 'system',
            content: `Error: ${data.message as string}`,
            timestamp: Date.now(),
          },
        ]);
        setStreamBuffer('');
        setIsLoading(false);
      }
    });
    return cleanup;
  }, []);

  const saveApiKey = () => {
    const trimmed = apiKey.trim();
    localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
    setShowKeySetup(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const effectiveContent = contextAttached && contextText.trim()
      ? `${text}\n\n--- Attached Context ---\n${contextText.trim()}`
      : text;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: effectiveContent,
      timestamp: Date.now(),
      context: contextAttached && contextText.trim() ? contextText.trim() : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setContextAttached(false);
    setIsLoading(true);

    // Build API messages array (only user/assistant, not system)
    const apiMessages = [...messages, userMsg]
      .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } =>
        m.role === 'user' || m.role === 'assistant'
      )
      .map((m) => ({ role: m.role, content: m.content }));

    const streamId = crypto.randomUUID();
    streamIdRef.current = streamId;

    try {
      await ipc.invoke(IPC_CHANNELS.AI_AGENT_STREAM, {
        apiKey: localStorage.getItem(API_KEY_STORAGE_KEY) ?? apiKey,
        role,
        messages: apiMessages,
        streamId,
      });
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'system',
          content: `Failed to reach agent: ${(err as Error).message}`,
          timestamp: Date.now(),
        },
      ]);
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyMessage = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const currentRole = ROLES[role];

  return (
    <div className="flex h-full flex-col space-y-4">
      <PageHeader
        title="Forensic AI Agent"
        description="AI-powered investigation assistance — analyze evidence, guide workflows, draft reports"
        icon={<Bot size={24} />}
      />

      {/* ── API Key Setup Banner ───────────────────────────────────────── */}
      {showKeySetup && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
          <p className="mb-3 text-sm font-semibold text-blue-300">Anthropic API Key Required</p>
          <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            The AI agent uses the Anthropic Claude API. Your key is stored locally on this device only and never transmitted anywhere except directly to api.anthropic.com.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="input-field w-full pr-8 font-mono text-sm"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100"
                style={{ color: 'var(--text-muted)' }}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              onClick={saveApiKey}
              disabled={!apiKey.trim().startsWith('sk-')}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              <Key size={14} />
              Save Key
            </button>
          </div>
        </div>
      )}

      {/* ── Role Selector + Config bar ────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1">
          {(Object.entries(ROLES) as [AgentRole, typeof ROLES[AgentRole]][]).map(([id, cfg]) => (
            <button
              key={id}
              onClick={() => setRole(id)}
              title={cfg.description}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                role === id
                  ? 'bg-[#6495ED] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span className={role === id ? 'text-white' : cfg.color}>{cfg.icon}</span>
              {cfg.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {/* Context attach toggle */}
          <button
            onClick={() => setShowContextPanel((v) => !v)}
            title="Attach forensic data as context"
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              contextAttached
                ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
                : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Paperclip size={13} />
            {contextAttached ? 'Context attached' : 'Attach context'}
          </button>

          {/* Clear conversation */}
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setStreamBuffer(''); }}
              title="Clear conversation"
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[var(--text-secondary)] hover:text-red-400 transition-colors"
            >
              <RotateCcw size={13} />
            </button>
          )}

          {/* API key settings */}
          <button
            onClick={() => setShowKeySetup((v) => !v)}
            title="Configure API key"
            className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Key size={13} />
          </button>
        </div>
      </div>

      {/* ── Context Panel ─────────────────────────────────────────────── */}
      {showContextPanel && (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Forensic Context
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Paste logs, device info, database rows, or any extracted data
            </span>
          </div>
          <textarea
            value={contextText}
            onChange={(e) => setContextText(e.target.value)}
            placeholder="Paste extracted data here — device info, ADB output, WhatsApp logs, SQLite rows, hash values, acquisition reports…"
            rows={6}
            className="input-field w-full resize-none font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            {contextText && (
              <button
                onClick={() => setContextText('')}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-red-400"
              >
                <X size={12} /> Clear
              </button>
            )}
            <button
              onClick={() => {
                if (contextText.trim()) {
                  setContextAttached(true);
                  setShowContextPanel(false);
                }
              }}
              disabled={!contextText.trim()}
              className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50"
            >
              <Paperclip size={12} />
              Attach to next message
            </button>
          </div>
        </div>
      )}

      {/* ── Chat History ──────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto rounded-lg border border-[var(--border-color)] p-4 space-y-4"
        style={{ background: 'var(--bg-primary)', minHeight: 0 }}
      >
        {messages.length === 0 && !streamBuffer && (
          <div className="flex h-full flex-col items-center justify-center gap-6 py-8">
            <div className="rounded-full bg-[#6495ED]/10 p-4">
              <Bot size={32} className="text-[#6495ED]" />
            </div>
            <div className="text-center max-w-md">
              <p className="mb-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {currentRole.label}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {currentRole.description}
              </p>
            </div>

            {/* Quick prompt chips */}
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {QUICK_PROMPTS[role].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setInput(prompt);
                    inputRef.current?.focus();
                  }}
                  className="rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs transition-colors hover:border-[#6495ED]/50 hover:bg-[#6495ED]/10"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role !== 'user' && (
              <div className={`mt-0.5 shrink-0 rounded-full p-1.5 ${msg.role === 'system' ? 'bg-red-500/20' : 'bg-[#6495ED]/15'}`}>
                <Bot size={14} className={msg.role === 'system' ? 'text-red-400' : 'text-[#6495ED]'} />
              </div>
            )}

            <div className={`group max-w-[80%] space-y-1 ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
              <div
                className={`rounded-xl px-4 py-3 text-sm ${
                  msg.role === 'user'
                    ? 'rounded-tr-sm bg-[#6495ED] text-white'
                    : msg.role === 'system'
                    ? 'rounded-tl-sm border border-red-500/30 bg-red-500/10 text-red-300'
                    : 'rounded-tl-sm border border-[var(--border-color)] bg-[var(--bg-secondary)]'
                }`}
              >
                {msg.context && msg.role === 'user' && (
                  <div className="mb-2 rounded-md border border-white/20 bg-white/10 px-2 py-1">
                    <p className="text-[10px] font-semibold opacity-80">+ Context attached</p>
                  </div>
                )}
                {msg.role === 'assistant'
                  ? renderMarkdown(msg.content)
                  : <p className="whitespace-pre-wrap">{msg.context ? msg.content.replace(`\n\n--- Attached Context ---\n${msg.context}`, '') : msg.content}</p>
                }
              </div>

              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
                {msg.tokens && (
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    · {msg.tokens.in + msg.tokens.out} tokens
                  </span>
                )}
                <button
                  onClick={() => copyMessage(msg.id, msg.content)}
                  className="text-[10px] flex items-center gap-0.5 hover:text-[var(--text-primary)] transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {copiedId === msg.id ? <CheckCircle2 size={10} /> : <Copy size={10} />}
                  {copiedId === msg.id ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {streamBuffer && (
          <div className="flex gap-3 justify-start">
            <div className="mt-0.5 shrink-0 rounded-full p-1.5 bg-[#6495ED]/15">
              <Bot size={14} className="text-[#6495ED] animate-pulse" />
            </div>
            <div
              className="max-w-[80%] rounded-xl rounded-tl-sm border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3"
            >
              {renderMarkdown(streamBuffer)}
              <span className="inline-block h-3 w-0.5 animate-pulse bg-[#6495ED] align-text-bottom ml-0.5" />
            </div>
          </div>
        )}

        {isLoading && !streamBuffer && (
          <div className="flex gap-3 justify-start">
            <div className="mt-0.5 shrink-0 rounded-full p-1.5 bg-[#6495ED]/15">
              <Loader2 size={14} className="text-[#6495ED] animate-spin" />
            </div>
            <div className="rounded-xl rounded-tl-sm border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Thinking…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Area ────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {contextAttached && (
          <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5">
            <Paperclip size={12} className="text-blue-400" />
            <span className="flex-1 text-xs text-blue-300">
              Context will be attached to your next message
            </span>
            <button onClick={() => setContextAttached(false)}>
              <X size={12} className="text-blue-400 hover:text-blue-200" />
            </button>
          </div>
        )}

        <div className="flex gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask the ${currentRole.label}… (Enter to send, Shift+Enter for newline)`}
            disabled={isLoading || !localStorage.getItem(API_KEY_STORAGE_KEY)}
            rows={2}
            className="flex-1 resize-none bg-transparent text-sm outline-none disabled:opacity-50"
            style={{ color: 'var(--text-primary)' }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim() || !localStorage.getItem(API_KEY_STORAGE_KEY)}
            className="self-end rounded-lg p-2 transition-colors disabled:opacity-40"
            style={{ background: '#6495ED', color: 'white' }}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>

        <p className="text-center text-[10px]" style={{ color: 'var(--text-muted)' }}>
          AI responses are for investigative guidance only — verify all findings independently. Not a substitute for certified forensic analysis.
        </p>
      </div>
    </div>
  );
};
