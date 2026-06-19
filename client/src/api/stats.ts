import { http } from './client';
import type { ActivityItem, OverviewStats, StorageStats } from '../types';

export const statsApi = {
  overview: () => http.get<OverviewStats>('/api/stats/overview'),
  activity: () => http.get<{ activities: ActivityItem[] }>('/api/stats/activity'),
  storage: () => http.get<StorageStats>('/api/stats/storage'),
};
