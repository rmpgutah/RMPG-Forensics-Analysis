# RMPG Forensics Analysis

> Cross-platform digital forensics analysis toolkit built with Electron, React, and TypeScript.

## Overview

RMPG Forensics Analysis is a desktop application designed for authorized forensic investigators to perform mobile device forensics. It provides tools for device acquisition, data extraction, evidence management, and reporting — all within a secure, authenticated environment.

**Important:** This software is intended for use only by authorized personnel with proper legal authority. All forensic activities must comply with applicable laws and regulations.

## Architecture

```
rmpg-forensics/
├── packages/
│   ├── shared/          # Shared types, constants, and utilities
│   ├── desktop/         # Electron desktop application
│   │   ├── src/
│   │   │   ├── main/    # Electron main process (IPC handlers, services)
│   │   │   ├── preload/ # Context bridge (IPC API exposed to renderer)
│   │   │   └── renderer/# React UI (pages, components, stores)
│   │   └── resources/   # Icons and static assets
│   └── mobile-android/  # Android companion (planned)
├── docs/                # Documentation and plans
├── deploy.sh            # Build + deploy script
└── release.sh           # Release packaging script
```

### Key Technologies

| Layer | Technology |
|-------|------------|
| Framework | [Electron](https://www.electronjs.org/) (v39) |
| UI | [React](https://react.dev/) 18 + [Tailwind CSS](https://tailwindcss.com/) 3 |
| State | [Zustand](https://github.com/pmndrs/zustand) |
| Build | [electron-vite](https://electron-vite.org/) + [TypeScript](https://www.typescriptlang.org/) 5 |
| Packaging | [electron-builder](https://www.electron.build/) |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (local evidence DBs) |
| Auth | Firebase Auth + TOTP 2FA |

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **pnpm** ≥ 8 (`npm install -g pnpm`)
- **Git**

Platform-specific tools (for full forensic functionality):
- **ADB** (Android Debug Bridge) — for Android device communication
- **libimobiledevice** — for iOS device communication
- **Python 3** — for OSINT toolkit integrations
- **Tesseract** — for OCR processing
- **Java** — for IPED analysis engine

### Installation

```bash
# Clone the repository
git clone https://github.com/rmpgutah/RMPG-Forensics-Analysis.git
cd RMPG-Forensics-Analysis

# Install dependencies
pnpm install

# Build the shared package (required before desktop)
pnpm --filter @rmpg/shared build

# Start in development mode
pnpm dev:desktop
```

### Building for Production

```bash
# Build all packages
pnpm build:shared
pnpm build:desktop

# Package for your platform
pnpm package:win    # Windows
pnpm package:mac    # macOS
pnpm package:linux  # Linux
pnpm package:all    # All platforms
```

## Features

### Device Acquisition
- Android device detection and backup via ADB
- iOS device backup via libimobiledevice
- Full filesystem extraction
- Selective data extraction

### Evidence Management
- Case creation with examiner metadata
- SHA-256/SHA-512 hash verification
- Chain of custody audit trail
- PDF report generation

### Data Analysis
- WhatsApp message extraction and decryption (crypt14/crypt15)
- Contact and call log extraction
- Photo/video extraction with EXIF metadata
- Location data visualization on maps
- OCR text extraction from images
- Audio transcription

### OSINT Tools
- Username lookup across platforms (Sherlock, Maigret)
- Email breach checking (Holehe)
- Social media analysis

### Security
- Mandatory 2FA (TOTP) authentication
- Device trust tokens (remember device for 30 days)
- Context-isolated Electron renderer
- Encrypted local credential storage

## Project Structure

### IPC Communication

The app uses Electron IPC for all main↔renderer communication. Channels are defined in `packages/shared/src/constants.ts` as `IPC_CHANNELS`. Each handler group is registered in `packages/desktop/src/main/ipc/index.ts`.

### State Management

Zustand stores in `packages/desktop/src/renderer/store/` manage:
- `auth-store.ts` — Authentication state and 2FA flow
- `case-store.ts` — Active forensic case
- `device-store.ts` — Connected device info
- `error-store.ts` — Global error handling
- `settings-store.ts` — User preferences
- `backup-store.ts` — Backup progress tracking

## Deployment

See `deploy.sh` for the build-and-upload workflow. Copy `deploy.config.example` to `deploy.config` and fill in your server details before deploying.

```bash
./deploy.sh              # Bump patch version, build, and deploy
./deploy.sh minor        # Bump minor version
./deploy.sh --dry-run    # Build without uploading
```

## License

Proprietary — RMPG. All rights reserved.
