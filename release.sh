#!/bin/bash
# RMPG Forensics Analysis — Release Script
# Usage: ./release.sh [patch|minor|major]  (defaults to patch)
# This script: bumps the version, builds the app, and prepares the upload folder.

set -e

BUMP=${1:-patch}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$SCRIPT_DIR/packages/desktop"
RELEASE_DIR="$SCRIPT_DIR/release-output"

# ── 1. Bump version ──────────────────────────────────────────────────────────
echo ""
echo "── Step 1: Bumping version ($BUMP) ─────────────────────────────────────"
cd "$DESKTOP_DIR"
npm version "$BUMP" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"

# ── 2. Build ─────────────────────────────────────────────────────────────────
echo ""
echo "── Step 2: Building app ─────────────────────────────────────────────────"
cd "$SCRIPT_DIR"
pnpm --filter desktop build

# ── 3. Package installer ─────────────────────────────────────────────────────
echo ""
echo "── Step 3: Packaging installer ─────────────────────────────────────────"
cd "$DESKTOP_DIR"

# Detect platform and build appropriate installer
PLATFORM=$(uname -s)
if [[ "$PLATFORM" == "Darwin" ]]; then
  pnpm package:mac
  DIST_DIR="$DESKTOP_DIR/dist"
  INSTALLER_GLOB="*.dmg"
elif [[ "$PLATFORM" == "Linux" ]]; then
  pnpm package:linux
  DIST_DIR="$DESKTOP_DIR/dist"
  INSTALLER_GLOB="*.AppImage"
else
  # Windows (Git Bash / WSL)
  pnpm package:win
  DIST_DIR="$DESKTOP_DIR/dist"
  INSTALLER_GLOB="*-Setup.exe"
fi

# ── 4. Collect release files ─────────────────────────────────────────────────
echo ""
echo "── Step 4: Collecting release files ────────────────────────────────────"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# Copy installer(s)
find "$DIST_DIR" -maxdepth 2 \( -name "$INSTALLER_GLOB" -o -name "*.zip" \) -exec cp {} "$RELEASE_DIR/" \;

# Copy the auto-updater manifest (latest.yml / latest-mac.yml / latest-linux.yml)
find "$DIST_DIR" -maxdepth 2 -name "latest*.yml" -exec cp {} "$RELEASE_DIR/" \;

# Also copy any .blockmap files (used by electron-updater for delta updates)
find "$DIST_DIR" -maxdepth 2 -name "*.blockmap" -exec cp {} "$RELEASE_DIR/" \;

echo ""
echo "────────────────────────────────────────────────────────────────────────"
echo "  Release v$NEW_VERSION ready in: $RELEASE_DIR"
echo ""
echo "  Files to upload to https://rmpgutah.us/downloads/updates/ :"
ls -lh "$RELEASE_DIR"
echo ""
echo "  Upload command (scp example — replace user@yourserver):"
echo "  scp $RELEASE_DIR/* user@rmpgutah.us:/path/to/public_html/downloads/updates/"
echo ""
echo "  Or drag them into your hosting control panel file manager."
echo "────────────────────────────────────────────────────────────────────────"
