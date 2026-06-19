export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  twoFactorEnabled: boolean;
  /** App ids a regular user may open (present in admin user listings). */
  allowedApps?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface HostedApp {
  id: string;
  name: string;
  description: string;
  slug: string;
  entryFile: string;
  previewImage: string | null;
  category: string | null;
  openCount: number;
  lastOpenedAt: string | null;
  isFavorite: boolean;
  url: string; // /hosted/<slug>/
  previewUrl: string; // /api/apps/<id>/preview
  createdAt: string;
  updatedAt: string;
}

export interface OverviewStats {
  totalApps: number;
  totalUsers: number;
  totalOpens: number;
  opensByMonth: { label: string; count: number }[];
  topApps: { id: string; name: string; slug: string; openCount: number }[];
}

export interface ActivityItem {
  id: string;
  type: string;
  actorEmail: string;
  message: string;
  at: string;
}

export interface StorageStats {
  total: number;
  apps: { id: string; name: string; size: number }[];
}

export interface TwoFactorSetup {
  secret: string;
  otpauth: string;
  qrDataUrl: string;
  backupCodes: string[];
}
