import { http } from './client';

export const notesApi = {
  get: () => http.get<{ content: string }>('/api/auth/note'),
  save: (content: string) => http.put<{ content: string }>('/api/auth/note', { content }),
};
