import { http } from './client';
import type { ChatAlert, ChatConfig, ChatMessage, ChatProposal, ChatProvider } from '../types';

export interface UpdateChatConfigPayload {
  enabled?: boolean;
  provider?: ChatProvider;
  model?: string;
  /** Empty string clears the key; omit to leave it unchanged. */
  apiKey?: string;
}

export const chatApi = {
  status: () => http.get<{ available: boolean; canRequest: boolean }>('/api/chat/status'),

  send: (messages: ChatMessage[]) =>
    http.post<{ reply: string; proposal?: ChatProposal }>('/api/chat', { messages }),

  runAction: (action: ChatProposal) =>
    http.post<{ ok: true; kind: string; name: string; source?: string }>('/api/chat/action', action),

  getConfig: () =>
    http.get<{
      config: ChatConfig;
      providers: ChatProvider[];
      defaultModels: Record<ChatProvider, string>;
    }>('/api/chat/config'),

  updateConfig: (payload: UpdateChatConfigPayload) =>
    http.put<{ config: ChatConfig }>('/api/chat/config', payload),

  listModels: () =>
    http.get<{ models: string[]; provider: ChatProvider }>('/api/chat/config/models'),

  test: () => http.post<{ ok: true; reply: string }>('/api/chat/config/test'),

  alerts: () => http.get<{ alerts: ChatAlert[] }>('/api/chat/alerts'),
  ackAlert: (id: string) => http.post<{ ok: true }>(`/api/chat/alerts/${id}/ack`),
};
