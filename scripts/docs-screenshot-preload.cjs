const { contextBridge } = require('electron');

const sampleProjects = [
  {
    id: 'project-admin',
    rootPath: 'D:\\项目库\\示例项目\\数字居委后台管理端ADMIN',
    projectName: '数字居委后台管理端ADMIN',
    alias: 'ADMIN',
    version: '2.8.4',
    packageManager: 'pnpm',
    distDir: 'dist',
    releaseDir: 'dist-releases',
    buildCommand: 'pnpm build:prod',
    availableScripts: [
      { name: 'dev', label: '开发', command: 'pnpm dev' },
      { name: 'build', label: '构建', command: 'pnpm build' },
      { name: 'build:prod', label: 'build:prod', command: 'pnpm build:prod' },
      { name: 'preview', label: '预览', command: 'pnpm preview' },
    ],
    shortcuts: [
      { id: 'shortcut-admin-dev', label: '开发', command: 'pnpm dev' },
      { id: 'shortcut-admin-build', label: '构建', command: 'pnpm build' },
      { id: 'shortcut-admin-prod', label: '生产', command: 'pnpm build:prod' },
    ],
    updatedAt: '2026-04-07T13:08:00.000Z',
    lastPackagedAt: '2026-04-07T13:30:45.000Z',
    lastPackagePath:
      'D:\\项目库\\示例项目\\数字居委后台管理端ADMIN\\dist-releases\\ADMIN_2026年04月07日_21时30分45秒.zip',
  },
  {
    id: 'project-master',
    rootPath: 'D:\\项目库\\工具集\\quickPackTool',
    projectName: 'front-end-deploy-master',
    alias: 'EASY-BUILD',
    version: '1.0.0',
    packageManager: 'npm',
    distDir: 'dist',
    releaseDir: 'dist-releases',
    buildCommand: 'npm run build',
    availableScripts: [
      { name: 'dev', label: '开发', command: 'npm run dev' },
      { name: 'build', label: '构建', command: 'npm run build' },
      { name: 'dist:win', label: 'dist:win', command: 'npm run dist:win' },
    ],
    shortcuts: [
      { id: 'shortcut-master-dev', label: '开发', command: 'npm run dev' },
      { id: 'shortcut-master-build', label: '构建', command: 'npm run build' },
    ],
    updatedAt: '2026-04-07T12:18:00.000Z',
    lastPackagedAt: '2026-04-06T08:12:11.000Z',
    lastPackagePath:
      'D:\\项目库\\工具集\\quickPackTool\\dist-releases\\EASY-BUILD_2026年04月06日_16时12分11秒.zip',
  },
  {
    id: 'project-care',
    rootPath: 'D:\\项目库\\养老项目\\care-dashboard',
    projectName: '养老大屏展示端',
    alias: '',
    version: '0.9.7',
    packageManager: 'yarn',
    distDir: 'dist',
    releaseDir: 'dist-releases',
    buildCommand: 'yarn build',
    availableScripts: [
      { name: 'dev', label: '开发', command: 'yarn dev' },
      { name: 'build', label: '构建', command: 'yarn build' },
      { name: 'preview', label: '预览', command: 'yarn preview' },
    ],
    shortcuts: [
      { id: 'shortcut-care-dev', label: '开发', command: 'yarn dev' },
      { id: 'shortcut-care-build', label: '构建', command: 'yarn build' },
    ],
    updatedAt: '2026-04-07T09:12:00.000Z',
  },
];

const envStore = {
  'project-admin': {
    '.env': '# 基础配置\nVITE_API_BASE=https://api.demo.local\nVITE_APP_NAME=ADMIN\n',
    '.env.production':
      '# 生产环境\nVITE_API_BASE=https://api.prod.example.com\nVITE_ENABLE_MOCK=false\n',
    '.env.staging':
      '# 预发布环境\nVITE_API_BASE=https://api.staging.example.com\nVITE_ENABLE_MOCK=false\n',
  },
  'project-master': {
    '.env': '# 工具配置\nVITE_ENABLE_TELEMETRY=false\nVITE_BRAND_NAME=Easy Build Master\n',
  },
  'project-care': {
    '.env': '# 大屏接口\nVITE_SCREEN_API=https://screen.example.com\n',
  },
};

const sampleTaskUpdates = [
  {
    id: 'task-running-dev',
    projectId: 'project-care',
    projectName: '养老大屏展示端',
    title: '养老大屏展示端 · 开发',
    kind: 'shortcut',
    status: 'running',
    command: 'yarn dev',
    startedAt: '2026-04-07T13:32:11.000Z',
  },
  {
    id: 'task-package-success',
    projectId: 'project-admin',
    projectName: 'ADMIN',
    title: 'ADMIN · 打包并导出',
    kind: 'package',
    status: 'success',
    command: 'pnpm build:prod',
    startedAt: '2026-04-07T13:28:02.000Z',
    endedAt: '2026-04-07T13:30:45.000Z',
    exitCode: 0,
    outputPath:
      'D:\\项目库\\示例项目\\数字居委后台管理端ADMIN\\dist-releases\\ADMIN_2026年04月07日_21时30分45秒.zip',
  },
];

const sampleTaskLogs = [
  {
    taskId: 'task-running-dev',
    chunk: '正在启动开发服务...\n',
    stream: 'system',
    timestamp: '2026-04-07T13:32:11.000Z',
  },
  {
    taskId: 'task-running-dev',
    chunk: 'Local: http://127.0.0.1:5173/\n',
    stream: 'stdout',
    timestamp: '2026-04-07T13:32:13.000Z',
  },
  {
    taskId: 'task-package-success',
    chunk: '执行命令: pnpm build:prod\n',
    stream: 'system',
    timestamp: '2026-04-07T13:28:02.000Z',
  },
  {
    taskId: 'task-package-success',
    chunk: 'vite v8.0.5 building for production...\n',
    stream: 'stdout',
    timestamp: '2026-04-07T13:28:05.000Z',
  },
  {
    taskId: 'task-package-success',
    chunk: '等待构建产物目录: D:\\项目库\\示例项目\\数字居委后台管理端ADMIN\\dist\n',
    stream: 'system',
    timestamp: '2026-04-07T13:30:10.000Z',
  },
  {
    taskId: 'task-package-success',
    chunk: '压缩完成，共 4281981 字节\n',
    stream: 'system',
    timestamp: '2026-04-07T13:30:45.000Z',
  },
];

const systemStats = {
  cpuUsage: 38.2,
  memoryUsed: 10.8 * 1024 * 1024 * 1024,
  memoryTotal: 32 * 1024 * 1024 * 1024,
  memoryUsage: 34.1,
  timestamp: '2026-04-07T13:30:45.000Z',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getEnvSummaries(projectId) {
  const envFiles = envStore[projectId] || {};

  return Object.keys(envFiles).map((fileName, index) => ({
    fileName,
    size: Buffer.byteLength(envFiles[fileName] || '', 'utf8'),
    updatedAt: new Date(Date.UTC(2026, 3, 7, 10, 15 + index, 10)).toISOString(),
  }));
}

contextBridge.exposeInMainWorld('deployMaster', {
  listProjects: async () => clone(sampleProjects),
  addProject: async () => null,
  updateProject: async (project) => clone(project),
  refreshProject: async (projectId) =>
    clone(sampleProjects.find((project) => project.id === projectId) || sampleProjects[0]),
  removeProject: async () => undefined,
  reorderProjects: async (projectIds) => {
    const projectMap = new Map(sampleProjects.map((project) => [project.id, project]));
    return projectIds.map((projectId) => clone(projectMap.get(projectId))).filter(Boolean);
  },
  listEnvFiles: async (projectId) => clone(getEnvSummaries(projectId)),
  readEnvFile: async (projectId, fileName) => ({
    fileName,
    content: envStore[projectId]?.[fileName] || '',
  }),
  saveEnvFile: async (projectId, fileName, content) => {
    if (!envStore[projectId]) {
      envStore[projectId] = {};
    }

    envStore[projectId][fileName] = content;
    return {
      fileName,
      size: Buffer.byteLength(content || '', 'utf8'),
      updatedAt: new Date().toISOString(),
    };
  },
  getSystemStats: async () => clone(systemStats),
  runShortcut: async () => ({ taskId: 'task-running-dev' }),
  packageProject: async () => ({ taskId: 'task-package-success' }),
  stopTask: async () => undefined,
  openPath: async () => undefined,
  onSystemStats: (listener) => {
    const timer = setTimeout(() => listener(clone(systemStats)), 40);
    return () => clearTimeout(timer);
  },
  onTaskUpdate: (listener) => {
    const timers = sampleTaskUpdates.map((task, index) =>
      setTimeout(() => listener(clone(task)), 60 + index * 140),
    );

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  },
  onTaskLog: (listener) => {
    const timers = sampleTaskLogs.map((log, index) =>
      setTimeout(() => listener(clone(log)), 80 + index * 90),
    );

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  },
});
