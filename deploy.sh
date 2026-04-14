#!/bin/bash
# RMPG Forensics Analysis — Build + Deploy Script
# Usage:
#   ./deploy.sh              # bump patch, build, package, upload
#   ./deploy.sh minor        # bump minor version
#   ./deploy.sh major        # bump major version
#   ./deploy.sh --no-bump    # skip version bump (just build + upload)
#   ./deploy.sh --dry-run    # build and package but do NOT upload

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$SCRIPT_DIR/packages/desktop"
RELEASE_DIR="$SCRIPT_DIR/release-output"
CONFIG_FILE="$SCRIPT_DIR/deploy.config"

# Load deploy.config if it exists
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
else
  echo ""
  echo "  ⚠  No deploy.config found."
  echo "  Copy deploy.config.example → deploy.config and fill in your server details."
  echo ""
fi

DEPLOY_SSH_USER="${DEPLOY_SSH_USER:-}"
DEPLOY_SSH_HOST="${DEPLOY_SSH_HOST:-rmpgutah.us}"
DEPLOY_REMOTE_PATH="${DEPLOY_REMOTE_PATH:-/public_html/downloads/updates}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-}"
DEPLOY_FTP_HOST="${DEPLOY_FTP_HOST:-rmpgutah.us}"
DEPLOY_FTP_USER="${DEPLOY_FTP_USER:-}"
DEPLOY_FTP_PASS="${DEPLOY_FTP_PASS:-}"
DEPLOY_FTP_PATH="${DEPLOY_FTP_PATH:-/public_html/downloads/updates}"
DEPLOY_GITHUB_REPO="${DEPLOY_GITHUB_REPO:-}"

# ── Argument parsing ──────────────────────────────────────────────────────────
BUMP="patch"
SKIP_BUMP=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    patch|minor|major) BUMP="$arg" ;;
    --no-bump)  SKIP_BUMP=true ;;
    --dry-run)  DRY_RUN=true ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: ./deploy.sh [patch|minor|major|--no-bump] [--dry-run]"
      exit 1
      ;;
  esac
done

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${BLUE}── $1 ──${NC}"; }
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
fail() { echo -e "${RED}  ✗ $1${NC}"; exit 1; }

# ── Step 1: Version bump ──────────────────────────────────────────────────────
step "Step 1: Version"
cd "$DESKTOP_DIR"
if [[ "$SKIP_BUMP" == true ]]; then
  warn "Skipping version bump (--no-bump)"
else
  npm version "$BUMP" --no-git-tag-version
fi
NEW_VERSION=$(node -p "require('./package.json').version")
ok "Version: v$NEW_VERSION"

# ── Step 2: Build ─────────────────────────────────────────────────────────────
step "Step 2: Build"
cd "$SCRIPT_DIR"
pnpm --filter desktop build
ok "Build succeeded"

# ── Step 3: Package installer ─────────────────────────────────────────────────
step "Step 3: Package installer"
cd "$DESKTOP_DIR"

PLATFORM=$(uname -s)
if [[ "$PLATFORM" == "Darwin" ]]; then
  CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:mac
  DIST_DIR="$DESKTOP_DIR/dist"
  INSTALLER_GLOB="*.dmg"
elif [[ "$PLATFORM" == "Linux" ]]; then
  pnpm package:linux
  DIST_DIR="$DESKTOP_DIR/dist"
  INSTALLER_GLOB="*.AppImage"
else
  pnpm package:win
  DIST_DIR="$DESKTOP_DIR/dist"
  INSTALLER_GLOB="*-Setup.exe"
fi
ok "Packaging done"

# ── Step 4: Collect release files (current version only) ──────────────────────
step "Step 4: Collect release files"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# Only copy files that belong to this exact version (avoids picking up old builds)
find "$DIST_DIR" -maxdepth 2 \( -name "*${NEW_VERSION}*${INSTALLER_GLOB#\*}" -o -name "*${NEW_VERSION}*.zip" \) -exec cp {} "$RELEASE_DIR/" \;
find "$DIST_DIR" -maxdepth 2 -name "*${NEW_VERSION}*.blockmap" -exec cp {} "$RELEASE_DIR/" \;
find "$DIST_DIR" -maxdepth 2 -name "latest*.yml" -exec cp {} "$RELEASE_DIR/" \;

echo ""
ls -lh "$RELEASE_DIR"
ok "Release files collected in: $RELEASE_DIR"

if [[ "$DRY_RUN" == true ]]; then
  warn "Dry run — skipping upload steps."
  echo ""
  echo "Files that would be uploaded:"
  ls "$RELEASE_DIR"
  exit 0
fi

# ── Step 5: Upload ────────────────────────────────────────────────────────────
step "Step 5: Upload to rmpgutah.us"

UPLOADED=false

# ── 5a. SSH / rsync ──────────────────────────────────────────────────────────
if [[ -n "$DEPLOY_SSH_USER" ]]; then
  echo "  Uploading via rsync over SSH…"
  SSH_OPTS="-o StrictHostKeyChecking=accept-new"
  if [[ -n "$DEPLOY_SSH_KEY" ]]; then
    SSH_OPTS="$SSH_OPTS -i $DEPLOY_SSH_KEY"
  fi
  # Ensure remote directory exists
  ssh $SSH_OPTS "${DEPLOY_SSH_USER}@${DEPLOY_SSH_HOST}" "mkdir -p ${DEPLOY_REMOTE_PATH}"
  # Upload all release files
  rsync -avz --progress -e "ssh $SSH_OPTS" \
    "$RELEASE_DIR/" \
    "${DEPLOY_SSH_USER}@${DEPLOY_SSH_HOST}:${DEPLOY_REMOTE_PATH}/"
  ok "Uploaded via rsync → ${DEPLOY_SSH_HOST}:${DEPLOY_REMOTE_PATH}"
  UPLOADED=true
fi

# ── 5b. FTP fallback ─────────────────────────────────────────────────────────
if [[ "$UPLOADED" == false && -n "$DEPLOY_FTP_USER" && -n "$DEPLOY_FTP_PASS" ]]; then
  if command -v curl &>/dev/null; then
    echo "  Uploading via FTP (curl)…"
    for f in "$RELEASE_DIR"/*; do
      fname=$(basename "$f")
      echo "    → $fname"
      curl -s --ftp-create-dirs \
        -T "$f" \
        "ftp://${DEPLOY_FTP_HOST}${DEPLOY_FTP_PATH}/${fname}" \
        --user "${DEPLOY_FTP_USER}:${DEPLOY_FTP_PASS}"
    done
    ok "Uploaded via FTP → ftp://${DEPLOY_FTP_HOST}${DEPLOY_FTP_PATH}"
    UPLOADED=true
  else
    warn "curl not found — cannot do FTP upload"
  fi
fi

# ── 5c. GitHub Releases ───────────────────────────────────────────────────────
if [[ -n "$DEPLOY_GITHUB_REPO" ]]; then
  if command -v gh &>/dev/null; then
    echo "  Creating GitHub Release v$NEW_VERSION…"
    ASSET_FLAGS=()
    for f in "$RELEASE_DIR"/*; do
      ASSET_FLAGS+=("$f")
    done
    gh release create "v$NEW_VERSION" \
      --repo "$DEPLOY_GITHUB_REPO" \
      --title "RMPG Forensics v$NEW_VERSION" \
      --generate-notes \
      "${ASSET_FLAGS[@]}" || warn "GitHub release may already exist — upload skipped"
    ok "GitHub Release created: v$NEW_VERSION"
    UPLOADED=true
  else
    warn "gh CLI not installed — skipping GitHub release"
  fi
fi

if [[ "$UPLOADED" == false ]]; then
  warn "No upload method configured."
  echo ""
  echo "  To enable auto-upload, edit deploy.config and set one of:"
  echo "    DEPLOY_SSH_USER  (rsync over SSH)"
  echo "    DEPLOY_FTP_USER + DEPLOY_FTP_PASS  (FTP via curl)"
  echo "    DEPLOY_GITHUB_REPO  (GitHub Releases via gh CLI)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}──────────────────────────────────────────────────────────────────${NC}"
echo -e "${GREEN}  RMPG Forensics v$NEW_VERSION deployed successfully${NC}"
echo -e "${GREEN}──────────────────────────────────────────────────────────────────${NC}"
echo ""
echo "  Auto-update URL (electron-updater will check here):"
echo "  https://${DEPLOY_SSH_HOST:-rmpgutah.us}/downloads/updates/latest-mac.yml"
echo ""
