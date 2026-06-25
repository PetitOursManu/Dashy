export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  nickname: string;
  fullName: string;
  jobTitle: string;
  hasAvatar: boolean;
  hasBackground: boolean;
  glass: boolean;
  glassDark: boolean;
  language: string;
  theme: string;
  timezone: string;
  dateFormat: string;
  chatEnabled: boolean;
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
  share: {
    token: string;
    url: string; // /share/<token>/
    expiresAt: string | null;
    hasPassword: boolean;
  } | null;
  versions: { vid: string; entryFile: string; createdAt: string }[];
  url: string; // /hosted/<slug>/
  previewUrl: string; // /api/apps/<id>/preview
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
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

export type ChatProvider = 'openrouter' | 'openai' | 'deepseek' | 'claude';

export interface ChatConfig {
  enabled: boolean;
  provider: ChatProvider;
  model: string;
  hasApiKey: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAlert {
  id: string;
  userEmail: string;
  messages: string[];
  createdAt: string;
}

export interface UserHistory {
  twoFactorEnabled: boolean;
  chatEnabled: boolean;
  chatTimeoutUntil: string | null;
  botAlertCount: number;
  recentBotMessages: string[];
  topApps: { id: string; name: string; opens: number }[];
  notifications: { id: string; message: string; readAt: string | null; createdAt: string }[];
}

/** A notification shown to the current user on their own dashboard. */
export interface UserNotification {
  id: string;
  message: string;
  /** For a reply to a project request: the user's original request text. */
  requestMessage?: string | null;
  createdAt: string;
}

/** A notification row in the admin "Notifications" tile. */
export interface AdminNotification {
  id: string;
  userEmail: string;
  message: string;
  createdByEmail: string;
  readAt: string | null;
  createdAt: string;
}

export type ProjectRequestKind = 'idea' | 'file';
export type ProjectRequestStatus = 'pending' | 'resolved' | 'dismissed';

export interface ProjectRequest {
  id: string;
  user: string;
  userEmail: string;
  kind: ProjectRequestKind;
  message: string;
  status: ProjectRequestStatus;
  archived: boolean;
  createdAt: string;
}

// ------------------------------- Store module --------------------------------

export type StoreAppType = 'tile' | 'deploy' | 'static';

export interface StoreEnvVar {
  key: string;
  label: string;
  default: string | null;
  secret: boolean;
}

export interface StoreCatalogApp {
  id: string;
  name: string;
  description: string;
  icon: string;
  author: string;
  version: string;
  type: StoreAppType;
  tile?: { url: string; widget?: Record<string, unknown> };
  deploy?: { docker_compose: string; required_env: StoreEnvVar[]; default_port: number };
  static?: { source_url: string; entrypoint: string };
  source: string;
  installed: boolean;
  updateAvailable: boolean;
}

export interface StoreSource {
  id: string;
  name: string;
  type: 'local' | 'remote';
  location: string;
  enabled: boolean;
  ttlMinutes: number;
  appCount: number;
  lastFetchedAt: string | null;
  lastError: string | null;
}

export interface StoreInstalled {
  id: string;
  manifestId: string;
  name: string;
  type: StoreAppType;
  sourceName: string;
  installedVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  servingMode: 'path' | 'subdomain' | null;
  deployDriver: string | null;
  createdAt: string;
}

export interface StoreConfig {
  coolifyEnabled: boolean;
  coolifyBaseUrl: string;
  hasCoolifyToken: boolean;
  coolifyProjectUuid: string;
  coolifyServerUuid: string;
  coolifyDestinationUuid: string;
  coolifyEnvUuid: string;
  portainerEnabled: boolean;
  portainerUrl: string;
  hasPortainerKey: boolean;
  portainerEndpointId: string;
  dockerEnabled: boolean;
  defaultDriver: string;
  wildcardEnabled: boolean;
  baseDomain: string;
}

export interface StoreDriver {
  id: string;
  label: string;
}

export interface TwoFactorSetup {
  secret: string;
  otpauth: string;
  qrDataUrl: string;
  backupCodes: string[];
}
