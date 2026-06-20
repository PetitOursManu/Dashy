import { http } from './client';
import type { ChatAlert, ChatConfig, ChatMessage, ChatProvider } from '../types';

export interface UpdateChatConfigPayload {
  enabled?: boolean;
  provider?: ChatProvider;
  model?: string;
  /** Empty string clears the key; omit to leave it unchanged. */
  apiKey?: string;
}

export const chatApi = {
  status: () => http.get<{ available: boolean }>('/api/chat/status'),

  send: (messages: ChatMessage[]) => http.post<{ reply: string }>('/api/chat', { messages }),

  getConfig: () =>
    http.get<{
      config: ChatConfig;
      providers: ChatProvider[];
      defaultModels: Record<ChatProvider, string>;
    }>('/api/chat/config'),

  updateConfig: (payload: UpdateChatConfigPayload) =>
    http.put<{ config: ChatConfig }>('/api/chat/config', payload),

  test: () => http.post<{ ok: true; reply: string }>('/api/chat/config/test'),

  alerts: () => http.get<{ alerts: ChatAlert[] }>('/api/chat/alerts'),
  ackAlert: (id: string) => http.post<{ ok: true }>(`/api/chat/alerts/${id}/ack`),
};
