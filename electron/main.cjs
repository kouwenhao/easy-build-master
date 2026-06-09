const { app, BrowserWindow, dialog, ipcMain, Notification, shell } = require('electron');
const archiver = require('archiver');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

const { ProjectStore } = require('./store.cjs');

class TaskCancelledError extends Error {
  constructor() {
    super('任务已停止');
    this.name = 'TaskCancelledError';
  }
}

const store = new ProjectStore();
const activeProcesses = new Map();
const activeTaskRuntimes = new Map();
const activeTaskPorts = new Map();
const PORT_PATTERNS = [
  // Vite: "Local: http://localhost:5173/"
  /(?:Local|Network|>\s*)\s*https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/i,
  // Webpack/Next.js/general: "http://localhost:3000"
  /https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/i,
  // Express/general: "listening on port 3000"
  /(?:listening|running|started|serving)\s+(?:on\s+)?(?:port\s+)?(\d{4,5})/i,
  // Angular: "port 4200"
  /port\s+(\d{4,5})/i,
];
const NAV_SERVER_PORT = 8000;
let navServer = null;
const ENV_FILE_PATTERN = /^\.env(?:\..+)?$/;
const VUE_CONFIG_PATTERN = /^vue\.config\.(js|ts)$/;
const DEFAULT_NAMING_RULE = '{displayName}_{datetime}';
const EDITOR_PRESETS = [
  { id: 'vscode', label: 'VS Code', command: 'code' },
  { id: 'antigravity', label: 'Antigravity', command: 'antigravity' },
  { id: 'trae', label: 'Trae', command: 'trae' },
  { id: 'custom', label: '自定义', command: '' },
];
let gbkDecoder = null;
let previousCpuSnapshot = null;
let latestSystemStats = null;
let systemStatsInterval = null;
let isQuittingAfterCleanup = false;
let quitCleanupPromise = null;

try {
  gbkDecoder = new TextDecoder('gbk');
} catch {
  gbkDecoder = null;
}

let mainWindow = null;

function createMainWindow() {
  const developmentIconPath = path.join(__dirname, '../build/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1240,
    minHeight: 840,
    backgroundColor: '#071018',
    autoHideMenuBar: true,
    icon: fsSync.existsSync(developmentIconPath) ? developmentIconPath : undefined,
    title: 'Front-End Deploy Master',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (latestSystemStats) {
      emitSystemStats(latestSystemStats);
    }
  });

  mainWindow.on('close', (event) => {
    if (process.platform !== 'win32' || isQuittingAfterCleanup) {
      return;
    }

    event.preventDefault();
    void requestAppQuitAfterCleanup();
  });
}

function emitTaskUpdate(payload) {
  mainWindow?.webContents.send('task:update', payload);
}

function emitTaskLog(payload) {
  mainWindow?.webContents.send('task:log', payload);
}

function emitSystemStats(payload) {
  mainWindow?.webContents.send('system:stats', payload);
}

function emitAppQuitState(payload) {
  mainWindow?.webContents.send('app:quit-state', payload);
}

function emitUpdateProgress(payload) {
  mainWindow?.webContents.send('updater:status', payload);
}

function createTaskRuntime(taskId) {
  const runtime = {
    cancelRequested: false,
    archive: null,
    outputStream: null,
  };

  activeTaskRuntimes.set(taskId, runtime);
  return runtime;
}

function getTaskRuntime(taskId) {
  return activeTaskRuntimes.get(taskId) ?? null;
}

function isTaskCancellationRequested(taskId) {
  return getTaskRuntime(taskId)?.cancelRequested === true;
}

function throwIfTaskCancelled(taskId) {
  if (isTaskCancellationRequested(taskId)) {
    throw new TaskCancelledError();
  }
}

function cleanupTaskRuntime(taskId) {
  activeProcesses.delete(taskId);
  activeTaskRuntimes.delete(taskId);
  activeTaskPorts.delete(taskId);
}

function appendSystemLog(taskId, chunk) {
  emitTaskLog({
    taskId,
    chunk: `${chunk}\n`,
    stream: 'system',
    timestamp: new Date().toISOString(),
  });
}

function detectPortFromOutput(chunk) {
  for (const pattern of PORT_PATTERNS) {
    const match = chunk.match(pattern);

    if (match && match[1]) {
      const port = Number.parseInt(match[1], 10);

      if (port >= 1024 && port <= 65535) {
        return port;
      }
    }
  }

  return null;
}

function registerTaskPort(taskId, port) {
  const existing = activeTaskPorts.get(taskId);

  if (existing?.port === port) {
    return;
  }

  const runtime = activeTaskRuntimes.get(taskId);

  if (!runtime) {
    return;
  }

  const project = runtime.project;
  const displayName = runtime.displayName || project?.projectName || '未知项目';
  const groupName = (project?.groupName || '').trim();

  activeTaskPorts.set(taskId, {
    taskId,
    projectId: project?.id || '',
    projectName: displayName,
    groupName,
    title: runtime.title || displayName,
    command: runtime.command || '',
    note: runtime.note || '',
    port,
    url: `http://localhost:${port}`,
  });
}

function getLanAddress() {
  const interfaces = os.networkInterfaces();

  for (const iface of Object.values(interfaces)) {
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }

  return null;
}

function buildNavPageHtml() {
  const lanAddress = getLanAddress();
  const lanIp = lanAddress || 'localhost';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Easy Build · 开发服务导航</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI Variable", "Microsoft YaHei UI", "PingFang SC", sans-serif;
    background: linear-gradient(180deg, #f0f5ff 0%, #e4ecf7 100%);
    color: #1e293b;
    min-height: 100vh;
    padding: 40px 24px;
  }
  .container { max-width: 720px; margin: 0 auto; }
  .header { text-align: center; margin-bottom: 40px; }
  .header h1 {
    font-size: 24px; font-weight: 700; letter-spacing: 0.04em;
    background: linear-gradient(135deg, #0284c7, #0d9488);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .header p { color: #64748b; font-size: 13px; margin-top: 8px; }
  .status-bar {
    display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; margin-bottom: 32px;
  }
  .status-badge {
    background: rgba(255,255,255,0.85); border: 1px solid rgba(15,23,42,0.08);
    border-radius: 999px; padding: 6px 16px; font-size: 12px; color: #64748b;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .status-badge strong { color: #1e293b; }
  .cards { display: flex; flex-direction: column; gap: 16px; }
  .card {
    background: rgba(255,255,255,0.88); border: 1px solid rgba(15,23,42,0.07);
    border-radius: 16px; padding: 20px 24px;
    transition: all 0.2s ease;
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  }
  .card:hover {
    background: rgba(255,255,255,0.96); border-color: rgba(14,165,233,0.25);
    transform: translateY(-1px); box-shadow: 0 6px 24px rgba(0,0,0,0.07);
  }
  .card-info { min-width: 0; flex: 1; }
  .card-title { font-size: 15px; font-weight: 600; color: #0f172a; }
  .card-subtitle { font-size: 12px; color: #94a3b8; margin-top: 4px; }
  .card-note {
    font-size: 12px; color: #0ea5e9; margin-top: 6px;
    background: rgba(14,165,233,0.08); border-radius: 6px; padding: 3px 10px;
    display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-weight: 500;
  }
  .card-port {
    display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0;
  }
  .port-badge {
    background: rgba(14,165,233,0.1); color: #0284c7; border-radius: 8px;
    padding: 4px 12px; font-size: 13px; font-weight: 600;
    font-family: "Cascadia Code", "JetBrains Mono", monospace;
  }
  .visit-btn {
    display: inline-flex; align-items: center; gap: 6px;
    background: linear-gradient(135deg, #0284c7, #0d9488);
    color: #fff; border: none; border-radius: 10px;
    padding: 8px 20px; font-size: 13px; font-weight: 600;
    cursor: pointer; text-decoration: none; white-space: nowrap;
    transition: all 0.15s ease;
  }
  .visit-btn:hover { filter: brightness(1.1); transform: scale(1.03); }
  .visit-btn.secondary {
    background: rgba(15,23,42,0.06); color: #475569; padding: 5px 14px; font-size: 11px; font-weight: 500;
  }
  .visit-btn.secondary:hover { background: rgba(15,23,42,0.1); }
  .empty-state {
    text-align: center; padding: 60px 20px;
    color: #94a3b8;
  }
  .empty-state .icon { font-size: 48px; margin-bottom: 16px; opacity: 0.5; }
  .empty-state p { font-size: 14px; line-height: 1.8; }
  .auto-refresh {
    text-align: center; margin-top: 32px;
    font-size: 11px; color: #94a3b8;
  }
  .pulse { display: inline-block; width: 6px; height: 6px; border-radius: 50%;
    background: #22c55e; margin-right: 6px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>EASY BUILD MASTER</h1>
    <p>开发服务导航 · 自动检测运行中的任务端口</p>
  </div>
  <div class="status-bar" id="statusBar"></div>
  <div class="cards" id="cards"></div>
  <div class="auto-refresh"><span class="pulse"></span>每 2 秒自动刷新</div>
</div>
<script>
var LAN_IP = ${JSON.stringify(lanIp)};
var cardsEl = document.getElementById('cards');
var statusBarEl = document.getElementById('statusBar');
var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

function buildUrl(port, host) {
  return 'http://' + host + ':' + port;
}

function render(ports) {
  var host = isLocal ? 'localhost' : location.hostname;
  statusBarEl.innerHTML = '<span class="status-badge">运行中：<strong>' + ports.length + '</strong> 个服务</span>' +
    (isLocal && LAN_IP !== 'localhost'
      ? '<span class="status-badge">局域网：<strong>' + LAN_IP + ':' + location.port + '</strong></span>'
      : '');
  if (ports.length === 0) {
    cardsEl.innerHTML = '<div class="empty-state"><div class="icon">📡</div><p>暂无运行中的开发服务<br>在 Easy Build 中启动开发任务后，端口将自动出现在这里</p></div>';
    return;
  }
  cardsEl.innerHTML = ports.map(function(p) {
    var primaryUrl = buildUrl(p.port, host);
    var displayName = p.groupName ? p.groupName + ' · ' + p.projectName : p.projectName;
    var links = '<a class="visit-btn" href="' + escHtml(primaryUrl) + '" target="_blank" rel="noopener">访问 ↗</a>';
    if (isLocal && LAN_IP !== 'localhost') {
      var lanUrl = buildUrl(p.port, LAN_IP);
      links += '<a class="visit-btn secondary" href="' + escHtml(lanUrl) + '" target="_blank" rel="noopener">局域网 ↗</a>';
    }
    return '<div class="card">' +
      '<div class="card-info">' +
        '<div class="card-title">' + escHtml(displayName) + '</div>' +
        '<div class="card-subtitle">' + escHtml(p.title) + '</div>' +
        (p.note ? '<div class="card-note">📝 ' + escHtml(p.note) + '</div>' : '') +
      '</div>' +
      '<div class="card-port">' +
        '<span class="port-badge">:' + p.port + '</span>' +
        links +
      '</div>' +
    '</div>';
  }).join('');
}

function escHtml(s) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
}

async function refresh() {
  try {
    var resp = await fetch('/api/ports');
    var data = await resp.json();
    render(data);
  } catch(e) {}
}

refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}

function startNavServer() {
  if (navServer) {
    return;
  }

  try {
    navServer = http.createServer((req, res) => {
      if (req.url === '/api/ports' && req.method === 'GET') {
        const ports = [...activeTaskPorts.values()];
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(ports));
        return;
      }

      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildNavPageHtml());
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    navServer.listen(NAV_SERVER_PORT, '0.0.0.0', () => {
      const interfaces = os.networkInterfaces();
      const addresses = [];

      for (const iface of Object.values(interfaces)) {
        for (const info of iface) {
          if (info.family === 'IPv4' && !info.internal) {
            addresses.push(info.address);
          }
        }
      }

      console.log(`导航页已启动: http://localhost:${NAV_SERVER_PORT}`);

      if (addresses.length > 0) {
        console.log(`局域网访问: http://${addresses[0]}:${NAV_SERVER_PORT}`);
      }
    });

    navServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.warn(`端口 ${NAV_SERVER_PORT} 已被占用，导航页未启动`);
      } else {
        console.warn('导航页启动失败:', error.message);
      }

      navServer = null;
    });
  } catch (error) {
    console.warn('导航页启动失败:', error.message);
    navServer = null;
  }
}

function stopNavServer() {
  if (!navServer) {
    return;
  }

  try {
    navServer.close();
  } catch {
    // ignore
  }

  navServer = null;
}

function captureCpuSnapshot() {
  return os.cpus().map((cpu) => ({
    idle: cpu.times.idle,
    total: cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle,
  }));
}

function calculateCpuUsage(currentSnapshot, previousSnapshot) {
  if (
    !Array.isArray(previousSnapshot) ||
    previousSnapshot.length === 0 ||
    previousSnapshot.length !== currentSnapshot.length
  ) {
    return null;
  }

  let idleDelta = 0;
  let totalDelta = 0;

  for (let index = 0; index < currentSnapshot.length; index += 1) {
    idleDelta += currentSnapshot[index].idle - previousSnapshot[index].idle;
    totalDelta += currentSnapshot[index].total - previousSnapshot[index].total;
  }

  if (totalDelta <= 0) {
    return null;
  }

  const usage = (1 - idleDelta / totalDelta) * 100;
  return Number(Math.min(Math.max(usage, 0), 100).toFixed(1));
}

function collectSystemStats() {
  const currentCpuSnapshot = captureCpuSnapshot();
  const memoryTotal = os.totalmem();
  const memoryUsed = memoryTotal - os.freemem();

  latestSystemStats = {
    cpuUsage: calculateCpuUsage(currentCpuSnapshot, previousCpuSnapshot),
    memoryUsed,
    memoryTotal,
    memoryUsage: memoryTotal > 0 ? Number(((memoryUsed / memoryTotal) * 100).toFixed(1)) : 0,
    timestamp: new Date().toISOString(),
  };

  previousCpuSnapshot = currentCpuSnapshot;
  return latestSystemStats;
}

function startSystemStatsLoop() {
  if (systemStatsInterval) {
    return;
  }

  collectSystemStats();
  systemStatsInterval = setInterval(() => {
    try {
      emitSystemStats(collectSystemStats());
    } catch {
      // ignore sampling failures and retry on next tick
    }
  }, 2000);
}

function stopSystemStatsLoop() {
  if (!systemStatsInterval) {
    return;
  }

  clearInterval(systemStatsInterval);
  systemStatsInterval = null;
}

function detectPackageManager(rootPath, packageManagerField) {
  const packageManager = packageManagerField?.split('@')[0];

  if (packageManager === 'pnpm' || packageManager === 'npm' || packageManager === 'yarn') {
    return packageManager;
  }

  if (fsSync.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }

  if (fsSync.existsSync(path.join(rootPath, 'yarn.lock'))) {
    return 'yarn';
  }

  return 'npm';
}

function buildScriptCommand(packageManager, scriptName) {
  if (packageManager === 'npm') {
    return `npm run ${scriptName}`;
  }

  return `${packageManager} ${scriptName}`;
}

function humanizeShortcutLabel(scriptName) {
  const labelMap = {
    dev: '开发',
    build: '构建',
    preview: '预览',
    test: '测试',
    lint: '检查',
  };

  return labelMap[scriptName] ?? scriptName;
}

function sanitizeShortcuts(shortcuts) {
  return shortcuts
    .map((shortcut) => ({
      id: shortcut.id || randomUUID(),
      label: (shortcut.label || '').trim() || '快捷命令',
      command: (shortcut.command || '').trim(),
    }))
    .filter((shortcut) => shortcut.command)
    .slice(0, 3);
}

function sanitizePublishProfiles(publishProfiles, fallbackConfig = {}) {
  const nextProfiles = (Array.isArray(publishProfiles) ? publishProfiles : [])
    .map((profile, index) => ({
      id: typeof profile.id === 'string' && profile.id.trim() ? profile.id : randomUUID(),
      name:
        (typeof profile.name === 'string' ? profile.name : '').trim() || `方案 ${index + 1}`,
      buildCommand:
        (typeof profile.buildCommand === 'string' ? profile.buildCommand : '').trim() ||
        fallbackConfig.buildCommand ||
        '',
      distDir:
        (typeof profile.distDir === 'string' ? profile.distDir : '').trim() ||
        fallbackConfig.distDir ||
        'dist',
      releaseDir:
        (typeof profile.releaseDir === 'string' ? profile.releaseDir : '').trim() ||
        fallbackConfig.releaseDir ||
        'dist-releases',
      envFileName: (typeof profile.envFileName === 'string' ? profile.envFileName : '').trim(),
      namingRule:
        (typeof profile.namingRule === 'string' ? profile.namingRule : '').trim() ||
        fallbackConfig.namingRule ||
        DEFAULT_NAMING_RULE,
      lastPackagedAt:
        typeof profile.lastPackagedAt === 'string' && profile.lastPackagedAt.trim()
          ? profile.lastPackagedAt
          : undefined,
      lastPackagePath:
        typeof profile.lastPackagePath === 'string' && profile.lastPackagePath.trim()
          ? profile.lastPackagePath
          : undefined,
    }))
    .filter((profile) => profile.buildCommand || profile.distDir || profile.releaseDir);

  if (nextProfiles.length > 0) {
    return nextProfiles;
  }

  return [
    {
      id: randomUUID(),
      name: '正式',
      buildCommand: fallbackConfig.buildCommand || '',
      distDir: fallbackConfig.distDir || 'dist',
      releaseDir: fallbackConfig.releaseDir || 'dist-releases',
      envFileName: '',
      namingRule: fallbackConfig.namingRule || DEFAULT_NAMING_RULE,
    },
  ];
}

function getActivePublishProfile(project, preferredProfileId) {
  const publishProfiles = sanitizePublishProfiles(project.publishProfiles, project);
  const activeProfileId =
    (typeof preferredProfileId === 'string' && preferredProfileId.trim()) ||
    (typeof project.activeProfileId === 'string' && project.activeProfileId.trim()) ||
    publishProfiles[0]?.id;

  return (
    publishProfiles.find((profile) => profile.id === activeProfileId) ??
    publishProfiles[0] ?? {
      id: randomUUID(),
      name: '正式',
      buildCommand: project.buildCommand || '',
      distDir: project.distDir || 'dist',
      releaseDir: project.releaseDir || 'dist-releases',
      envFileName: '',
      namingRule: DEFAULT_NAMING_RULE,
    }
  );
}

function syncProjectWithActiveProfile(project, preferredProfileId) {
  const publishProfiles = sanitizePublishProfiles(project.publishProfiles, project);
  const activeProfile = getActivePublishProfile(
    {
      ...project,
      publishProfiles,
    },
    preferredProfileId,
  );

  return {
    ...project,
    activeProfileId: activeProfile.id,
    publishProfiles,
    buildCommand: activeProfile.buildCommand,
    distDir: activeProfile.distDir,
    releaseDir: activeProfile.releaseDir,
  };
}

function getProjectDisplayName(project) {
  return (project.alias || '').trim() || project.projectName;
}

function buildDefaultShortcuts(scripts, packageManager) {
  const preferredScripts = ['dev', 'build', 'preview', 'test', 'lint'];
  const availableScripts = preferredScripts.filter((scriptName) => scripts?.[scriptName]);
  const fallbackScripts = ['dev', 'build', 'preview'];
  const selectedScripts = (availableScripts.length > 0 ? availableScripts : fallbackScripts).slice(
    0,
    3,
  );

  return selectedScripts.map((scriptName) => ({
    id: randomUUID(),
    label: humanizeShortcutLabel(scriptName),
    command: buildScriptCommand(packageManager, scriptName),
  }));
}

function buildAvailableScripts(scripts, packageManager) {
  if (!scripts || typeof scripts !== 'object') {
    return [];
  }

  return Object.keys(scripts).map((scriptName) => ({
    name: scriptName,
    label: humanizeShortcutLabel(scriptName),
    command: buildScriptCommand(packageManager, scriptName),
  }));
}

function parseEnvContent(content) {
  const environment = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const match = trimmedLine.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);

    if (!match) {
      continue;
    }

    const key = match[1];
    let value = match[2] ?? '';

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);

      if (quote === '"') {
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"');
      }
    }

    environment[key] = value;
  }

  return environment;
}

function resolveProjectEditor(project) {
  const preset = EDITOR_PRESETS.find((item) => item.id === project.editorId) ?? EDITOR_PRESETS[0];
  const customCommand = typeof project.editorCommand === 'string' ? project.editorCommand.trim() : '';
  const editorCommand = preset.id === 'custom' ? customCommand : customCommand || preset.command;

  return {
    editorId: preset.id,
    editorLabel: preset.label,
    editorCommand,
  };
}

function buildConfigExportFileName(date = new Date()) {
  const pad = (value) => value.toString().padStart(2, '0');
  return `easy-build-master-config-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
}

function serializeProjectForExport(project) {
  return {
    id: project.id,
    rootPath: project.rootPath,
    alias: project.alias || '',
    groupName: project.groupName || '',
    platformLabel: project.platformLabel || '',
    editorId: project.editorId || 'vscode',
    editorCommand: project.editorCommand || '',
    activeProfileId: project.activeProfileId || '',
    publishProfiles: sanitizePublishProfiles(project.publishProfiles, project),
    shortcuts: sanitizeShortcuts(project.shortcuts || []),
  };
}

function extractImportedProjects(payload) {
  const projectList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.projects)
      ? payload.projects
      : null;

  if (!projectList) {
    throw new Error('配置文件格式无效');
  }

  return projectList;
}

function detectJsonIndentation(content) {
  const match = content.match(/^[ \t]+(?="[^"]+":)/m);
  return match?.[0] ?? '  ';
}

function detectLineEnding(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function parseSemverVersion(version) {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function resolveNextVersion(currentVersion, mode, explicitVersion) {
  if (mode === 'set') {
    const nextVersion = typeof explicitVersion === 'string' ? explicitVersion.trim() : '';

    if (!nextVersion) {
      throw new Error('请输入新的版本号');
    }

    return nextVersion;
  }

  const parsedVersion = parseSemverVersion(currentVersion);

  if (!parsedVersion) {
    throw new Error('当前版本号不是标准 semver，请使用自定义版本');
  }

  if (mode === 'major') {
    return `${parsedVersion.major + 1}.0.0`;
  }

  if (mode === 'minor') {
    return `${parsedVersion.major}.${parsedVersion.minor + 1}.0`;
  }

  return `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch + 1}`;
}

async function writeProjectVersion(rootPath, nextVersion) {
  const manifestPath = path.join(rootPath, 'package.json');
  const manifestContent = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestContent);
  const indentation = detectJsonIndentation(manifestContent);
  const lineEnding = detectLineEnding(manifestContent);
  const hasTrailingNewLine = /\r?\n$/.test(manifestContent);

  manifest.version = nextVersion;

  const serializedManifest =
    JSON.stringify(manifest, null, indentation).replace(/\n/g, lineEnding) +
    (hasTrailingNewLine ? lineEnding : '');

  await fs.writeFile(manifestPath, serializedManifest, 'utf-8');
}

async function updateProjectVersion(project, mode, explicitVersion) {
  const nextVersion = resolveNextVersion(project.version || '0.0.0', mode, explicitVersion);

  await writeProjectVersion(project.rootPath, nextVersion);

  const updatedProject = await hydrateProject(project.rootPath, {
    ...project,
    version: nextVersion,
  });
  await store.upsert(updatedProject);
  return updatedProject;
}

async function inspectProject(rootPath) {
  const manifestPath = path.join(rootPath, 'package.json');
  const manifestContent = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestContent);
  const packageManager = detectPackageManager(rootPath, manifest.packageManager);
  const scripts =
    manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : undefined;

  return {
    projectName:
      typeof manifest.name === 'string' && manifest.name.trim()
        ? manifest.name.trim()
        : path.basename(rootPath),
    version:
      typeof manifest.version === 'string' && manifest.version.trim()
        ? manifest.version.trim()
        : '0.0.0',
    packageManager,
    availableScripts: buildAvailableScripts(scripts, packageManager),
    buildCommand: buildScriptCommand(packageManager, 'build'),
    shortcuts: buildDefaultShortcuts(scripts, packageManager),
  };
}

async function hydrateProject(rootPath, existingProject) {
  const metadata = await inspectProject(rootPath);
  const now = new Date().toISOString();
  const publishProfiles = sanitizePublishProfiles(existingProject?.publishProfiles, {
    buildCommand: existingProject?.buildCommand?.trim() || metadata.buildCommand,
    distDir: existingProject?.distDir?.trim() || 'dist',
    releaseDir: existingProject?.releaseDir?.trim() || 'dist-releases',
    namingRule: DEFAULT_NAMING_RULE,
  });

  return syncProjectWithActiveProfile({
    id: existingProject?.id ?? randomUUID(),
    rootPath,
    projectName: metadata.projectName,
    alias: existingProject?.alias?.trim() || '',
    groupName:
      typeof existingProject?.groupName === 'string' ? existingProject.groupName.trim() : '',
    platformLabel:
      typeof existingProject?.platformLabel === 'string'
        ? existingProject.platformLabel.trim()
        : '',
    editorId:
      typeof existingProject?.editorId === 'string' && existingProject.editorId.trim()
        ? existingProject.editorId.trim()
        : 'vscode',
    editorCommand:
      typeof existingProject?.editorCommand === 'string' ? existingProject.editorCommand.trim() : '',
    version: metadata.version,
    packageManager: metadata.packageManager,
    activeProfileId:
      typeof existingProject?.activeProfileId === 'string' ? existingProject.activeProfileId : '',
    distDir: existingProject?.distDir?.trim() || publishProfiles[0].distDir || 'dist',
    releaseDir:
      existingProject?.releaseDir?.trim() || publishProfiles[0].releaseDir || 'dist-releases',
    buildCommand:
      existingProject?.buildCommand?.trim() ||
      publishProfiles[0].buildCommand ||
      metadata.buildCommand,
    publishProfiles,
    availableScripts: metadata.availableScripts,
    shortcuts:
      existingProject?.shortcuts?.length > 0
        ? sanitizeShortcuts(existingProject.shortcuts)
        : metadata.shortcuts,
    updatedAt: now,
    lastPackagedAt: existingProject?.lastPackagedAt,
    lastPackagePath: existingProject?.lastPackagePath,
  });
}

function createTaskState(project, taskId, title, kind, status, command, profileName) {
  return {
    id: taskId,
    projectId: project.id,
    projectName: getProjectDisplayName(project),
    profileName,
    title,
    kind,
    status,
    command,
    startedAt: new Date().toISOString(),
  };
}

async function executeCommand(taskId, project, command, extraEnv = {}) {
  appendSystemLog(taskId, `执行命令: ${command}`);

  return new Promise((resolve, reject) => {
    const commandToRun =
      process.platform === 'win32' ? `chcp 65001>nul && ${command}` : command;

    const childProcess = spawn(commandToRun, {
      cwd: project.rootPath,
      shell: true,
      env: {
        ...process.env,
        ...extraEnv,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    activeProcesses.set(taskId, childProcess);

    childProcess.stdout?.on('data', (chunk) => {
      const text = normalizeCommandOutput(chunk);

      emitTaskLog({
        taskId,
        chunk: text,
        stream: 'stdout',
        timestamp: new Date().toISOString(),
      });

      const detectedPort = detectPortFromOutput(text);

      if (detectedPort) {
        registerTaskPort(taskId, detectedPort);
      }
    });

    childProcess.stderr?.on('data', (chunk) => {
      const text = normalizeCommandOutput(chunk);

      emitTaskLog({
        taskId,
        chunk: text,
        stream: 'stderr',
        timestamp: new Date().toISOString(),
      });

      const detectedPort = detectPortFromOutput(text);

      if (detectedPort) {
        registerTaskPort(taskId, detectedPort);
      }
    });

    childProcess.on('error', (error) => {
      activeProcesses.delete(taskId);
      reject(error);
    });

    childProcess.on('close', (code) => {
      activeProcesses.delete(taskId);

      if (isTaskCancellationRequested(taskId)) {
        reject(new TaskCancelledError());
        return;
      }

      if (code === 0) {
        appendSystemLog(taskId, '命令执行完成');
        resolve();
        return;
      }

      reject(new Error(`命令退出码 ${code ?? -1}`));
    });
  });
}

function formatTimestampParts(date) {
  const pad = (value) => value.toString().padStart(2, '0');

  return {
    datePart: `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`,
    timePart: `${pad(date.getHours())}时${pad(date.getMinutes())}分${pad(date.getSeconds())}秒`,
  };
}

function sanitizeFileNameSegment(value) {
  return value.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-');
}

function applyNamingRule(project, publishProfile, date, namingRuleOverride) {
  const displayName = getProjectDisplayName(project);
  const { datePart, timePart } = formatTimestampParts(date);
  const namingContext = {
    projectName: project.projectName,
    alias: project.alias || '',
    displayName,
    profile: publishProfile.name || '',
    version: project.version || '',
    envFile: publishProfile.envFileName || '',
    date: datePart,
    time: timePart,
    datetime: `${datePart}_${timePart}`,
    timestamp: `${datePart}_${timePart}`,
  };

  const namingRule =
    (typeof namingRuleOverride === 'string' && namingRuleOverride.trim()) ||
    publishProfile.namingRule ||
    DEFAULT_NAMING_RULE;
  const rawFileName = namingRule.replace(
    /\{([A-Za-z0-9_]+)\}/g,
    (_match, token) => namingContext[token] ?? '',
  );
  const normalizedFileName = rawFileName
    .replace(/[_-]{2,}/g, (value) => value[0])
    .replace(/(^[_.\-\s]+|[_.\-\s]+$)/g, '')
    .trim();

  return sanitizeFileNameSegment(normalizedFileName || `${displayName}_${datePart}_${timePart}`);
}

async function loadPublishProfileEnv(project, publishProfile, taskId) {
  if (!publishProfile.envFileName) {
    return {};
  }

  const filePath = resolveEnvFilePath(project, publishProfile.envFileName);
  appendSystemLog(taskId, `加载环境变量文件: ${publishProfile.envFileName}`);
  const content = await fs.readFile(filePath, 'utf-8');
  return parseEnvContent(content);
}

function stripAnsi(value) {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '');
}

function decodeCommandChunk(chunk) {
  if (typeof chunk === 'string') {
    return chunk;
  }

  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const utf8Text = buffer.toString('utf8');

  if (!utf8Text.includes('\uFFFD') || !gbkDecoder) {
    return utf8Text;
  }

  try {
    return gbkDecoder.decode(buffer);
  } catch {
    return utf8Text;
  }
}

function normalizeCommandOutput(chunk) {
  return stripAnsi(decodeCommandChunk(chunk));
}

async function exportConfigFile() {
  const projects = await store.list();
  const defaultPath = path.join(app.getPath('documents'), buildConfigExportFileName());
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: '导出配置文件',
    defaultPath,
    filters: [{ name: 'JSON 配置文件', extensions: ['json'] }],
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  const payload = {
    app: 'easy-build-master',
    version: 1,
    exportedAt: new Date().toISOString(),
    projectCount: projects.length,
    projects: projects.map((project) => serializeProjectForExport(project)),
  };

  await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');

  return {
    filePath: result.filePath,
    projectCount: payload.projectCount,
  };
}

async function importConfigFile() {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: '导入配置文件',
    properties: ['openFile'],
    filters: [{ name: 'JSON 配置文件', extensions: ['json'] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const payload = JSON.parse(fileContent);
  const importedProjects = extractImportedProjects(payload);
  const currentProjects = await store.list();
  const mergedProjects = [...currentProjects];
  const indexByRootPath = new Map(
    mergedProjects.map((project, index) => [project.rootPath, index]),
  );
  const reservedProjectIds = new Set(mergedProjects.map((project) => project.id));

  let importedCount = 0;
  let skippedCount = 0;

  for (const importedProject of importedProjects) {
    const rootPath = typeof importedProject?.rootPath === 'string' ? importedProject.rootPath.trim() : '';

    if (!rootPath) {
      skippedCount += 1;
      continue;
    }

    const existingIndex = indexByRootPath.get(rootPath);
    const existingProject = existingIndex !== undefined ? mergedProjects[existingIndex] : undefined;
    const importedProjectId =
      typeof importedProject.id === 'string' && importedProject.id.trim() ? importedProject.id : undefined;
    const nextProjectId =
      existingProject?.id ||
      (importedProjectId && !reservedProjectIds.has(importedProjectId) ? importedProjectId : undefined);

    try {
      const hydratedProject = await hydrateProject(rootPath, {
        ...existingProject,
        id: nextProjectId,
        rootPath,
        alias:
          typeof importedProject.alias === 'string' ? importedProject.alias : existingProject?.alias,
        groupName:
          typeof importedProject.groupName === 'string'
            ? importedProject.groupName
            : existingProject?.groupName,
        platformLabel:
          typeof importedProject.platformLabel === 'string'
            ? importedProject.platformLabel
            : existingProject?.platformLabel,
        editorId:
          typeof importedProject.editorId === 'string'
            ? importedProject.editorId
            : existingProject?.editorId,
        editorCommand:
          typeof importedProject.editorCommand === 'string'
            ? importedProject.editorCommand
            : existingProject?.editorCommand,
        activeProfileId:
          typeof importedProject.activeProfileId === 'string'
            ? importedProject.activeProfileId
            : existingProject?.activeProfileId,
        publishProfiles: Array.isArray(importedProject.publishProfiles)
          ? importedProject.publishProfiles
          : existingProject?.publishProfiles,
        shortcuts: Array.isArray(importedProject.shortcuts)
          ? importedProject.shortcuts
          : existingProject?.shortcuts,
      });

      if (existingIndex !== undefined) {
        mergedProjects[existingIndex] = hydratedProject;
      } else {
        indexByRootPath.set(rootPath, mergedProjects.length);
        mergedProjects.push(hydratedProject);
      }

      reservedProjectIds.add(hydratedProject.id);

      importedCount += 1;
    } catch {
      skippedCount += 1;
    }
  }

  const nextProjects = await store.replaceAll(mergedProjects);

  return {
    filePath,
    importedCount,
    skippedCount,
    totalCount: nextProjects.length,
    projects: nextProjects,
  };
}

async function openProjectInEditor(project, preferredEditor = null) {
  const fallbackEditor = resolveProjectEditor(project);
  const editorCommand =
    typeof preferredEditor?.command === 'string' && preferredEditor.command.trim()
      ? preferredEditor.command.trim()
      : fallbackEditor.editorCommand;
  const editorLabel =
    typeof preferredEditor?.label === 'string' && preferredEditor.label.trim()
      ? preferredEditor.label.trim()
      : fallbackEditor.editorLabel;

  if (!editorCommand) {
    throw new Error('未配置编辑器命令');
  }

  const quotedProjectPath = `"${project.rootPath.replace(/"/g, '\\"')}"`;
  const commandToRun =
    editorCommand.includes('{projectPath}')
      ? editorCommand.replaceAll('{projectPath}', quotedProjectPath)
      : `${editorCommand} ${quotedProjectPath}`;

  await new Promise((resolve, reject) => {
    const childProcess = spawn(commandToRun, {
      cwd: project.rootPath,
      shell: true,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    let settled = false;

    childProcess.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    });

    childProcess.on('close', (code) => {
      if (settled) {
        return;
      }

      if (typeof code === 'number' && code !== 0) {
        settled = true;
        reject(new Error(`${editorLabel} 打开失败，请确认命令可用：${editorCommand}`));
        return;
      }

      settled = true;
      resolve();
    });

    childProcess.on('spawn', () => {
      childProcess.unref();
      setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      }, 300);
    });
  });
}

function resolveEnvFilePath(project, fileName) {
  if (typeof fileName !== 'string' || !ENV_FILE_PATTERN.test(fileName)) {
    throw new Error('仅支持项目根目录下的 .env 文件');
  }

  if (fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('环境文件名不合法');
  }

  return path.join(project.rootPath, fileName);
}

async function listProjectEnvFiles(project) {
  const entries = await fs.readdir(project.rootPath, { withFileTypes: true });
  const envFileNames = entries
    .filter((entry) => entry.isFile() && ENV_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => {
      if (left === '.env') {
        return -1;
      }

      if (right === '.env') {
        return 1;
      }

      return left.localeCompare(right);
    });

  return Promise.all(
    envFileNames.map(async (fileName) => {
      const stats = await fs.stat(path.join(project.rootPath, fileName));

      return {
        fileName,
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
      };
    }),
  );
}

function resolveVueConfigFilePath(project, fileName) {
  if (typeof fileName !== 'string' || !VUE_CONFIG_PATTERN.test(fileName)) {
    throw new Error('仅支持项目根目录下的 vue.config.js 或 vue.config.ts 文件');
  }

  if (fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('文件名不合法');
  }

  return path.join(project.rootPath, fileName);
}

async function listProjectVueConfigFiles(project) {
  const entries = await fs.readdir(project.rootPath, { withFileTypes: true });
  const configFileNames = entries
    .filter((entry) => entry.isFile() && VUE_CONFIG_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    configFileNames.map(async (fileName) => {
      const stats = await fs.stat(path.join(project.rootPath, fileName));

      return {
        fileName,
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
      };
    }),
  );
}

async function waitForDistDirectory(distPath, timeoutMs = 12000, taskId) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    throwIfTaskCancelled(taskId);

    try {
      const stats = await fs.stat(distPath);

      if (stats.isDirectory()) {
        throwIfTaskCancelled(taskId);
        return;
      }
    } catch {
      throwIfTaskCancelled(taskId);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  throwIfTaskCancelled(taskId);
  throw new Error(`未检测到 dist 目录: ${distPath}`);
}

async function zipDirectory(sourceDir, targetZipPath, taskId) {
  await fs.mkdir(path.dirname(targetZipPath), { recursive: true });

  if (fsSync.existsSync(targetZipPath)) {
    await fs.unlink(targetZipPath);
  }

  appendSystemLog(taskId, `压缩目录: ${sourceDir}`);
  throwIfTaskCancelled(taskId);

  const runtime = getTaskRuntime(taskId);

  try {
    await new Promise((resolve, reject) => {
      const outputStream = fsSync.createWriteStream(targetZipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      let settled = false;

      if (runtime) {
        runtime.archive = archive;
        runtime.outputStream = outputStream;
      }

      const finishResolve = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };

      const finishReject = (error) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      };

      outputStream.on('close', () => {
        if (isTaskCancellationRequested(taskId)) {
          finishReject(new TaskCancelledError());
          return;
        }

        appendSystemLog(taskId, `压缩完成，共 ${archive.pointer()} 字节`);
        finishResolve();
      });

      outputStream.on('error', finishReject);

      archive.on('warning', (warning) => {
        if (warning.code === 'ENOENT') {
          appendSystemLog(taskId, `压缩警告: ${warning.message}`);
          return;
        }

        finishReject(warning);
      });

      archive.on('error', finishReject);
      archive.pipe(outputStream);
      archive.directory(sourceDir, false);
      void archive.finalize();
    });
  } catch (error) {
    if (fsSync.existsSync(targetZipPath)) {
      await fs.unlink(targetZipPath).catch(() => undefined);
    }

    throw error;
  } finally {
    if (runtime) {
      runtime.archive = null;
      runtime.outputStream = null;
    }
  }
}

async function runShortcutTask(taskId, project, shortcut, note) {
  const displayName = getProjectDisplayName(project);
  const title = `${displayName} · ${shortcut.label}`;
  const startedAt = new Date().toISOString();
  const runtime = createTaskRuntime(taskId);
  runtime.project = project;
  runtime.displayName = displayName;
  runtime.title = title;
  runtime.command = shortcut.command;
  runtime.note = note || '';

  emitTaskUpdate({
    ...createTaskState(project, taskId, title, 'shortcut', 'running', shortcut.command),
    startedAt,
  });

  try {
    await executeCommand(taskId, project, shortcut.command);

    emitTaskUpdate({
      id: taskId,
      projectId: project.id,
      projectName: displayName,
      title,
      kind: 'shortcut',
      status: 'success',
      command: shortcut.command,
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: 0,
    });
  } catch (error) {
    emitTaskUpdate({
      id: taskId,
      projectId: project.id,
      projectName: displayName,
      title,
      kind: 'shortcut',
      status: error instanceof TaskCancelledError ? 'cancelled' : 'error',
      command: shortcut.command,
      startedAt,
      endedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : '命令执行失败',
    });
  } finally {
    cleanupTaskRuntime(taskId);
  }
}

async function runPackageTask(taskId, project, preferredProfileId, namingRuleOverride) {
  const displayName = getProjectDisplayName(project);
  const publishProfile = getActivePublishProfile(project, preferredProfileId);
  const title = `${displayName} · ${publishProfile.name} 发布`;
  const startedAt = new Date().toISOString();
  const runtime = createTaskRuntime(taskId);
  runtime.project = project;
  runtime.displayName = displayName;
  runtime.title = title;
  runtime.command = publishProfile.buildCommand;

  emitTaskUpdate({
    ...createTaskState(
      project,
      taskId,
      title,
      'package',
      'running',
      publishProfile.buildCommand,
      publishProfile.name,
    ),
    startedAt,
  });

  try {
    appendSystemLog(taskId, `使用发布方案: ${publishProfile.name}`);

    if (!publishProfile.buildCommand) {
      throw new Error(`发布方案 ${publishProfile.name} 未配置 Build 命令`);
    }

    const envOverrides = await loadPublishProfileEnv(project, publishProfile, taskId);
    await executeCommand(taskId, project, publishProfile.buildCommand, envOverrides);

    const distPath = path.join(project.rootPath, publishProfile.distDir);
    appendSystemLog(taskId, `等待构建产物目录: ${distPath}`);
    await waitForDistDirectory(distPath, 12000, taskId);

    const releaseDir = path.join(project.rootPath, publishProfile.releaseDir);
    const now = new Date();
    const zipBaseName = applyNamingRule(project, publishProfile, now, namingRuleOverride);
    const zipName = `${zipBaseName}.zip`;
    const zipPath = path.join(releaseDir, zipName);

    await zipDirectory(distPath, zipPath, taskId);

    const nextPublishProfiles = sanitizePublishProfiles(project.publishProfiles, project).map((profile) =>
      profile.id === publishProfile.id
        ? {
            ...profile,
            lastPackagedAt: now.toISOString(),
            lastPackagePath: zipPath,
          }
        : profile,
    );
    const updatedProject = syncProjectWithActiveProfile({
      ...project,
      activeProfileId: publishProfile.id,
      publishProfiles: nextPublishProfiles,
      lastPackagedAt: now.toISOString(),
      lastPackagePath: zipPath,
      updatedAt: now.toISOString(),
    });

    await store.upsert(updatedProject);

    if (Notification.isSupported()) {
      new Notification({
        title: '打包完成',
        body: `${displayName} · ${publishProfile.name} 已导出到 ${publishProfile.releaseDir} 目录`,
      }).show();
    }

    shell.showItemInFolder(zipPath);

    emitTaskUpdate({
      id: taskId,
      projectId: project.id,
      projectName: displayName,
      profileName: publishProfile.name,
      title,
      kind: 'package',
      status: 'success',
      command: publishProfile.buildCommand,
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: 0,
      outputPath: zipPath,
    });
  } catch (error) {
    emitTaskUpdate({
      id: taskId,
      projectId: project.id,
      projectName: displayName,
      profileName: publishProfile.name,
      title,
      kind: 'package',
      status: error instanceof TaskCancelledError ? 'cancelled' : 'error',
      command: publishProfile.buildCommand,
      startedAt,
      endedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : '打包失败',
    });
  } finally {
    cleanupTaskRuntime(taskId);
  }
}

async function stopTask(taskId) {
  const runtime = getTaskRuntime(taskId);
  const childProcess = activeProcesses.get(taskId);

  if (!runtime && !childProcess?.pid) {
    return;
  }

  if (!runtime?.cancelRequested) {
    if (runtime) {
      runtime.cancelRequested = true;
    }

    appendSystemLog(taskId, '收到停止指令，正在终止任务');
  }

  if (runtime?.archive) {
    runtime.archive.abort();
  }

  if (runtime?.outputStream && !runtime.outputStream.destroyed) {
    runtime.outputStream.destroy(new TaskCancelledError());
  }

  if (!childProcess?.pid) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/pid', childProcess.pid.toString(), '/T', '/F'], {
        windowsHide: true,
      });

      killer.on('close', () => resolve());
      killer.on('error', reject);
    });

    return;
  }

  childProcess.kill('SIGTERM');
}

function registerIpcHandlers() {
  ipcMain.handle('projects:list', async () => {
    const projects = await store.list();

    return Promise.all(
      projects.map(async (project) => {
        try {
          const metadata = await inspectProject(project.rootPath);
          const nextProject = syncProjectWithActiveProfile({
            ...project,
            projectName: metadata.projectName,
            version: metadata.version,
            packageManager: metadata.packageManager,
            availableScripts: metadata.availableScripts,
          });

          await store.upsert(nextProject);
          return nextProject;
        } catch {
          return project;
        }
      }),
    );
  });

  ipcMain.handle('projects:add', async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      properties: ['openDirectory'],
      title: '选择前端项目目录',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const rootPath = result.filePaths[0];
    const existingProject = await store.findByRoot(rootPath);
    const hydratedProject = await hydrateProject(rootPath, existingProject);

    await store.upsert(hydratedProject);
    return hydratedProject;
  });

  ipcMain.handle('projects:update', async (_event, incomingProject) => {
    const existingProject = await store.findById(incomingProject.id);

    if (!existingProject) {
      throw new Error('项目不存在');
    }

    const refreshedProject = await hydrateProject(existingProject.rootPath, existingProject);
    const updatedProject = syncProjectWithActiveProfile({
      ...refreshedProject,
      alias: (incomingProject.alias || '').trim(),
      groupName:
        typeof incomingProject.groupName === 'string'
          ? incomingProject.groupName.trim()
          : refreshedProject.groupName,
      platformLabel:
        typeof incomingProject.platformLabel === 'string'
          ? incomingProject.platformLabel.trim()
          : refreshedProject.platformLabel,
      editorId:
        typeof incomingProject.editorId === 'string' && incomingProject.editorId.trim()
          ? incomingProject.editorId.trim()
          : refreshedProject.editorId,
      editorCommand:
        typeof incomingProject.editorCommand === 'string'
          ? incomingProject.editorCommand.trim()
          : refreshedProject.editorCommand,
      activeProfileId:
        (typeof incomingProject.activeProfileId === 'string' && incomingProject.activeProfileId.trim()) ||
        refreshedProject.activeProfileId,
      publishProfiles: sanitizePublishProfiles(
        Array.isArray(incomingProject.publishProfiles) && incomingProject.publishProfiles.length > 0
          ? incomingProject.publishProfiles
          : refreshedProject.publishProfiles,
        refreshedProject,
      ),
      shortcuts:
        sanitizeShortcuts(incomingProject.shortcuts || []).length > 0
          ? sanitizeShortcuts(incomingProject.shortcuts)
          : refreshedProject.shortcuts,
      updatedAt: new Date().toISOString(),
    }, incomingProject.activeProfileId);

    await store.upsert(updatedProject);
    return updatedProject;
  });

  ipcMain.handle('projects:update-version', async (_event, payload) => {
    const project = await store.findById(payload?.projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    const mode = payload?.mode;

    if (mode !== 'patch' && mode !== 'minor' && mode !== 'major' && mode !== 'set') {
      throw new Error('版本更新类型无效');
    }

    return updateProjectVersion(project, mode, payload?.version);
  });

  ipcMain.handle('projects:refresh', async (_event, projectId) => {
    const existingProject = await store.findById(projectId);

    if (!existingProject) {
      throw new Error('项目不存在');
    }

    const refreshedProject = await hydrateProject(existingProject.rootPath, existingProject);
    await store.upsert(refreshedProject);
    return refreshedProject;
  });

  ipcMain.handle('projects:remove', async (_event, projectId) => {
    await store.remove(projectId);
  });

  ipcMain.handle('projects:reorder', async (_event, projectIds) => {
    if (!Array.isArray(projectIds)) {
      throw new Error('排序数据无效');
    }

    return store.reorder(projectIds);
  });

  ipcMain.handle('config:export', async () => exportConfigFile());

  ipcMain.handle('config:import', async () => importConfigFile());

  ipcMain.handle('env:list', async (_event, projectId) => {
    const project = await store.findById(projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    return listProjectEnvFiles(project);
  });

  ipcMain.handle('env:read', async (_event, payload) => {
    const project = await store.findById(payload.projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    const filePath = resolveEnvFilePath(project, payload.fileName);
    const content = await fs.readFile(filePath, 'utf-8');

    return {
      fileName: payload.fileName,
      content,
    };
  });

  ipcMain.handle('env:save', async (_event, payload) => {
    const project = await store.findById(payload.projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    const filePath = resolveEnvFilePath(project, payload.fileName);
    await fs.writeFile(filePath, typeof payload.content === 'string' ? payload.content : '', 'utf-8');
    const stats = await fs.stat(filePath);

    return {
      fileName: payload.fileName,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    };
  });

  ipcMain.handle('env:delete', async (_event, payload) => {
    const project = await store.findById(payload.projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    const filePath = resolveEnvFilePath(project, payload.fileName);
    await fs.unlink(filePath);
  });

  ipcMain.handle('vue-config:list', async (_event, projectId) => {
    const project = await store.findById(projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    return listProjectVueConfigFiles(project);
  });

  ipcMain.handle('vue-config:read', async (_event, payload) => {
    const project = await store.findById(payload.projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    const filePath = resolveVueConfigFilePath(project, payload.fileName);
    const content = await fs.readFile(filePath, 'utf-8');

    return {
      fileName: payload.fileName,
      content,
    };
  });

  ipcMain.handle('vue-config:save', async (_event, payload) => {
    const project = await store.findById(payload.projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    const filePath = resolveVueConfigFilePath(project, payload.fileName);
    await fs.writeFile(filePath, typeof payload.content === 'string' ? payload.content : '', 'utf-8');
    const stats = await fs.stat(filePath);

    return {
      fileName: payload.fileName,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    };
  });

  ipcMain.handle('vue-config:delete', async (_event, payload) => {
    const project = await store.findById(payload.projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    const filePath = resolveVueConfigFilePath(project, payload.fileName);
    await fs.unlink(filePath);
  });

  ipcMain.handle('tasks:run-shortcut', async (_event, payload) => {
    const project = await store.findById(payload.projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    const shortcut = project.shortcuts.find((item) => item.id === payload.shortcutId);

    if (!shortcut) {
      throw new Error('快捷命令不存在');
    }

    const note = typeof payload.note === 'string' ? payload.note.trim() : '';
    const taskId = randomUUID();
    void runShortcutTask(taskId, project, shortcut, note);
    return { taskId };
  });

  ipcMain.handle('tasks:package', async (_event, payload) => {
    const projectId =
      typeof payload === 'string' ? payload : payload?.projectId;
    const preferredProfileId =
      typeof payload === 'object' && payload ? payload.profileId : undefined;
    const namingRule =
      typeof payload === 'object' && payload && typeof payload.namingRule === 'string'
        ? payload.namingRule
        : undefined;
    const project = await store.findById(projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    const taskId = randomUUID();
    void runPackageTask(taskId, project, preferredProfileId, namingRule);
    return { taskId };
  });

  ipcMain.handle('tasks:stop', async (_event, taskId) => {
    await stopTask(taskId);
  });

  ipcMain.handle('shell:open-path', async (_event, targetPath) => {
    const stats = await fs.stat(targetPath);

    if (stats.isFile()) {
      shell.showItemInFolder(targetPath);
      return;
    }

    await shell.openPath(targetPath);
  });

  ipcMain.handle('shell:open-in-editor', async (_event, payload) => {
    const projectId = typeof payload === 'string' ? payload : payload?.projectId;
    const project = await store.findById(projectId);

    if (!project) {
      throw new Error('项目不存在');
    }

    const preferredEditor =
      typeof payload === 'object' && payload
        ? {
            command: payload.editorCommand,
            label: payload.editorLabel,
          }
        : null;

    await openProjectInEditor(project, preferredEditor);
  });

  ipcMain.handle('system:stats:get', async () => latestSystemStats ?? collectSystemStats());

  ipcMain.handle('app:version', async () => app.getVersion());

  ipcMain.handle('updater:check', async () => {
    await autoUpdater.checkForUpdates();
  });

  ipcMain.handle('updater:install', async () => {
    autoUpdater.quitAndInstall(false, true);
  });
}

async function cleanupActiveProcesses() {
  const taskIds = [...activeTaskRuntimes.keys()];

  if (taskIds.length === 0) {
    return;
  }

  await Promise.allSettled(taskIds.map((taskId) => stopTask(taskId)));
}

function requestAppQuitAfterCleanup() {
  if (isQuittingAfterCleanup) {
    return quitCleanupPromise ?? Promise.resolve();
  }

  if (quitCleanupPromise) {
    return quitCleanupPromise;
  }

  stopSystemStatsLoop();
  stopNavServer();
  emitAppQuitState({
    activeTaskCount: activeTaskRuntimes.size,
    startedAt: new Date().toISOString(),
  });

  quitCleanupPromise = cleanupActiveProcesses()
    .catch(() => undefined)
    .finally(() => {
      isQuittingAfterCleanup = true;
      quitCleanupPromise = null;
      app.quit();
    });

  return quitCleanupPromise;
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    emitUpdateProgress({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    emitUpdateProgress({
      status: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
    });
  });

  autoUpdater.on('update-not-available', () => {
    emitUpdateProgress({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    emitUpdateProgress({
      status: 'downloading',
      progress: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    emitUpdateProgress({
      status: 'downloaded',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
    });
  });

  autoUpdater.on('error', (error) => {
    emitUpdateProgress({
      status: 'error',
      error: error.message,
    });
  });
}

app.whenReady().then(() => {
  app.setName('Front-End Deploy Master');

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.codex.frontenddeploymaster');
  }

  startSystemStatsLoop();
  startNavServer();
  registerIpcHandlers();
  setupAutoUpdater();
  createMainWindow();

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => undefined);
  }, 5000);
});

app.on('before-quit', (event) => {
  if (isQuittingAfterCleanup) {
    return;
  }

  event.preventDefault();
  void requestAppQuitAfterCleanup();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
