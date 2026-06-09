export type PackageManager = 'pnpm' | 'npm' | 'yarn';

export type TaskKind = 'shortcut' | 'package';

export type TaskStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface ShortcutConfig {
  id: string;
  label: string;
  command: string;
}

export interface AvailableScriptOption {
  name: string;
  label: string;
  command: string;
}

export interface EditorOption {
  id: string;
  label: string;
  command: string;
}

export interface PublishProfile {
  id: string;
  name: string;
  buildCommand: string;
  distDir: string;
  releaseDir: string;
  envFileName: string;
  namingRule: string;
  lastPackagedAt?: string;
  lastPackagePath?: string;
}

export interface ProjectConfig {
  id: string;
  rootPath: string;
  projectName: string;
  alias: string;
  groupName: string;
  platformLabel: string;
  version: string;
  packageManager: PackageManager;
  editorId: string;
  editorCommand: string;
  activeProfileId: string;
  distDir: string;
  releaseDir: string;
  buildCommand: string;
  publishProfiles: PublishProfile[];
  availableScripts: AvailableScriptOption[];
  shortcuts: ShortcutConfig[];
  updatedAt: string;
  lastPackagedAt?: string;
  lastPackagePath?: string;
}

export interface EnvFileSummary {
  fileName: string;
  size: number;
  updatedAt: string;
}

export interface EnvFileContent {
  fileName: string;
  content: string;
}

export interface VueConfigFileSummary {
  fileName: string;
  size: number;
  updatedAt: string;
}

export interface VueConfigFileContent {
  fileName: string;
  content: string;
}

export interface SystemStatsSnapshot {
  cpuUsage: number | null;
  memoryUsed: number;
  memoryTotal: number;
  memoryUsage: number;
  timestamp: string;
}

export interface AppQuitStateEvent {
  activeTaskCount: number;
  startedAt: string;
}

export interface TaskStateEvent {
  id: string;
  projectId: string;
  projectName: string;
  profileName?: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  command?: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  errorMessage?: string;
  outputPath?: string;
}

export interface TaskLogEvent {
  taskId: string;
  chunk: string;
  stream: 'stdout' | 'stderr' | 'system';
  timestamp: string;
}

export interface TaskPortInfo {
  taskId: string;
  projectId: string;
  projectName: string;
  groupName: string;
  title: string;
  command: string;
  note: string;
  port: number;
  url: string;
}

export interface RunTaskResult {
  taskId: string;
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateProgressEvent {
  status: UpdateStatus;
  progress?: number;
  version?: string;
  releaseNotes?: string;
  error?: string;
}

export interface ConfigExportResult {
  filePath: string;
  projectCount: number;
}

export interface ConfigImportResult {
  filePath: string;
  importedCount: number;
  skippedCount: number;
  totalCount: number;
  projects: ProjectConfig[];
}

export interface DeployMasterApi {
  listProjects: () => Promise<ProjectConfig[]>;
  addProject: () => Promise<ProjectConfig | null>;
  updateProject: (project: ProjectConfig) => Promise<ProjectConfig>;
  updateProjectVersion: (
    projectId: string,
    mode: 'patch' | 'minor' | 'major' | 'set',
    version?: string,
  ) => Promise<ProjectConfig>;
  refreshProject: (projectId: string) => Promise<ProjectConfig>;
  removeProject: (projectId: string) => Promise<void>;
  reorderProjects: (projectIds: string[]) => Promise<ProjectConfig[]>;
  exportConfigFile: () => Promise<ConfigExportResult | null>;
  importConfigFile: () => Promise<ConfigImportResult | null>;
  listEnvFiles: (projectId: string) => Promise<EnvFileSummary[]>;
  readEnvFile: (projectId: string, fileName: string) => Promise<EnvFileContent>;
  saveEnvFile: (projectId: string, fileName: string, content: string) => Promise<EnvFileSummary>;
  deleteEnvFile: (projectId: string, fileName: string) => Promise<void>;
  listVueConfigFiles: (projectId: string) => Promise<VueConfigFileSummary[]>;
  readVueConfigFile: (projectId: string, fileName: string) => Promise<VueConfigFileContent>;
  saveVueConfigFile: (projectId: string, fileName: string, content: string) => Promise<VueConfigFileSummary>;
  deleteVueConfigFile: (projectId: string, fileName: string) => Promise<void>;
  getSystemStats: () => Promise<SystemStatsSnapshot>;
  getAppVersion: () => Promise<string>;
  runShortcut: (projectId: string, shortcutId: string, note?: string) => Promise<RunTaskResult>;
  packageProject: (projectId: string, profileId?: string, namingRule?: string) => Promise<RunTaskResult>;
  stopTask: (taskId: string) => Promise<void>;
  openPath: (targetPath: string) => Promise<void>;
  openInEditor: (projectId: string, editorCommand: string, editorLabel?: string) => Promise<void>;
  onAppQuitState: (listener: (event: AppQuitStateEvent) => void) => () => void;
  onSystemStats: (listener: (event: SystemStatsSnapshot) => void) => () => void;
  onTaskUpdate: (listener: (event: TaskStateEvent) => void) => () => void;
  onTaskLog: (listener: (event: TaskLogEvent) => void) => () => void;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  onUpdateProgress: (listener: (event: UpdateProgressEvent) => void) => () => void;
}
