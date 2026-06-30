# Dashy Mobile API — Référence complète (`/api/mobile/v1`)

Documentation de l'API destinée à l'application **Dashy Mobile**. Elle permet à
une app native (ou web) de se connecter à une instance Dashy self-hostée distante
et d'en synchroniser l'état : profil, apps du dashboard, notifications, requêtes,
et — pour les admins — les catalogues du Store et les statistiques.

- **Version d'API** : `1` (préfixe d'URL `/api/mobile/v1`)
- **Authentification** : Bearer token (JWT) dans l'en-tête `Authorization`
- **Format** : JSON partout (sauf les images, servies en binaire)
- **Encodage** : UTF-8

> Cette API est conçue pour la **lecture + actions courantes**. Les uploads,
> installations/déploiements du Store et le chat IA restent réservés au web.

---

## 1. Concepts de base

### URL de base

```
https://<votre-instance-dashy>/api/mobile/v1
```

L'app doit demander à l'utilisateur l'URL de son serveur, puis la valider avec
`GET /info` (voir §3) avant d'afficher l'écran de connexion.

### Authentification Bearer

Après login, l'API renvoie un **access token** (JWT) dans le corps de la réponse.
Stocke-le de façon sécurisée côté app (Keychain iOS / Keystore Android / secure
storage) et envoie-le sur **chaque** appel protégé :

```
Authorization: Bearer <token>
```

- Durée de vie du token : **7 jours**.
- Il n'y a **pas** de refresh token. À l'expiration (ou révocation), l'API répond
  `401` → l'app doit renvoyer l'utilisateur vers le login.
- Chaque login crée une **session révocable** côté serveur. L'utilisateur peut la
  voir et la révoquer (cf. `/auth/sessions`). Renseigne le champ `device` au login
  pour qu'elle soit lisible (« iPhone 16 de Manu »).

### CORS

`/api/mobile/*` accepte **toute origine, sans credentials** (les Bearer tokens ne
présentent pas de risque CSRF). Une app native n'est pas concernée par CORS ; un
wrapper web (Capacitor, PWA) fonctionnera aussi.

### Limites de débit (rate limiting)

| Catégorie | Limite | Fenêtre |
| --- | --- | --- |
| Endpoints d'auth (`/auth/login`, `/auth/2fa/verify`) | 20 requêtes | 15 min |
| Tout le reste de `/api` | 300 requêtes | 15 min |

Dépassement → `429` avec `{ "error": "..." }`. Respecte les en-têtes standard
`RateLimit-*`.

### Format des erreurs

Toutes les erreurs sont du JSON avec au minimum une clé `error` :

```json
{ "error": "Invalid email or password" }
```

Les erreurs de validation (corps invalide) ajoutent `details` :

```json
{
  "error": "Validation failed",
  "details": [{ "path": "email", "message": "Invalid email" }]
}
```

| Code | Signification |
| --- | --- |
| `400` | Corps invalide (ZodError) ou requête malformée |
| `401` | Non authentifié / token invalide ou expiré / mauvais identifiants |
| `403` | Authentifié mais privilèges insuffisants (ex. endpoint admin) |
| `404` | Ressource introuvable |
| `409` | Conflit (ressource déjà existante) |
| `413` | Upload trop volumineux |
| `429` | Trop de requêtes |
| `500` | Erreur serveur |

---

## 2. Flux d'authentification

### 2.1 Login simple (sans 2FA)

```
POST /api/mobile/v1/auth/login
Content-Type: application/json

{ "email": "user@example.com", "password": "motdepasse", "device": "iPhone 16" }
```

Réponse `200` :

```json
{ "token": "eyJhbGci...", "user": { /* objet User, cf. §6 */ } }
```

→ stocke `token`, passe à l'app.

### 2.2 Login avec 2FA (TOTP)

Si le compte a la double authentification activée, l'étape 1 ne renvoie **pas** de
token mais un `pendingToken` (valable 5 minutes) :

```json
{ "twoFactorRequired": true, "pendingToken": "eyJhbGci..." }
```

L'app demande alors le code à 6 chiffres (ou un code de secours) et appelle :

```
POST /api/mobile/v1/auth/2fa/verify
Content-Type: application/json

{ "pendingToken": "eyJhbGci...", "token": "123456", "device": "iPhone 16" }
```

Réponse `200` : `{ "token": "...", "user": { ... } }`.

- `token` accepte un **TOTP à 6 chiffres** OU un **code de secours** (format
  `a1b2-c3d4`).
- `pendingToken` expiré → `401 "Pending authentication expired"` (recommencer au
  login).
- Mauvais code → `401 "Invalid two-factor code"`.

### 2.3 Déconnexion

```
POST /api/mobile/v1/auth/logout
Authorization: Bearer <token>
```

Réponse `200` : `{ "ok": true }`. Révoque la session courante ; le token devient
inutilisable. L'app efface son stockage local.

### Diagramme du flux

```
GET /info ──► (URL valide ?)
   │
   ▼
POST /auth/login ──┬─► { token, user }                  ─► connecté
                   └─► { twoFactorRequired, pendingToken }
                          │
                          ▼
                   POST /auth/2fa/verify ──► { token, user } ─► connecté
```

---

## 3. Découverte — `GET /info` (public)

Aucune authentification. Sert à valider une URL de serveur et à connaître la
version d'API + les fonctionnalités avant le login.

```
GET /api/mobile/v1/info
```

```json
{
  "apiVersion": 1,
  "server": { "name": "Dashy", "allowRegistration": false },
  "features": { "twoFactor": true, "store": true, "notifications": true, "requests": true }
}
```

> Si la requête échoue ou ne renvoie pas ce JSON, l'URL n'est pas une instance
> Dashy compatible. Vérifie aussi que `apiVersion` correspond à ce que l'app sait
> gérer.

---

## 4. Synchronisation — `GET /sync` (auth)

**L'endpoint central.** Renvoie en un seul appel tout ce qu'il faut pour hydrater
le dashboard. Idéal au démarrage de l'app et lors d'un « pull-to-refresh ».

```
GET /api/mobile/v1/sync
Authorization: Bearer <token>
```

Réponse `200` :

```json
{
  "apiVersion": 1,
  "serverTime": "2026-06-30T18:30:00.000Z",
  "server": { "name": "Dashy", "allowRegistration": false },
  "user": { /* objet User, §6 */ },
  "note": "<p>Ma note perso en HTML…</p>",
  "apps": [ /* objets App, §6 */ ],
  "favorites": ["665f1a...", "665f1b..."],
  "notifications": [
    { "id": "…", "message": "Bienvenue !", "requestMessage": null, "createdAt": "2026-06-30T…" }
  ],
  "requests": [ /* objets Request, §6 */ ],

  "admin": {                       // PRÉSENT UNIQUEMENT si role ∈ {admin, subadmin}
    "store": { "installed": [ /* objets InstalledApp, §6 */ ] },
    "stats": { "totalApps": 12, "totalUsers": 5, "pendingRequests": 2 }
  }
}
```

Notes :

- `apps` est déjà filtré par rôle : un **admin/subadmin** voit toutes les apps, un
  **user/temp** uniquement celles qui lui sont autorisées.
- `note` est la note personnelle (HTML assaini) — séparée de l'objet `user`.
- `notifications` ne contient que les notifications **non lues**.
- Le bloc `admin` est un **résumé**. Pour le détail complet (catalogue, config,
  graphiques de stats), utilise les endpoints dédiés du §5.

---

## 5. Endpoints

Tous requièrent `Authorization: Bearer <token>` sauf `GET /info`.
« admin » = `role ∈ {admin, subadmin}` (sinon `403`).

### Auth & sessions

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | `{ email, password, device? }` | `{ token, user }` ou `{ twoFactorRequired, pendingToken }` |
| `POST` | `/auth/2fa/verify` | `{ pendingToken, token, device? }` | `{ token, user }` |
| `POST` | `/auth/logout` | — | `{ ok: true }` |
| `GET` | `/auth/me` | — | `{ user }` |
| `GET` | `/auth/sessions` | — | `{ sessions: [{ id, userAgent, ip, createdAt, lastSeenAt, current }] }` |
| `DELETE` | `/auth/sessions/:id` | — | `{ ok: true, current }` |

### Snapshot

| Méthode | Chemin | Réponse |
| --- | --- | --- |
| `GET` | `/sync` | Snapshot agrégé (§4) |

### Apps

| Méthode | Chemin | Réponse |
| --- | --- | --- |
| `GET` | `/apps` | `{ apps: [App] }` |
| `GET` | `/apps/:id` | `{ app: App }` (`403` si non autorisé, `404` si inexistant) |
| `POST` | `/apps/:id/favorite` | `{ id, isFavorite }` (bascule le favori) |

### Notifications

| Méthode | Chemin | Réponse |
| --- | --- | --- |
| `GET` | `/notifications` | `{ notifications: [{ id, message, requestMessage, createdAt }] }` (non lues) |
| `POST` | `/notifications/:id/read` | `{ ok: true }` (acquitte → disparaît) |

### Requêtes de projet (« idées » envoyées aux admins)

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| `GET` | `/requests` | — | `{ requests: [Request] }` (les siennes, 50 max) |
| `POST` | `/requests` | `{ kind?: "idea"\|"file", message }` | `201 { request: Request }` |

### Profil & note

| Méthode | Chemin | Corps | Réponse |
| --- | --- | --- | --- |
| `PATCH` | `/profile` | sous-ensemble des préférences (cf. §6, au moins 1 champ) | `{ user }` |
| `GET` | `/note` | — | `{ content }` |
| `PUT` | `/note` | `{ content }` (HTML, max 20 000 car., assaini serveur) | `{ content }` |

Champs acceptés par `PATCH /profile` : `nickname`, `fullName`, `jobTitle`,
`language` (`en\|fr\|es\|de\|it\|zh\|ru`), `theme` (`light\|dark\|violet\|image`),
`glass` (bool), `glassDark` (bool), `timezone`, `dateFormat` (`""\|dmy\|mdy\|iso`).

### Admin — Store & statistiques (lecture seule)

| Méthode | Chemin | Réponse |
| --- | --- | --- |
| `GET` | `/store/installed` | `{ installed: [InstalledApp + latestVersion, updateAvailable, managedSource, sourceId] }` |
| `GET` | `/store/catalog` | `{ apps: [CatalogApp + installed, updateAvailable] }` |
| `GET` | `/store/config` | `{ config, drivers, docker }` |
| `GET` | `/stats/overview` | `{ totalApps, totalUsers, totalOpens, opensByMonth, topApps }` |

---

## 6. Modèles de données

### User

```jsonc
{
  "id": "665f…",
  "email": "user@example.com",
  "role": "admin" | "subadmin" | "user" | "temp",
  "expiresAt": null,            // date ISO pour les comptes "temp", sinon null
  "nickname": "Manu",
  "fullName": "",
  "jobTitle": "",
  "language": "fr",
  "theme": "image",
  "glass": true,
  "glassDark": false,
  "timezone": "Europe/Paris",
  "dateFormat": "dmy",
  "chatEnabled": true,
  "twoFactorEnabled": false,
  "hasAvatar": true,            // l'avatar est servi séparément (cf. §7)
  "hasBackground": false,
  "allowedApps": ["…"],         // ids d'apps accessibles (vide/ignoré pour un admin)
  "favorites": ["…"],
  "createdAt": "…",
  "updatedAt": "…"
}
```

> Champs sensibles (`passwordHash`, `twoFactorSecret`, `backupCodes`,
> `tokenVersion`, nom de fichier d'avatar/fond) **jamais** sérialisés.

### App (carte du dashboard)

```jsonc
{
  "id": "665f…",
  "name": "Mon App",
  "description": "…",
  "slug": "mon-app",
  "entryFile": "index.html",
  "previewImage": "abc.webp" | null,   // nom de fichier interne ; utilise previewUrl
  "category": "Outils" | null,
  "externalUrl": null,                 // si défini, la carte pointe vers cette URL
  "owner": "665f…",
  "openCount": 42,
  "lastOpenedAt": "…" | null,
  "versions": [ { "vid": "…", "entryFile": "…", "createdAt": "…" } ],
  "url": "/hosted/mon-app/",           // externalUrl si présent, sinon route hostée
  "previewUrl": "/api/apps/665f…/preview",
  "isFavorite": true,
  "share": null | {
    "token": "…", "url": "/share/…/", "expiresAt": "…" | null, "hasPassword": false
  },
  "createdAt": "…",
  "updatedAt": "…"
}
```

- `url` et `previewUrl` sont **relatifs** : préfixe-les avec l'URL de base du
  serveur. Pour ouvrir une app, charge `<baseURL><url>` dans une WebView (les
  routes `/hosted/*` exigent le cookie de session côté navigateur ; voir §7 pour
  l'accès authentifié depuis le mobile).

### Notification

```jsonc
{ "id": "…", "message": "…", "requestMessage": "Texte de ma requête" | null, "createdAt": "…" }
```

### Request (requête de projet)

```jsonc
{
  "id": "…",
  "user": "665f…",
  "userEmail": "user@example.com",
  "kind": "idea" | "file",
  "message": "Pouvez-vous ajouter …",
  "status": "pending" | "resolved" | "dismissed",
  "archived": false,
  "createdAt": "…",
  "updatedAt": "…"
}
```

### InstalledApp (Store, admin)

```jsonc
{
  "id": "…",
  "manifestId": "…",
  "name": "…",
  "type": "tile" | "deploy" | "static",
  "sourceName": "…",
  "hostedApp": "665f…" | null,   // carte d'app produite
  "installedVersion": "1.2.0",
  "slug": "…" | null,
  "servingMode": "path" | "subdomain" | null,
  "deployDriver": "…" | null,
  "serviceName": "…",
  "volumes": [ { "name": "…", "mountPath": "…" } ],
  "createdAt": "…",
  "updatedAt": "…",
  // ajoutés par /store/installed :
  "latestVersion": "1.3.0" | null,
  "updateAvailable": true,
  "managedSource": false,
  "sourceId": "…" | null
}
```

### Stats overview (admin)

```jsonc
{
  "totalApps": 12,
  "totalUsers": 5,
  "totalOpens": 1340,
  "opensByMonth": [ { "label": "Jan", "count": 120 }, … ],   // 6 derniers mois
  "topApps": [ { "id": "…", "name": "…", "slug": "…", "openCount": 88 }, … ]  // top 5
}
```

---

## 7. Images & contenu authentifié

Les images sont servies par les **endpoints existants** (hors `/api/mobile`), tous
protégés. Comme `requireAuth` accepte le Bearer, ajoute simplement l'en-tête
`Authorization` à tes requêtes d'image :

| Ressource | Endpoint | Notes |
| --- | --- | --- |
| Aperçu d'une app | `GET <base>/api/apps/:id/preview` | Renvoie l'image (ou un SVG placeholder généré). Champ `previewUrl`. |
| Avatar d'un membre | `GET <base>/api/auth/avatar/:userId` | `404` si pas d'avatar (`hasAvatar=false`). |
| Fond d'écran perso | `GET <base>/api/auth/background` | Celui de l'utilisateur courant. `404` si aucun. |

Pour les afficher dans une app native, utilise un loader d'image qui supporte les
en-têtes custom (ex. `AsyncImage` + requête personnalisée, `Coil`/`Glide` avec
header, `expo-image` avec `headers`). Le serveur pose `Cache-Control: private,
max-age=60`.

### Ouvrir une app hostée

Les apps hostées (`/hosted/<slug>/`) et les liens de partage (`/share/<token>/`)
sont des pages HTML conçues pour un navigateur avec cookie de session. Depuis le
mobile, deux options :

1. **App à `externalUrl`** (tuiles Store, déploiements) : `url` est une URL
   absolue publique → ouvre-la directement (WebView ou navigateur système).
2. **App hostée localement** : ouvre `<base>/hosted/<slug>/` dans une WebView en
   injectant le cookie de session, *ou* propose un partage public. Pour la v1,
   le plus simple est d'afficher la carte (nom, aperçu, catégorie, favori) et de
   déléguer l'ouverture au navigateur si une `externalUrl`/`share.url` existe.

> Évolution possible côté serveur si besoin : un endpoint mobile renvoyant le
> contenu hosté avec auth Bearer. Pas inclus en v1.

---

## 8. Exemples (pseudo-code)

### Login + sync (TypeScript / fetch)

```ts
const BASE = "https://dashy.exemple.com/api/mobile/v1";

async function login(email: string, password: string, device: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, device }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  const data = await res.json();

  if (data.twoFactorRequired) {
    // demander le code TOTP, puis :
    // POST /auth/2fa/verify { pendingToken: data.pendingToken, token, device }
    return { needs2fa: true, pendingToken: data.pendingToken };
  }
  await secureStore("token", data.token);   // Keychain / Keystore
  return { needs2fa: false, user: data.user };
}

async function sync(token: string) {
  const res = await fetch(`${BASE}/sync`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("SESSION_EXPIRED"); // → renvoyer au login
  return res.json();
}
```

### Charger un aperçu d'app (Swift / URLSession)

```swift
var req = URLRequest(url: URL(string: base + app.previewUrl)!)
req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
let (data, _) = try await URLSession.shared.data(for: req)
let image = UIImage(data: data)
```

---

## 9. Checklist d'intégration

- [ ] Écran « se connecter à un serveur » → valider l'URL via `GET /info`.
- [ ] Login (+ branche 2FA) → stocker le token de façon sécurisée, envoyer `device`.
- [ ] Sur 401 → effacer le token, retour au login.
- [ ] Hydrater le dashboard avec `GET /sync` ; pull-to-refresh = re-`sync`.
- [ ] Loader d'images avec en-tête `Authorization`.
- [ ] Actions : favoris, lire une notification, créer une requête, éditer profil/note.
- [ ] Écran « appareils connectés » via `/auth/sessions` (révocation possible).
- [ ] Si admin : onglets Store (installés/catalogue) et statistiques.
- [ ] Déconnexion via `POST /auth/logout`.

---

## 10. Changelog d'API

- **v1** (actuelle) — Auth Bearer + 2FA, `/info`, `/sync`, apps & favoris,
  notifications, requêtes, profil & note, Store & stats (admin, lecture).
  Hors périmètre : uploads, install/déploiement Store, gestion des users, chat IA.
```
