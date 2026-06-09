# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` - install dependencies from `package-lock.json`.
- `npm run dev` - start Vite and Electron together. Electron waits for Vite on `127.0.0.1:5173` and uses `VITE_DEV_SERVER_URL`.
- `npm run check` - run TypeScript type checking with `tsc --noEmit`.
- `npm run build` - build the renderer into `dist/`.
- `npm run preview` - preview the Vite production build.
- `npm run docs:screenshots` - run a production build, then launch Electron to regenerate `docs/images/*.png` with mock data.
- `npm run brand:assets` - regenerate Windows icon assets via `scripts/generate-brand-assets.ps1`.
- `npm run dist:win` - run the renderer build and create the Windows NSIS installer with `electron-builder` into `release-build/`.

There is currently no `lint` or `test` script and no tracked test runner configuration. There is also no single-test command until a test runner is added.

## Architecture

This is a Windows-focused Electron desktop app for managing front-end projects, running shortcut/build commands, editing project `.env` files, and exporting zipped `dist` releases.

### Process boundaries and data flow

- `electron/main.cjs` is the Electron main process. It creates the `BrowserWindow`, loads Vite in development or `dist/index.html` in production, registers IPC handlers, samples system stats, manages child processes, and performs filesystem/shell operations.
- `electron/preload.cjs` is the only renderer bridge. It exposes `window.deployMaster` with `ipcRenderer.invoke` methods and event subscriptions for task updates/logs, system stats, and quit cleanup state.
- `shared/types.ts` defines the shared TypeScript contract for project config, publish profiles, task events, env file metadata, and `DeployMasterApi`. When adding or changing IPC APIs, keep `main.cjs`, `preload.cjs`, and `shared/types.ts` in sync.
- `electron/store.cjs` persists project configuration in Electron `userData/projects.json` and normalizes older or incomplete project records before returning them to the renderer.

### Main process responsibilities

- Project inspection reads a selected project's `package.json`, detects package manager from the `packageManager` field or lockfiles, imports scripts, and creates default shortcuts for common script names.
- Task execution runs shell commands in the target project root. On Windows it prefixes commands with `chcp 65001>nul` and strips ANSI/decodes output before streaming `task:log` events.
- Packaging tasks load the selected publish profile's env file as process env overrides, run the profile build command, wait for the configured dist directory, zip it with `archiver`, update last-package metadata, and reveal the zip in Explorer.
- Running tasks and archive streams are tracked in maps so `tasks:stop` and app quit cleanup can terminate child process trees and cancel zip output.
- Env file IPC is intentionally limited to project-root files matching `.env` or `.env.*`.

### Renderer structure

- `src/main.tsx` mounts the React app and global CSS.
- `src/App.tsx` owns app-level state: project list, grouping/sorting, task list, selected task, system stats, theme preference, settings, global naming rule, editor options, and toasts. It subscribes to preload events and passes action callbacks down.
- `src/components/ProjectCard.tsx` handles per-project UI: aliases/groups/platform labels, publish profiles, shortcut configuration/import from scripts, version bumping, editor launch menu, env editor expansion, and package/run actions.
- `src/components/EnvEditor.tsx` lists, reads, creates, saves, deletes, and highlights `.env` files through `window.deployMaster`; it supports Ctrl/Cmd+Slash comment toggling.
- `src/components/TaskConsole.tsx` renders task history, streamed logs, stop controls for running tasks, and output-folder opening for successful package tasks.
- `src/components/Icon.tsx` wraps the checked-in iconfont assets under `src/assets/icon/`; `ToastRegion.tsx` renders transient app notifications.
- `src/index.css` imports Tailwind CSS v4 and defines the app's light/dark design tokens and reusable surface/button/status classes used by the TSX components.

### Build and packaging notes

- `vite.config.ts` uses React and Tailwind plugins, `base: './'` for Electron file loading, and a strict dev server on `127.0.0.1:5173`.
- `package.json` `build.files` packages only `dist/**/*`, `electron/**/*`, and `package.json`; renderer source is not included in the installed app.
- `scripts/after-pack.cjs` runs only for Windows packaging and uses Electron Builder's `rcedit.exe` to set icon/version metadata on a copied executable before replacing the packaged exe.
- `scripts/capture-docs-screenshots.cjs` serves the built `dist/` from a local static server and uses `scripts/docs-screenshot-preload.cjs` mock data to capture stable documentation screenshots.
- Generated outputs such as `dist/`, `release-build/`, `release-build-fixed/`, and `node_modules/` are ignored and should not be treated as source files.
