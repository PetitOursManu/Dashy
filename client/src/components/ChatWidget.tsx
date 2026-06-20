import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { chatApi } from '../api/chat';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/LanguageContext';
import type { ChatMessage } from '../types';
import { ChatIcon, CloseIcon, SendIcon, SparkleIcon } from './Icons';
import { Spinner } from './Spinner';

/** Matches a Markdown link to an internal path, e.g. [Planner](/hosted/planner/). */
const LINK_RE = /\[([^\]]+)\]\((\/[^)\s]+)\)/g;

/**
 * Render assistant text, turning internal Markdown links into clickable anchors
 * that open the hosted app in a new tab. Only internal (`/…`) links are honored,
 * so the model can't smuggle in external URLs.
 */
function renderMessage(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  let key = 0;
  while ((m = LINK_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <a
        key={key++}
        href={m[2]}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-ember-600 underline decoration-ember-400/50 underline-offset-2 hover:text-ember-700 dark:text-ember-300"
      >
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function ChatWidget() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const refreshStatus = useCallback(() => {
    if (!user) {
      setAvailable(false);
      return;
    }
    chatApi
      .status()
      .then((r) => setAvailable(r.available))
      .catch(() => setAvailable(false));
  }, [user]);

  // Re-check availability on login, on navigation, and when the tab regains
  // focus — so the bubble appears as soon as an admin enables the assistant,
  // without needing a full reload.
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, location.pathname]);

  useEffect(() => {
    window.addEventListener('focus', refreshStatus);
    // Fired by the admin Settings page right after the assistant is (un)configured.
    window.addEventListener('dashy:chat-config-changed', refreshStatus);
    return () => {
      window.removeEventListener('focus', refreshStatus);
      window.removeEventListener('dashy:chat-config-changed', refreshStatus);
    };
  }, [refreshStatus]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  if (!available) return null;

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const { reply } = await chatApi.send(next.slice(-20));
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('chat.error'));
      setMessages(next);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const greetingName = user?.nickname || user?.fullName || '';
  const suggestions = [t('chat.suggest1'), t('chat.suggest2'), t('chat.suggest3')];

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('chat.open')}
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-ember-500 to-ember-700 text-white shadow-glow transition-transform hover:scale-105"
        >
          <ChatIcon className="h-6 w-6" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 flex h-[560px] max-h-[calc(100vh-2.5rem)] w-[calc(100vw-2.5rem)] max-w-[380px] flex-col overflow-hidden rounded-3xl border border-white/40 bg-sand-50/95 shadow-soft backdrop-blur dark:border-white/10 dark:bg-sand-950/95">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 bg-gradient-to-br from-ember-500 to-ember-700 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
                <SparkleIcon className="h-5 w-5" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold">Dashy</p>
                <p className="text-[11px] text-white/80">{t('chat.subtitle')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              className="rounded-lg p-1.5 hover:bg-white/15"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {/* Greeting + starter suggestions */}
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-soft dark:bg-sand-900">
                {greetingName
                  ? t('chat.greetingNamed', { name: greetingName })
                  : t('chat.greeting')}
              </div>
            </div>
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-ember-300 bg-ember-50 px-3 py-1.5 text-xs font-medium text-ember-700 transition-colors hover:bg-ember-100 dark:border-ember-500/40 dark:bg-ember-500/10 dark:text-ember-300"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-soft ${
                    msg.role === 'user'
                      ? 'rounded-tr-sm bg-ember-500 text-white'
                      : 'rounded-tl-sm bg-white dark:bg-sand-900'
                  }`}
                >
                  {msg.role === 'assistant' ? renderMessage(msg.content) : msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-tl-sm bg-white px-3 py-2.5 shadow-soft dark:bg-sand-900">
                  <Spinner className="h-4 w-4 text-ember-500" />
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={onSubmit}
            className="flex items-end gap-2 border-t border-sand-200 p-3 dark:border-sand-800"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder={t('chat.placeholder')}
              className="input max-h-28 min-h-[42px] flex-1 resize-none py-2.5"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label={t('chat.send')}
              className="btn-primary !px-3 disabled:opacity-40"
            >
              <SendIcon className="h-5 w-5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
