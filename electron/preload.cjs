const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deployMaster', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: () => ipcRenderer.invoke('projects:add'),
  updateProject: (project) => ipcRenderer.invoke('projects:update', project),
  updateProjectVersion: (projectId, mode, version) =>
    ipcRenderer.invoke('projects:update-version', { projectId, mode, version }),
  refreshProject: (projectId) => ipcRenderer.invoke('projects:refresh', projectId),
  removeProject: (projectId) => ipcRenderer.invoke('projects:remove', projectId),
  reorderProjects: (projectIds) => ipcRenderer.invoke('projects:reorder', projectIds),
  exportConfigFile: () => ipcRenderer.invoke('config:export'),
  importConfigFile: () => ipcRenderer.invoke('config:import'),
  listEnvFiles: (projectId) => ipcRenderer.invoke('env:list', projectId),
  readEnvFile: (projectId, fileName) => ipcRenderer.invoke('env:read', { projectId, fileName }),
  saveEnvFile: (projectId, fileName, content) =>
    ipcRenderer.invoke('env:save', { projectId, fileName, content }),
  deleteEnvFile: (projectId, fileName) => ipcRenderer.invoke('env:delete', { projectId, fileName }),
  listVueConfigFiles: (projectId) => ipcRenderer.invoke('vue-config:list', projectId),
  readVueConfigFile: (projectId, fileName) => ipcRenderer.invoke('vue-config:read', { projectId, fileName }),
  saveVueConfigFile: (projectId, fileName, content) =>
    ipcRenderer.invoke('vue-config:save', { projectId, fileName, content }),
  deleteVueConfigFile: (projectId, fileName) => ipcRenderer.invoke('vue-config:delete', { projectId, fileName }),
  getSystemStats: () => ipcRenderer.invoke('system:stats:get'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  runShortcut: (projectId, shortcutId, note) =>
    ipcRenderer.invoke('tasks:run-shortcut', { projectId, shortcutId, note }),
  packageProject: (projectId, profileId, namingRule) =>
    ipcRenderer.invoke('tasks:package', { projectId, profileId, namingRule }),
  stopTask: (taskId) => ipcRenderer.invoke('tasks:stop', taskId),
  openPath: (targetPath) => ipcRenderer.invoke('shell:open-path', targetPath),
  openInEditor: (projectId, editorCommand, editorLabel) =>
    ipcRenderer.invoke('shell:open-in-editor', { projectId, editorCommand, editorLabel }),
  onAppQuitState: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('app:quit-state', handler);
    return () => ipcRenderer.removeListener('app:quit-state', handler);
  },
  onSystemStats: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('system:stats', handler);
    return () => ipcRenderer.removeListener('system:stats', handler);
  },
  onTaskUpdate: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('task:update', handler);
    return () => ipcRenderer.removeListener('task:update', handler);
  },
  onTaskLog: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('task:log', handler);
    return () => ipcRenderer.removeListener('task:log', handler);
  },
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
});
