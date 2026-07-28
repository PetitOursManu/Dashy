#!/usr/bin/env bash
#
# Dashy — interactive installer for a bare Linux machine.
#
#   curl -fsSL https://raw.githubusercontent.com/PetitOursManu/Dashy/main/scripts/install.sh | sudo bash
#
# Asks a handful of questions, then installs Docker if needed, clones Dashy,
# generates strong secrets, starts the stack and (optionally) keeps it updated.
#
# Every answer can also be supplied as a flag (see --help) for unattended runs;
# anything given as a flag is simply not asked.
#
# Re-running is safe: an existing .env is never overwritten (rotating
# ENCRYPTION_KEY would make every stored secret — 2FA, driver tokens, database
# passwords — permanently undecryptable) and data volumes are left untouched.

set -euo pipefail

REPO_URL="${DASHY_REPO:-https://github.com/PetitOursManu/Dashy.git}"
BRANCH="${DASHY_BRANCH:-main}"
INSTALL_DIR="${DASHY_DIR:-}"
HOST_PORT="${DASHY_PORT:-}"
DOMAIN="${DASHY_DOMAIN:-}"
ADMIN_EMAIL="${DASHY_ADMIN_EMAIL:-}"
AUTO_UPDATE="${DASHY_AUTO_UPDATE:-}"
UPDATE_INTERVAL="${DASHY_UPDATE_INTERVAL:-5min}"
ASSUME_YES=0
DRY_RUN=0

# Defaults offered in the prompts.
DEF_DIR="/opt/dashy"
DEF_PORT="3000"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
log()   { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Dashy installer — run it with no arguments for the guided setup.

  --domain <host>       Public domain (serves over HTTPS), e.g. dashy.example.com
  --no-domain           Serve on the machine's IP address instead
  --port <port>         Host port to publish (default: 3000)
  --email <email>       Administrator email
  --dir <path>          Install directory (default: /opt/dashy)
  --branch <name>       Git branch to track (default: main)
  --repo <url>          Git repository to install from
  --auto-update         Enable automatic updates (skips the question)
  --no-auto-update      Disable automatic updates
  --interval <spec>     Update check interval, systemd format (default: 5min)
  -y, --yes             Accept the defaults, do not ask anything
  --dry-run             Show the resulting configuration and exit
  -h, --help            Show this help
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)         DOMAIN="${2:-}"; shift 2 ;;
    --no-domain)      DOMAIN="none"; shift ;;
    --port)           HOST_PORT="${2:-}"; shift 2 ;;
    --email)          ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --dir)            INSTALL_DIR="${2:-}"; shift 2 ;;
    --branch)         BRANCH="${2:-}"; shift 2 ;;
    --repo)           REPO_URL="${2:-}"; shift 2 ;;
    --interval)       UPDATE_INTERVAL="${2:-}"; shift 2 ;;
    --auto-update)    AUTO_UPDATE=1; shift ;;
    --no-auto-update) AUTO_UPDATE=0; shift ;;
    -y|--yes)         ASSUME_YES=1; shift ;;
    --dry-run)        DRY_RUN=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

# --- Prompt helpers ----------------------------------------------------------
#
# When the script is piped into bash (curl | bash) stdin is the script itself,
# so questions must be read from the terminal directly.

INTERACTIVE=0
if [ "${ASSUME_YES}" -eq 0 ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
  INTERACTIVE=1
fi

say() { [ "${INTERACTIVE}" -eq 1 ] && printf '%s\n' "$*" > /dev/tty || true; }

# ask <prompt> <default> — echoes the answer (the default when left empty).
ask() {
  local prompt="$1" default="${2:-}" answer=""
  if [ "${INTERACTIVE}" -eq 1 ]; then
    if [ -n "${default}" ]; then
      printf '\033[1m%s\033[0m [%s]: ' "${prompt}" "${default}" > /dev/tty
    else
      printf '\033[1m%s\033[0m: ' "${prompt}" > /dev/tty
    fi
    IFS= read -r answer < /dev/tty || answer=""
  fi
  [ -n "${answer}" ] || answer="${default}"
  printf '%s' "${answer}"
}

# ask_yes_no <prompt> <default y|n> — returns 0 for yes, 1 for no.
ask_yes_no() {
  local prompt="$1" default="$2" answer="" hint="y/N"
  [ "${default}" = "y" ] && hint="Y/n"
  if [ "${INTERACTIVE}" -eq 1 ]; then
    while :; do
      printf '\033[1m%s\033[0m [%s]: ' "${prompt}" "${hint}" > /dev/tty
      IFS= read -r answer < /dev/tty || answer=""
      [ -n "${answer}" ] || answer="${default}"
      case "${answer}" in
        [Yy]|[Yy][Ee][Ss]) return 0 ;;
        [Nn]|[Nn][Oo])     return 1 ;;
        *) printf 'Please answer yes or no.\n' > /dev/tty ;;
      esac
    done
  fi
  [ "${default}" = "y" ]
}

# --- Preflight ---------------------------------------------------------------

# A dry run only prints the resolved configuration, so it needs neither root
# nor Linux — handy to preview the answers before committing to an install.
if [ "${DRY_RUN}" -eq 0 ]; then
  [ "$(id -u)" -eq 0 ] || die "Please run as root (sudo)."
  [ "$(uname -s)" = "Linux" ] || die "This installer targets Linux."
fi

echo
bold "  Dashy installer"
echo  "  ---------------"
echo

# --- Questions ---------------------------------------------------------------

if [ -z "${INSTALL_DIR}" ]; then
  say "Where should Dashy be installed? Its source and .env live here."
  INSTALL_DIR="$(ask "Install directory" "${DEF_DIR}")"
  say ""
fi

# A previous install keeps its configuration — don't ask about it again.
REUSING_ENV=0
[ -f "${INSTALL_DIR}/.env" ] && REUSING_ENV=1

if [ "${REUSING_ENV}" -eq 1 ]; then
  log "Existing configuration found in ${INSTALL_DIR}/.env — it will be kept as-is."
else
  if [ -z "${DOMAIN}" ]; then
    if [ "${INTERACTIVE}" -eq 0 ]; then
      # Nothing to ask and no --domain given: serve on the machine's IP.
      DOMAIN="none"
    else
      say "Do you have a domain name pointing at this server?"
      say "With one, Dashy is served over HTTPS at that address. Without one, it is"
      say "served over plain HTTP on the machine's IP address."
      if ask_yes_no "Use a domain name?" "y"; then
        DOMAIN="$(ask "Domain (without https://)" "")"
        DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
        if [ -z "${DOMAIN}" ]; then
          say "No domain entered — falling back to the machine's IP address."
          DOMAIN="none"
        fi
      else
        DOMAIN="none"
      fi
      say ""
    fi
  fi

  if [ -z "${HOST_PORT}" ]; then
    say "Which host port should Dashy listen on?"
    while :; do
      HOST_PORT="$(ask "Host port" "${DEF_PORT}")"
      case "${HOST_PORT}" in
        ''|*[!0-9]*) ;;
        *) [ "${HOST_PORT}" -ge 1 ] && [ "${HOST_PORT}" -le 65535 ] && break ;;
      esac
      say "Please enter a number between 1 and 65535."
      [ "${INTERACTIVE}" -eq 1 ] || die "Invalid port: ${HOST_PORT}"
    done
    say ""
  fi

  if [ -z "${ADMIN_EMAIL}" ]; then
    say "The first administrator account is created on first start."
    DEF_EMAIL="admin@${DOMAIN}"
    [ "${DOMAIN}" = "none" ] && DEF_EMAIL="admin@dashy.local"
    while :; do
      ADMIN_EMAIL="$(ask "Administrator email" "${DEF_EMAIL}")"
      case "${ADMIN_EMAIL}" in
        ?*@?*.?*) break ;;
        *) say "That does not look like an email address." ;;
      esac
      [ "${INTERACTIVE}" -eq 1 ] || die "Invalid email: ${ADMIN_EMAIL}"
    done
    say ""
  fi
fi

# Validate whatever we ended up with, whether it was typed at a prompt or
# passed as a flag (flags used to bypass these checks entirely).
if [ "${REUSING_ENV}" -eq 0 ]; then
  DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
  [ -n "${DOMAIN}" ] || DOMAIN="none"

  case "${HOST_PORT}" in
    ''|*[!0-9]*) die "Invalid port: '${HOST_PORT}' (expected 1-65535)" ;;
  esac
  { [ "${HOST_PORT}" -ge 1 ] && [ "${HOST_PORT}" -le 65535 ]; } \
    || die "Invalid port: '${HOST_PORT}' (expected 1-65535)"

  case "${ADMIN_EMAIL}" in
    ?*@?*.?*) ;;
    *) die "Invalid administrator email: '${ADMIN_EMAIL}'" ;;
  esac
fi

if [ -z "${AUTO_UPDATE}" ]; then
  if command -v systemctl >/dev/null 2>&1; then
    say "Dashy can check for new commits and rebuild itself automatically."
    say "Note: this grants anyone who can push to '${BRANCH}' code execution here."
    if ask_yes_no "Enable automatic updates (every ${UPDATE_INTERVAL})?" "y"; then
      AUTO_UPDATE=1
    else
      AUTO_UPDATE=0
    fi
    say ""
  else
    AUTO_UPDATE=0
  fi
fi
command -v systemctl >/dev/null 2>&1 || AUTO_UPDATE=0

# --- Summary -----------------------------------------------------------------

# The machine's primary IPv4, tried two ways (`hostname -I` is missing on some
# minimal systems). Failures must not abort the script — hence the `|| ip=""`,
# which also neutralises `pipefail` when the first command is unavailable.
detect_ip() {
  local ip=""
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || ip=""
  if [ -z "${ip}" ]; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')" || ip=""
  fi
  [ -n "${ip}" ] || ip="localhost"
  printf '%s' "${ip}"
}

if [ "${DOMAIN}" = "none" ] || [ -z "${DOMAIN}" ]; then
  IP="$(detect_ip)"
  APP_ORIGIN="http://${IP}:${HOST_PORT:-$DEF_PORT}"
else
  APP_ORIGIN="https://${DOMAIN}"
fi

echo
bold "  Summary"
echo  "    Directory      ${INSTALL_DIR}"
echo  "    Repository     ${REPO_URL} (${BRANCH})"
if [ "${REUSING_ENV}" -eq 1 ]; then
  echo "    Configuration  existing .env (kept)"
else
  echo "    Address        ${APP_ORIGIN}"
  echo "    Host port      ${HOST_PORT}"
  echo "    Administrator  ${ADMIN_EMAIL}"
fi
if [ "${AUTO_UPDATE}" -eq 1 ]; then
  echo "    Auto-update    yes, every ${UPDATE_INTERVAL}"
else
  echo "    Auto-update    no"
fi
echo

if [ "${DRY_RUN}" -eq 1 ]; then
  log "Dry run — nothing was installed."
  exit 0
fi

if [ "${INTERACTIVE}" -eq 1 ]; then
  ask_yes_no "Proceed with the installation?" "y" || die "Cancelled."
  echo
fi

# --- Dependencies ------------------------------------------------------------

if ! command -v git >/dev/null 2>&1; then
  log "Installing git…"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq git
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q git
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q git
  else
    die "No supported package manager found — install git manually."
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi

docker compose version >/dev/null 2>&1 \
  || die "The Docker Compose plugin is missing. Install 'docker-compose-plugin' and re-run."

systemctl enable --now docker >/dev/null 2>&1 || true

# --- Source ------------------------------------------------------------------

if [ -d "${INSTALL_DIR}/.git" ]; then
  log "Updating the existing checkout…"
  git -C "${INSTALL_DIR}" remote set-url origin "${REPO_URL}"
  git -C "${INSTALL_DIR}" fetch --quiet origin "${BRANCH}"
  git -C "${INSTALL_DIR}" checkout --quiet -B "${BRANCH}" "origin/${BRANCH}"
else
  log "Cloning ${REPO_URL}…"
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone --quiet --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"

# --- Configuration -----------------------------------------------------------

if [ "${REUSING_ENV}" -eq 1 ]; then
  log "Keeping the existing .env (secrets preserved)."
else
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."

  JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '\n/+=' | cut -c1-20)"

  # Session cookies are flagged Secure in production, so a plain-HTTP origin
  # could never log in. Match the mode to the origin's scheme.
  case "${APP_ORIGIN}" in
    https://*) NODE_ENV=production ;;
    *)         NODE_ENV=development ;;
  esac

  log "Generating .env with fresh secrets…"
  umask 077
  cat > .env <<EOF
# Generated by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Keep this file secret and BACK IT UP: losing ENCRYPTION_KEY makes every
# stored secret (2FA, driver tokens, database passwords) unrecoverable.
NODE_ENV=${NODE_ENV}
PORT=3000
HOST_PORT=${HOST_PORT}
APP_ORIGIN=${APP_ORIGIN}

MONGO_URI=mongodb://mongo:27017/dashy

JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

ALLOW_REGISTRATION=false
MAX_UPLOAD_MB=50
EOF
  chmod 600 .env
  CREDENTIALS_SHOWN=1
fi

# --- Build & start -----------------------------------------------------------

log "Building and starting Dashy (the first build takes a few minutes)…"
docker compose build
docker compose up -d

# --- Automatic updates -------------------------------------------------------

if [ "${AUTO_UPDATE}" -eq 1 ]; then
  log "Enabling automatic updates every ${UPDATE_INTERVAL}…"
  cat > /etc/systemd/system/dashy-update.service <<EOF
[Unit]
Description=Update Dashy to the latest ${BRANCH} commit
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/scripts/update.sh --dir ${INSTALL_DIR} --branch ${BRANCH}
EOF

  cat > /etc/systemd/system/dashy-update.timer <<EOF
[Unit]
Description=Check for Dashy updates

[Timer]
OnBootSec=2min
OnUnitActiveSec=${UPDATE_INTERVAL}
Unit=dashy-update.service

[Install]
WantedBy=timers.target
EOF

  chmod +x "${INSTALL_DIR}/scripts/update.sh" 2>/dev/null || true
  systemctl daemon-reload
  systemctl enable --now dashy-update.timer
fi

# --- Done --------------------------------------------------------------------

ORIGIN="$(grep -E '^APP_ORIGIN=' .env | cut -d= -f2-)"
echo
bold "  Dashy is running at ${ORIGIN}"
if [ "${CREDENTIALS_SHOWN:-0}" = "1" ]; then
  echo
  echo "    Administrator  $(grep -E '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
  echo "    Password       $(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  echo
  warn "Save these now — the password is shown only once."
  warn "Back up ${INSTALL_DIR}/.env — ENCRYPTION_KEY cannot be recovered."
fi
echo
echo "    Logs           docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
if [ "${AUTO_UPDATE}" -eq 1 ]; then
  echo "    Updates        systemctl status dashy-update.timer"
fi
echo
