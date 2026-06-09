import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  AvailableScriptOption,
  EditorOption,
  EnvFileSummary,
  ProjectConfig,
  PublishProfile,
  ShortcutConfig,
  VueConfigFileSummary,
} from '../../shared/types';
import { EnvEditor } from './EnvEditor';
import { Icon } from './Icon';
import { VueConfigEditor } from './VueConfigEditor';

interface ProjectCardProps {
  project: ProjectConfig;
  onSave: (project: ProjectConfig) => Promise<ProjectConfig>;
  onUpdateVersion: (
    projectId: string,
    mode: 'patch' | 'minor' | 'major' | 'set',
    version?: string,
  ) => Promise<ProjectConfig>;
  onRefresh: (projectId: string) => Promise<void>;
  onRemove: (projectId: string) => Promise<void>;
  onRunShortcut: (projectId: string, shortcutId: string, note?: string) => Promise<void>;
  onPackage: (projectId: string, profileId?: string) => Promise<void>;
  onOpenPath: (targetPath: string) => Promise<void>;
  editorOptions: EditorOption[];
  onOpenInEditor: (projectId: string, editor: EditorOption) => Promise<void>;
  sortMode?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveProject?: (projectId: string, direction: 'up' | 'down') => Promise<void>;
}

const DEFAULT_NAMING_RULE = '{displayName}_{datetime}';
const PROFILE_NAME_PRESETS = ['测试', '预发', '正式'];

function formatRelativeTime(value?: string) {
  if (!value) {
    return '还没有导出记录';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function createEmptyShortcut(): ShortcutConfig {
  return {
    id: crypto.randomUUID(),
    label: '自定义',
    command: '',
  };
}

function createShortcutFromScript(script: AvailableScriptOption): ShortcutConfig {
  return {
    id: crypto.randomUUID(),
    label: script.label || script.name,
    command: script.command,
  };
}

function getProjectDisplayName(project: Pick<ProjectConfig, 'alias' | 'projectName'>) {
  return (project.alias || '').trim() || project.projectName;
}

function buildSuggestedEnvFile(profileName: string) {
  if (profileName === '测试') {
    return '.env.test';
  }

  if (profileName === '预发') {
    return '.env.staging';
  }

  if (profileName === '正式') {
    return '.env.production';
  }

  return '';
}

function createFallbackProfile(project: ProjectConfig): PublishProfile {
  return {
    id: crypto.randomUUID(),
    name: '正式',
    buildCommand: project.buildCommand || '',
    distDir: project.distDir || 'dist',
    releaseDir: project.releaseDir || 'dist-releases',
    envFileName: '',
    namingRule: DEFAULT_NAMING_RULE,
    lastPackagedAt: project.lastPackagedAt,
    lastPackagePath: project.lastPackagePath,
  };
}

function ensurePublishProfiles(project: ProjectConfig) {
  return project.publishProfiles.length > 0 ? project.publishProfiles : [createFallbackProfile(project)];
}

function getActivePublishProfile(project: ProjectConfig, preferredProfileId?: string) {
  const publishProfiles = ensurePublishProfiles(project);
  const targetProfileId = preferredProfileId || project.activeProfileId;

  return publishProfiles.find((profile) => profile.id === targetProfileId) ?? publishProfiles[0];
}

function syncProjectDraft(project: ProjectConfig, preferredProfileId?: string): ProjectConfig {
  const publishProfiles = ensurePublishProfiles(project);
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

function buildNextProfileName(existingProfiles: PublishProfile[]) {
  const usedNames = new Set(existingProfiles.map((profile) => profile.name.trim()));

  for (const preset of PROFILE_NAME_PRESETS) {
    if (!usedNames.has(preset)) {
      return preset;
    }
  }

  let index = existingProfiles.length + 1;

  while (usedNames.has(`方案 ${index}`)) {
    index += 1;
  }

  return `方案 ${index}`;
}

function createPublishProfileFromBase(
  baseProfile: PublishProfile | null,
  existingProfiles: PublishProfile[],
): PublishProfile {
  const name = buildNextProfileName(existingProfiles);

  return {
    id: crypto.randomUUID(),
    name,
    buildCommand: baseProfile?.buildCommand || '',
    distDir: baseProfile?.distDir || 'dist',
    releaseDir: baseProfile?.releaseDir || 'dist-releases',
    envFileName: buildSuggestedEnvFile(name),
    namingRule: baseProfile?.namingRule || '{displayName}_{profile}_{datetime}',
  };
}

export function ProjectCard({
  project,
  editorOptions,
  onSave,
  onUpdateVersion,
  onRefresh,
  onRemove,
  onRunShortcut,
  onPackage,
  onOpenPath,
  onOpenInEditor,
  sortMode = false,
  canMoveUp = false,
  canMoveDown = false,
  onMoveProject,
}: ProjectCardProps) {
  const [draft, setDraft] = useState<ProjectConfig>(() => syncProjectDraft(project));
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isShortcutSectionExpanded, setIsShortcutSectionExpanded] = useState(true);
  const [isProfileEditMode, setIsProfileEditMode] = useState(false);
  const [selectedShortcutSource, setSelectedShortcutSource] = useState('custom');
  const [envFiles, setEnvFiles] = useState<EnvFileSummary[]>([]);
  const [_vueConfigFiles, setVueConfigFiles] = useState<VueConfigFileSummary[]>([]);
  const [isEditorMenuOpen, setIsEditorMenuOpen] = useState(false);
  const [isVersionMenuOpen, setIsVersionMenuOpen] = useState(false);
  const [customVersionDraft, setCustomVersionDraft] = useState(project.version);
  const editorMenuRef = useRef<HTMLDivElement | null>(null);
  const versionMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(syncProjectDraft(project));
  }, [project]);

  useEffect(() => {
    setCustomVersionDraft(project.version);
  }, [project.version]);

  useEffect(() => {
    if (!sortMode) {
      return;
    }

    setIsExpanded(false);
    setIsEditorMenuOpen(false);
    setIsVersionMenuOpen(false);
  }, [sortMode]);

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    let cancelled = false;

    void window.deployMaster
      .listEnvFiles(project.id)
      .then((files) => {
        if (!cancelled) {
          setEnvFiles(files);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnvFiles([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isExpanded, project.id]);

  useEffect(() => {
    if (!isEditorMenuOpen && !isVersionMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!editorMenuRef.current?.contains(event.target as Node)) {
        setIsEditorMenuOpen(false);
      }

      if (!versionMenuRef.current?.contains(event.target as Node)) {
        setIsVersionMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isEditorMenuOpen, isVersionMenuOpen]);

  const updateDraft = (updater: (current: ProjectConfig) => ProjectConfig) => {
    setDraft((current) => {
      const normalizedCurrent = syncProjectDraft(current);
      const nextDraft = updater(normalizedCurrent);
      return syncProjectDraft(nextDraft, nextDraft.activeProfileId);
    });
  };

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(project), [draft, project]);
  const displayName = getProjectDisplayName(draft);
  const savedDisplayName = getProjectDisplayName(project);
  const groupName = draft.groupName.trim();
  const platformLabel = draft.platformLabel.trim();
  const activeProfile = useMemo(() => getActivePublishProfile(draft), [draft]);
  const latestPackagePath = activeProfile?.lastPackagePath || draft.lastPackagePath;
  const latestPackagedAt = activeProfile?.lastPackagedAt || draft.lastPackagedAt;
  const availableEditorOptions = useMemo(
    () =>
      editorOptions
        .map((option) => ({
          ...option,
          label: option.label.trim() || option.command.trim() || '未命名编辑器',
          command: option.command.trim(),
        }))
        .filter((option) => option.label || option.command),
    [editorOptions],
  );
  const shortcutLimitReached = draft.shortcuts.length >= 3;
  const currentShortcutCommands = useMemo(
    () => new Set(draft.shortcuts.map((shortcut) => shortcut.command.trim()).filter(Boolean)),
    [draft.shortcuts],
  );
  const availableShortcutOptions = useMemo(
    () => draft.availableScripts || [],
    [draft.availableScripts],
  );
  const selectedScriptOption =
    selectedShortcutSource === 'custom'
      ? null
      : availableShortcutOptions.find((script) => script.name === selectedShortcutSource) ?? null;
  const isSelectedScriptAlreadyAdded =
    selectedScriptOption !== null && currentShortcutCommands.has(selectedScriptOption.command);
  const shortcutActionTitle =
    selectedShortcutSource === 'custom'
      ? '添加快捷指令'
      : isSelectedScriptAlreadyAdded
        ? '当前脚本已添加'
        : '导入项目脚本';
  const envFileOptions = useMemo(() => {
    return [...envFiles.map((file) => file.fileName)].sort((left, right) => {
      if (left === '.env') {
        return -1;
      }

      if (right === '.env') {
        return 1;
      }

      return left.localeCompare(right);
    });
  }, [envFiles]);

  useEffect(() => {
    if (
      selectedShortcutSource !== 'custom' &&
      !availableShortcutOptions.some((script) => script.name === selectedShortcutSource)
    ) {
      setSelectedShortcutSource('custom');
    }
  }, [availableShortcutOptions, selectedShortcutSource]);

  useEffect(() => {
    if (!activeProfile) {
      return;
    }

    if (envFileOptions.length === 0) {
      if (activeProfile.envFileName) {
        updateActiveProfile('envFileName', '');
      }
      return;
    }

    if (!envFileOptions.includes(activeProfile.envFileName)) {
      updateActiveProfile('envFileName', envFileOptions[0]);
    }
  }, [activeProfile, envFileOptions]);

  const saveDraftIfNeeded = async () => {
    const normalizedDraft = syncProjectDraft(draft);

    if (!isDirty) {
      return normalizedDraft;
    }

    const savedProject = await onSave(normalizedDraft);
    setDraft(savedProject);
    return savedProject;
  };

  const handlePackage = async () => {
    const selectedProfileId = activeProfile?.id;
    setBusyAction('package');

    try {
      const savedProject = await saveDraftIfNeeded();
      await onPackage(savedProject.id, selectedProfileId);
    } catch {
      return;
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenInEditor = async (editor: EditorOption) => {
    setBusyAction('editor');

    try {
      const savedProject = await saveDraftIfNeeded();
      await onOpenInEditor(savedProject.id, editor);
      setIsEditorMenuOpen(false);
    } catch {
      return;
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateVersion = async (
    mode: 'patch' | 'minor' | 'major' | 'set',
    version?: string,
  ) => {
    setBusyAction('version');

    try {
      const updatedProject = await onUpdateVersion(project.id, mode, version);
      setDraft(syncProjectDraft(updatedProject));
      setCustomVersionDraft(updatedProject.version);
      setIsVersionMenuOpen(false);
    } catch {
      return;
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveProject = async () => {
    if (!window.confirm(`确认移除项目 ${savedDisplayName} 吗？`)) {
      return;
    }

    setBusyAction('remove');
    try {
      await onRemove(project.id);
    } finally {
      setBusyAction(null);
    }
  };

  const updateShortcut = (shortcutId: string, field: keyof ShortcutConfig, value: string) => {
    updateDraft((current) => ({
      ...current,
      shortcuts: current.shortcuts.map((shortcut) =>
        shortcut.id === shortcutId
          ? {
              ...shortcut,
              [field]: value,
            }
          : shortcut,
      ),
    }));
  };

  const removeShortcut = (shortcutId: string) => {
    updateDraft((current) => ({
      ...current,
      shortcuts: current.shortcuts.filter((shortcut) => shortcut.id !== shortcutId),
    }));
  };

  const addShortcut = () => {
    updateDraft((current) => ({
      ...current,
      shortcuts: [...current.shortcuts, createEmptyShortcut()].slice(0, 3),
    }));
  };

  const addShortcutFromSelection = () => {
    if (selectedShortcutSource === 'custom') {
      addShortcut();
      return;
    }

    const selectedScript = availableShortcutOptions.find(
      (script) => script.name === selectedShortcutSource,
    );

    if (!selectedScript || currentShortcutCommands.has(selectedScript.command)) {
      return;
    }

    updateDraft((current) => ({
      ...current,
      shortcuts: [...current.shortcuts, createShortcutFromScript(selectedScript)].slice(0, 3),
    }));
    setSelectedShortcutSource('custom');
  };

  const updateActiveProfile = <
    Field extends 'name' | 'buildCommand' | 'distDir' | 'releaseDir' | 'envFileName' | 'namingRule',
  >(
    field: Field,
    value: PublishProfile[Field],
  ) => {
    updateDraft((current) => ({
      ...current,
      publishProfiles: current.publishProfiles.map((profile) =>
        profile.id === current.activeProfileId
          ? {
              ...profile,
              [field]: value,
            }
          : profile,
      ),
    }));
  };

  const addPublishProfile = () => {
    updateDraft((current) => {
      const baseProfile = getActivePublishProfile(current);
      const nextProfile = createPublishProfileFromBase(baseProfile, current.publishProfiles);

      return {
        ...current,
        activeProfileId: nextProfile.id,
        publishProfiles: [...current.publishProfiles, nextProfile],
      };
    });
  };

  const removePublishProfile = (profileId: string) => {
    if (draft.publishProfiles.length <= 1) {
      return;
    }

    updateDraft((current) => {
      const nextProfiles = current.publishProfiles.filter((profile) => profile.id !== profileId);
      const removedIndex = current.publishProfiles.findIndex((profile) => profile.id === profileId);
      const fallbackProfile = nextProfiles[Math.min(removedIndex, nextProfiles.length - 1)];

      return {
        ...current,
        activeProfileId:
          current.activeProfileId === profileId ? fallbackProfile.id : current.activeProfileId,
        publishProfiles: nextProfiles,
      };
    });
  };

  return (
    <article
      className={`surface-panel relative rounded-xl p-3.5 transition ${isEditorMenuOpen ? 'z-20' : 'z-0'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {sortMode ? (
              <span className="badge-neutral flex items-center gap-1 rounded-full px-2 py-1 text-[10px]">
                <Icon name="sorting" className="text-[12px]" />
                排序模式
              </span>
            ) : null}
            <h2 className="text-primary-ui truncate text-base font-semibold tracking-tight">
              {displayName}
            </h2>
            {groupName ? (
              <span
                className="badge-neutral max-w-[180px] truncate rounded-full px-2 py-0.5 text-[10px]"
                title={groupName}
              >
                {groupName}
              </span>
            ) : null}
            {platformLabel ? (
              <span
                className="badge-accent max-w-[120px] truncate rounded-full px-2 py-0.5 text-[10px]"
                title={platformLabel}
              >
                {platformLabel}
              </span>
            ) : null}
            <span className="badge-neutral rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]">
              {project.packageManager}
            </span>
            <div ref={versionMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsVersionMenuOpen((current) => !current)}
                title="快捷修改版本号"
                aria-label="快捷修改版本号"
                className="badge-neutral inline-flex appearance-none items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-normal leading-none [font-variant-numeric:tabular-nums]"
              >
                v{project.version}
              </button>

              <div
                className={`absolute left-0 top-[calc(100%+8px)] z-[90] w-56 rounded-2xl border border-[color:var(--border-strong)] bg-[var(--surface)] p-2 shadow-[var(--shadow-panel)] transition ${
                  isVersionMenuOpen
                    ? 'pointer-events-auto translate-y-0 opacity-100'
                    : 'pointer-events-none -translate-y-1 opacity-0'
                }`}
              >
                <div className="grid grid-cols-3 gap-2">
                  {(['major', 'minor', 'patch'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => void handleUpdateVersion(mode)}
                      disabled={busyAction === 'version'}
                      className="btn-ghost rounded-full px-3 py-2 text-[11px] font-medium capitalize disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 border-t border-[color:var(--border)] pt-2.5">
                  <p className="text-muted-ui text-[11px]">自定义版本</p>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={customVersionDraft}
                      onChange={(event) => setCustomVersionDraft(event.target.value)}
                      className="ui-input min-w-0 flex-1 rounded-xl px-3 py-2 text-xs outline-none"
                      placeholder="1.0.1"
                    />
                    <button
                      type="button"
                      onClick={() => void handleUpdateVersion('set', customVersionDraft)}
                      disabled={busyAction === 'version' || !customVersionDraft.trim()}
                      className="btn-accent inline-flex h-9 w-9 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
                      title="保存版本号"
                      aria-label="保存版本号"
                    >
                      <Icon name="success" className="text-[14px]" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {activeProfile ? (
              <span className="badge-neutral rounded-full px-2 py-0.5 text-[10px]">
                {activeProfile.name}
              </span>
            ) : null}
          </div>
          <p className="text-secondary-ui mt-1 text-xs">{project.projectName}</p>
          <p className="text-muted-ui mt-1 truncate text-xs" title={project.rootPath}>
            {project.rootPath}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {latestPackagePath ? (
            <button
              type="button"
              onClick={() => onOpenPath(latestPackagePath)}
              title="打开最近压缩包"
              aria-label="打开最近压缩包"
              className="btn-ghost inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            >
              <Icon name="download" className="text-[18px]" />
            </button>
          ) : null}
          {!sortMode ? (
            <button
              type="button"
              onClick={() => setIsExpanded((current) => !current)}
              title={isExpanded ? '收起详情' : '展开详情'}
              aria-label={isExpanded ? '收起详情' : '展开详情'}
              className="btn-ghost inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            >
              <Icon name={isExpanded ? 'up' : 'down'} className="text-[18px]" />
            </button>
          ) : null}
          <div ref={editorMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsEditorMenuOpen((current) => !current)}
              title="选择编辑器并打开"
              aria-label="选择编辑器并打开"
              disabled={availableEditorOptions.length === 0}
              className="btn-ghost inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="edit" className="text-[18px]" />
            </button>

            <div
              className={`absolute right-0 top-[calc(100%+6px)] z-[80] w-44 rounded-xl border border-[color:var(--border-strong)] bg-[var(--surface)] p-1 shadow-[var(--shadow-panel)] transition ${
                isEditorMenuOpen
                  ? 'pointer-events-auto translate-y-0 opacity-100'
                  : 'pointer-events-none -translate-y-1 opacity-0'
              }`}
            >
              {availableEditorOptions.length > 0 ? (
                availableEditorOptions.map((editor) => (
                  <button
                    key={editor.id}
                    type="button"
                    onClick={() => void handleOpenInEditor(editor)}
                    disabled={!editor.command || busyAction === 'editor'}
                    className="surface-item-hover flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px] text-secondary-ui transition disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="truncate">{editor.label}</span>
                    <span className="ml-2 shrink-0 text-[10px] text-muted-ui">
                      {editor.command ? '打开' : '未配置'}
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-2.5 py-2 text-[11px] text-muted-ui">请先到全局设置中添加编辑器</div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenPath(project.rootPath)}
            title="打开目录"
            aria-label="打开目录"
            className="btn-ghost inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          >
            <Icon name="folder" className="text-[18px]" />
          </button>
          <button
            type="button"
            onClick={handlePackage}
            className="btn-success rounded-full px-4 py-2 text-xs font-semibold"
          >
            {busyAction === 'package'
              ? '打包中...'
              : activeProfile
                ? `${activeProfile.name} 发布`
                : '打包并导出'}
          </button>
          {sortMode ? (
            <>
              <button
                type="button"
                onClick={() => void onMoveProject?.(project.id, 'up')}
                title="上移项目"
                aria-label={`上移项目 ${savedDisplayName}`}
                disabled={!canMoveUp || busyAction === 'remove'}
                className="btn-ghost inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="up" className="text-[16px]" />
              </button>
              <button
                type="button"
                onClick={() => void onMoveProject?.(project.id, 'down')}
                title="下移项目"
                aria-label={`下移项目 ${savedDisplayName}`}
                disabled={!canMoveDown || busyAction === 'remove'}
                className="btn-ghost inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="down" className="text-[16px]" />
              </button>
            </>
          ) : null}
          {sortMode ? (
            <button
              type="button"
              onClick={() => void handleRemoveProject()}
              title="移除项目"
              aria-label={`移除项目 ${savedDisplayName}`}
              disabled={busyAction === 'remove'}
              className="btn-danger inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon
                name={busyAction === 'remove' ? 'time-task' : 'close'}
                className="text-[16px]"
              />
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-[cubic-bezier(0.2,0.9,0.4,1)] ${
          isExpanded
            ? 'mt-3 grid-rows-[1fr] opacity-100'
            : 'pointer-events-none mt-0 grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-[color:var(--border)] pt-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)]">
              <div className="surface-subpanel min-w-0 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2.5">
                  <div>
                    <p className="text-primary-ui text-xs font-semibold">精简信息</p>
                  </div>
                  <span className="badge-neutral rounded-full px-2 py-0.5 text-[10px]">
                    {draft.shortcuts.length} 个命令
                  </span>
                </div>

                <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                  <div className="surface-item rounded-2xl px-3.5 py-3">
                    <p className="text-faint-ui text-[11px] uppercase tracking-[0.18em]">当前显示名</p>
                    <p className="text-secondary-ui mt-1.5 truncate text-sm" title={displayName}>
                      {displayName}
                    </p>
                  </div>
                  <div className="surface-item rounded-2xl px-3.5 py-3">
                    <p className="text-faint-ui text-[11px] uppercase tracking-[0.18em]">激活方案</p>
                    <p className="text-secondary-ui mt-1.5 truncate text-sm" title={activeProfile?.name}>
                      {activeProfile?.name || '--'}
                    </p>
                  </div>
                  <div className="surface-item rounded-2xl px-3.5 py-3">
                    <p className="text-faint-ui text-[11px] uppercase tracking-[0.18em]">最近导出</p>
                    <p className="text-secondary-ui mt-1.5 text-sm">
                      {formatRelativeTime(latestPackagedAt)}
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-muted-ui text-xs uppercase tracking-[0.18em]">快捷执行</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {draft.shortcuts.length > 0 ? (
                      draft.shortcuts.map((shortcut) => (
                        <button
                          key={shortcut.id}
                          type="button"
                          onClick={() => {
                            onRunShortcut(project.id, shortcut.id);
                          }}
                          className="btn-accent rounded-full px-4 py-2 text-xs font-medium"
                        >
                          {shortcut.label}
                        </button>
                      ))
                    ) : (
                      <span className="text-muted-ui text-sm">暂无快捷命令</span>
                    )}
                  </div>
                </div>

                <div className="surface-subpanel mt-4 rounded-[20px] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-primary-ui text-sm font-medium">快捷指令</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={selectedShortcutSource}
                        onChange={(event) => setSelectedShortcutSource(event.target.value)}
                        disabled={!isShortcutSectionExpanded || shortcutLimitReached}
                        className="ui-input min-w-[170px] rounded-full px-3 py-2 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <option value="custom">自定义命令</option>
                        {availableShortcutOptions.map((script) => (
                          <option key={script.name} value={script.name}>
                            {currentShortcutCommands.has(script.command)
                              ? `${script.name}（已添加）`
                              : script.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={addShortcutFromSelection}
                        title={shortcutActionTitle}
                        aria-label={shortcutActionTitle}
                        disabled={
                          shortcutLimitReached ||
                          !isShortcutSectionExpanded ||
                          (selectedShortcutSource !== 'custom' && isSelectedScriptAlreadyAdded)
                        }
                        className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Icon
                          name={isSelectedScriptAlreadyAdded ? 'success' : 'add'}
                          className="text-[16px]"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsShortcutSectionExpanded((current) => !current)}
                        title={isShortcutSectionExpanded ? '收起快捷指令' : '展开快捷指令'}
                        aria-label={isShortcutSectionExpanded ? '收起快捷指令' : '展开快捷指令'}
                        className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
                      >
                        <Icon
                          name={isShortcutSectionExpanded ? 'up' : 'down'}
                          className="text-[16px]"
                        />
                      </button>
                    </div>
                  </div>

                  <div
                    className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${
                      isShortcutSectionExpanded
                        ? 'mt-3 grid-rows-[1fr] opacity-100'
                        : 'pointer-events-none mt-0 grid-rows-[0fr] opacity-0'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="space-y-2.5">
                        {draft.shortcuts.map((shortcut) => (
                          <div
                            key={shortcut.id}
                            className="surface-item grid min-w-0 gap-2.5 rounded-2xl p-3 lg:grid-cols-[120px_minmax(0,1fr)_auto]"
                          >
                            <input
                              value={shortcut.label}
                              onChange={(event) =>
                                updateShortcut(shortcut.id, 'label', event.target.value)
                              }
                              className="ui-input min-w-0 rounded-xl px-3.5 py-2.5 text-xs outline-none"
                              placeholder="按钮名称"
                            />
                            <input
                              value={shortcut.command}
                              onChange={(event) =>
                                updateShortcut(shortcut.id, 'command', event.target.value)
                              }
                              className="ui-input min-w-0 rounded-xl px-3.5 py-2.5 text-xs outline-none"
                              placeholder="pnpm dev"
                            />
                            <button
                              type="button"
                              onClick={() => removeShortcut(shortcut.id)}
                              title="删除快捷指令"
                              aria-label={`删除快捷指令 ${shortcut.label}`}
                              className="btn-ghost inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl"
                            >
                              <Icon name="close" className="text-[16px]" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

                <div className="surface-subpanel rounded-xl p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-primary-ui text-xs font-semibold">发布方案</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsProfileEditMode((current) => !current)}
                        title={isProfileEditMode ? '完成编辑方案' : '编辑发布方案'}
                        aria-label={isProfileEditMode ? '完成编辑方案' : '编辑发布方案'}
                        className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
                      >
                        <Icon
                          name={isProfileEditMode ? 'success' : 'edit'}
                          className="text-[16px]"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={addPublishProfile}
                        title="添加方案"
                        aria-label="添加方案"
                        className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
                      >
                        <Icon name="add" className="text-[16px]" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {draft.publishProfiles.map((profile) => (
                      <div key={profile.id} className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateDraft((current) => ({
                              ...current,
                              activeProfileId: profile.id,
                            }))
                          }
                          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                            profile.id === activeProfile?.id
                              ? 'btn-accent'
                              : 'badge-neutral hover:border-[color:var(--accent-border)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {profile.name}
                        </button>
                        {isProfileEditMode ? (
                          <button
                            type="button"
                            onClick={() => removePublishProfile(profile.id)}
                            title={`删除方案 ${profile.name}`}
                            aria-label={`删除方案 ${profile.name}`}
                            disabled={draft.publishProfiles.length <= 1}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-300/70 text-rose-400 transition hover:border-rose-400 hover:bg-rose-500/8 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-400/35 dark:text-rose-300/80 dark:hover:border-rose-300/60 dark:hover:bg-rose-400/10 dark:hover:text-rose-200"
                          >
                            <Icon name="close" className="text-[13px]" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-muted-ui text-xs uppercase tracking-[0.2em]">项目别名</span>
                    <input
                      value={draft.alias}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          alias: event.target.value,
                        }))
                      }
                      className="ui-input w-full rounded-xl px-3.5 py-2.5 text-xs outline-none"
                      placeholder="留空则使用 package.json 中的项目名"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-muted-ui text-xs uppercase tracking-[0.2em]">项目分组</span>
                    <input
                      value={draft.groupName}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          groupName: event.target.value,
                        }))
                      }
                      className="ui-input w-full rounded-xl px-3.5 py-2.5 text-xs outline-none"
                      placeholder="例如：安亭养老"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-muted-ui text-xs uppercase tracking-[0.2em]">端类型</span>
                    <input
                      value={draft.platformLabel}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          platformLabel: event.target.value,
                        }))
                      }
                      className="ui-input w-full rounded-xl px-3.5 py-2.5 text-xs outline-none"
                      placeholder="例如：PC端 / 手机端 / Admin"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-muted-ui text-xs uppercase tracking-[0.2em]">方案名称</span>
                    <input
                      value={activeProfile?.name || ''}
                      onChange={(event) => updateActiveProfile('name', event.target.value)}
                      className="ui-input w-full rounded-xl px-3.5 py-2.5 text-xs outline-none"
                      placeholder="例如：测试 / 预发 / 正式"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-muted-ui text-xs uppercase tracking-[0.2em]">Build 命令</span>
                    <input
                      value={activeProfile?.buildCommand || ''}
                      onChange={(event) => updateActiveProfile('buildCommand', event.target.value)}
                      className="ui-input w-full rounded-xl px-3.5 py-2.5 text-xs outline-none"
                      placeholder="pnpm build"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-muted-ui text-xs uppercase tracking-[0.2em]">环境文件</span>
                    <select
                      value={activeProfile?.envFileName || ''}
                      onChange={(event) => updateActiveProfile('envFileName', event.target.value)}
                      disabled={envFileOptions.length === 0}
                      className="ui-input w-full rounded-xl px-3.5 py-2.5 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {envFileOptions.length > 0 ? (
                        envFileOptions.map((fileName) => (
                          <option key={fileName} value={fileName}>
                            {fileName}
                          </option>
                        ))
                      ) : (
                        <option value="">未发现 .env 文件</option>
                      )}
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-muted-ui text-xs uppercase tracking-[0.2em]">产物目录</span>
                    <input
                      value={activeProfile?.distDir || ''}
                      onChange={(event) => updateActiveProfile('distDir', event.target.value)}
                      className="ui-input w-full rounded-xl px-3.5 py-2.5 text-xs outline-none"
                      placeholder="dist"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-muted-ui text-xs uppercase tracking-[0.2em]">导出目录</span>
                    <input
                      value={activeProfile?.releaseDir || ''}
                      onChange={(event) => updateActiveProfile('releaseDir', event.target.value)}
                      className="ui-input w-full rounded-xl px-3.5 py-2.5 text-xs outline-none"
                      placeholder="dist-releases"
                    />
                  </label>

                </div>
              </div>
            </div>

            <EnvEditor
              projectId={project.id}
              isOpen={isExpanded}
              preferredFileName={activeProfile?.envFileName || null}
              onFilesChange={setEnvFiles}
            />

            <VueConfigEditor
              projectId={project.id}
              isOpen={isExpanded}
              onFilesChange={setVueConfigFiles}
            />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-muted-ui min-w-0 space-y-1 text-xs">
                <p className="truncate" title={`当前项目路径: ${project.rootPath}`}>
                  当前项目路径: {project.rootPath}
                </p>
                {activeProfile ? (
                  <p
                    className="truncate"
                    title={`当前方案目录: ${activeProfile.distDir} -> ${activeProfile.releaseDir}`}
                  >
                    当前方案目录: {activeProfile.distDir} -&gt; {activeProfile.releaseDir}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setBusyAction('refresh');
                    try {
                      await onRefresh(project.id);
                    } finally {
                      setBusyAction(null);
                    }
                  }}
                  className="btn-ghost rounded-full px-4 py-3 text-sm font-medium"
                >
                  {busyAction === 'refresh' ? '刷新中...' : '刷新信息'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setBusyAction('save');
                    try {
                      await saveDraftIfNeeded();
                    } catch {
                      return;
                    } finally {
                      setBusyAction(null);
                    }
                  }}
                  disabled={!isDirty}
                  className="btn-ghost rounded-full px-4 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === 'save' ? '保存中...' : '保存配置'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
