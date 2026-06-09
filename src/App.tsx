import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ProjectCard } from './components/ProjectCard';
import { Icon } from './components/Icon';
import { TaskConsole, type TaskView } from './components/TaskConsole';
import { ToastRegion } from './components/ToastRegion';
import type {
  AppQuitStateEvent,
  ConfigImportResult,
  EditorOption,
  ProjectConfig,
  SystemStatsSnapshot,
  TaskLogEvent,
  TaskStateEvent,
  UpdateProgressEvent,
} from '../shared/types';

type ThemePreference = 'system' | 'light' | 'dark';

interface ToastItem {
  id: string;
  title: string;
  tone: 'success' | 'error' | 'info';
}

const THEME_STORAGE_KEY = 'front-end-deploy-master-theme';
const EDITOR_OPTIONS_STORAGE_KEY = 'front-end-deploy-master-editor-options';
const GLOBAL_NAMING_RULE_STORAGE_KEY = 'front-end-deploy-master-global-naming-rule';
const DEFAULT_GLOBAL_NAMING_RULE = '{displayName}_{profile}_{datetime}';
const ALIASES_STORAGE_KEY = 'front-end-deploy-master-shortcut-aliases';

function getInitialThemePreference(): ThemePreference {
  const savedValue = localStorage.getItem(THEME_STORAGE_KEY);

  if (savedValue === 'light' || savedValue === 'dark' || savedValue === 'system') {
    return savedValue;
  }

  return 'system';
}

function resolveTheme(preference: ThemePreference) {
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return preference;
}

function createEditorOption(label = '', command = ''): EditorOption {
  return {
    id: crypto.randomUUID(),
    label,
    command,
  };
}

function getDefaultEditorOptions(): EditorOption[] {
  return [
    createEditorOption('VS Code', 'code'),
    createEditorOption('Antigravity', 'antigravity'),
    createEditorOption('Trae', 'trae'),
  ];
}

function normalizeEditorOptions(value: unknown): EditorOption[] {
  if (!Array.isArray(value)) {
    return getDefaultEditorOptions();
  }

  const normalizedOptions = value
    .map((item) => {
      const editorOption = item as Partial<EditorOption>;
      const label = typeof editorOption.label === 'string' ? editorOption.label.trim() : '';
      const command = typeof editorOption.command === 'string' ? editorOption.command.trim() : '';

      if (!label && !command) {
        return null;
      }

      return {
        id:
          typeof editorOption.id === 'string' && editorOption.id.trim()
            ? editorOption.id.trim()
            : crypto.randomUUID(),
        label: label || '未命名编辑器',
        command,
      };
    })
    .filter((item): item is EditorOption => item !== null);

  return normalizedOptions.length > 0 ? normalizedOptions : getDefaultEditorOptions();
}

function getInitialEditorOptions() {
  try {
    const savedValue = localStorage.getItem(EDITOR_OPTIONS_STORAGE_KEY);

    if (!savedValue) {
      return getDefaultEditorOptions();
    }

    return normalizeEditorOptions(JSON.parse(savedValue));
  } catch {
    return getDefaultEditorOptions();
  }
}

function getInitialGlobalNamingRule() {
  const savedValue = localStorage.getItem(GLOBAL_NAMING_RULE_STORAGE_KEY);

  if (typeof savedValue === 'string' && savedValue.trim()) {
    return savedValue.trim();
  }

  return DEFAULT_GLOBAL_NAMING_RULE;
}

function getInitialShortcutAliases(): string[] {
  try {
    const savedValue = localStorage.getItem(ALIASES_STORAGE_KEY);

    if (!savedValue) {
      return [];
    }

    const parsed = JSON.parse(savedValue);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误';
}

function getProjectDisplayName(project: ProjectConfig) {
  return (project.alias || '').trim() || project.projectName;
}

function getProjectGroupLabel(project: Pick<ProjectConfig, 'groupName'>) {
  return (project.groupName || '').trim() || '未分组';
}

function getProjectGroupKey(project: Pick<ProjectConfig, 'groupName'>) {
  return (project.groupName || '').trim() || '__ungrouped__';
}

function getProjectPlatformLabel(project: Pick<ProjectConfig, 'platformLabel'>) {
  return (project.platformLabel || '').trim();
}

function getProjectMonogram(project: ProjectConfig) {
  const displayName = getProjectDisplayName(project).replace(/\s+/g, '');
  return (displayName.slice(0, 2) || 'FE').toUpperCase();
}

function getProjectCompactSubtitle(project: ProjectConfig) {
  const subtitleParts: string[] = [];
  const groupLabel = getProjectGroupLabel(project);
  const platformLabel = getProjectPlatformLabel(project);

  if (groupLabel !== '未分组') {
    subtitleParts.push(groupLabel);
  }

  if (platformLabel) {
    subtitleParts.push(platformLabel);
  }

  if (project.projectName !== getProjectDisplayName(project)) {
    subtitleParts.push(project.projectName);
  } else {
    const segments = project.rootPath.split(/[\\/]/).filter(Boolean);
    subtitleParts.push(segments.at(-1) ?? project.projectName);
  }

  return subtitleParts.join(' / ');
}

function formatUsagePercent(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '--';
  }

  return `${Math.round(value)}%`;
}

function formatMemorySize(bytes: number | null | undefined) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return '--';
  }

  const gigaBytes = bytes / 1024 / 1024 / 1024;
  return `${gigaBytes >= 10 ? gigaBytes.toFixed(0) : gigaBytes.toFixed(1)} GB`;
}

function hasProjectOrderChanged(previousProjects: ProjectConfig[], nextProjects: ProjectConfig[]) {
  if (previousProjects.length !== nextProjects.length) {
    return true;
  }

  return previousProjects.some((project, index) => project.id !== nextProjects[index]?.id);
}

function groupProjects(projects: ProjectConfig[]) {
  const groupedProjects = new Map<
    string,
    {
      key: string;
      label: string;
      projects: ProjectConfig[];
    }
  >();

  projects.forEach((project) => {
    const key = getProjectGroupKey(project);
    const existingGroup = groupedProjects.get(key);

    if (existingGroup) {
      existingGroup.projects.push(project);
      return;
    }

    groupedProjects.set(key, {
      key,
      label: getProjectGroupLabel(project),
      projects: [project],
    });
  });

  return [...groupedProjects.values()];
}

function reorderEditorOptionList(
  options: EditorOption[],
  draggedEditorId: string,
  targetEditorId: string,
) {
  if (draggedEditorId === targetEditorId) {
    return options;
  }

  const nextOptions = [...options];
  const draggedIndex = nextOptions.findIndex((option) => option.id === draggedEditorId);
  const targetIndex = nextOptions.findIndex((option) => option.id === targetEditorId);

  if (draggedIndex < 0 || targetIndex < 0) {
    return options;
  }

  const [draggedOption] = nextOptions.splice(draggedIndex, 1);
  nextOptions.splice(targetIndex, 0, draggedOption);
  return nextOptions;
}

export default function App() {
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [tasks, setTasks] = useState<Record<string, TaskView>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStatsSnapshot | null>(null);
  const [appQuitState, setAppQuitState] = useState<AppQuitStateEvent | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(getInitialThemePreference);
  const [addingProject, setAddingProject] = useState(false);
  const [configAction, setConfigAction] = useState<'import' | 'export' | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConfigSectionExpanded, setIsConfigSectionExpanded] = useState(false);
  const [isEditorSectionExpanded, setIsEditorSectionExpanded] = useState(false);
  const [editorOptions, setEditorOptions] = useState<EditorOption[]>(getInitialEditorOptions);
  const [globalNamingRule, setGlobalNamingRule] = useState(getInitialGlobalNamingRule);
  const [aliasModalInfo, setAliasModalInfo] = useState<{
    projectId: string;
    shortcutId: string;
    shortcutLabel: string;
    projectDisplayName: string;
  } | null>(null);
  const [aliasInput, setAliasInput] = useState('');
  const [shortcutAliases, setShortcutAliases] = useState<string[]>(getInitialShortcutAliases);
  const [isAliasDropdownOpen, setIsAliasDropdownOpen] = useState(false);
  const aliasDropdownRef = useRef<HTMLDivElement | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgressEvent | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [sortMode, setSortMode] = useState(false);
  const [isProjectListVisible, setIsProjectListVisible] = useState(true);
  const [draggingEditorId, setDraggingEditorId] = useState<string | null>(null);
  const [editorDropTargetId, setEditorDropTargetId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<string[]>([]);
  const groupedProjects = useMemo(() => groupProjects(projects), [projects]);
  const projectItemRefs = useRef(new Map<string, HTMLDivElement>());
  const previousProjectRectsRef = useRef(new Map<string, DOMRect>());
  const groupSectionRefs = useRef(new Map<string, HTMLElement>());
  const previousGroupRectsRef = useRef(new Map<string, DOMRect>());
  const pendingProjectAnimationIdsRef = useRef<Set<string> | null>(null);
  const pendingGroupAnimationKeysRef = useRef<Set<string> | null>(null);

  const pushToast = (title: string, tone: ToastItem['tone']) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, title, tone }]);

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2600);
  };

  const loadProjects = async () => {
    const projectList = await window.deployMaster.listProjects();
    setProjects(projectList);
  };

  const moveProjectWithinGroup = (
    projectList: ProjectConfig[],
    projectId: string,
    direction: 'up' | 'down',
  ) => {
    const groupedProjectList = groupProjects(projectList).map((group) => ({
      ...group,
      projects: [...group.projects],
    }));
    const groupIndex = groupedProjectList.findIndex((group) =>
      group.projects.some((project) => project.id === projectId),
    );

    if (groupIndex < 0) {
      return {
        nextProjects: projectList,
        affectedProjectIds: [] as string[],
      };
    }

    const projectIndex = groupedProjectList[groupIndex].projects.findIndex(
      (project) => project.id === projectId,
    );
    const targetProjectIndex = direction === 'up' ? projectIndex - 1 : projectIndex + 1;

    if (
      projectIndex < 0 ||
      targetProjectIndex < 0 ||
      targetProjectIndex >= groupedProjectList[groupIndex].projects.length
    ) {
      return {
        nextProjects: projectList,
        affectedProjectIds: [] as string[],
      };
    }

    const targetProject = groupedProjectList[groupIndex].projects[targetProjectIndex];
    const [movedProject] = groupedProjectList[groupIndex].projects.splice(projectIndex, 1);
    groupedProjectList[groupIndex].projects.splice(targetProjectIndex, 0, movedProject);

    return {
      nextProjects: groupedProjectList.flatMap((group) => group.projects),
      affectedProjectIds: [projectId, targetProject.id],
    };
  };

  const moveGroupBlock = (
    projectList: ProjectConfig[],
    groupKey: string,
    direction: 'up' | 'down',
  ) => {
    const groupedProjectList = groupProjects(projectList).map((group) => ({
      ...group,
      projects: [...group.projects],
    }));
    const groupIndex = groupedProjectList.findIndex((group) => group.key === groupKey);
    const targetGroupIndex = direction === 'up' ? groupIndex - 1 : groupIndex + 1;

    if (
      groupIndex < 0 ||
      targetGroupIndex < 0 ||
      targetGroupIndex >= groupedProjectList.length
    ) {
      return {
        nextProjects: projectList,
        affectedGroupKeys: [] as string[],
      };
    }

    const targetGroupKey = groupedProjectList[targetGroupIndex].key;
    const [movedGroup] = groupedProjectList.splice(groupIndex, 1);
    groupedProjectList.splice(targetGroupIndex, 0, movedGroup);

    return {
      nextProjects: groupedProjectList.flatMap((group) => group.projects),
      affectedGroupKeys: [groupKey, targetGroupKey],
    };
  };

  useEffect(() => {
    void loadProjects();

    const stopTaskUpdate = window.deployMaster.onTaskUpdate((payload: TaskStateEvent) => {
      setTasks((current) => ({
        ...current,
        [payload.id]: {
          ...(current[payload.id] ?? { logs: [] as TaskLogEvent[] }),
          ...payload,
          logs: current[payload.id]?.logs ?? [],
        },
      }));
      setSelectedTaskId(payload.id);

      if (payload.kind === 'package' && payload.status === 'success') {
        void loadProjects();
        pushToast(`${payload.projectName} 打包完成`, 'success');
      }

      if (payload.status === 'error') {
        pushToast(`${payload.title} 执行失败`, 'error');
      }

      if (payload.status === 'cancelled') {
        pushToast(`${payload.title} 已停止`, 'info');
      }
    });

    const stopTaskLog = window.deployMaster.onTaskLog((payload: TaskLogEvent) => {
      setTasks((current) => {
        const task = current[payload.taskId];

        if (!task) {
          return current;
        }

        return {
          ...current,
          [payload.taskId]: {
            ...task,
            logs: [...task.logs, payload],
          },
        };
      });
    });

    return () => {
      stopTaskUpdate();
      stopTaskLog();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    void window.deployMaster
      .getSystemStats()
      .then((stats) => {
        if (mounted) {
          setSystemStats(stats);
        }
      })
      .catch(() => undefined);

    const stopSystemStats = window.deployMaster.onSystemStats((payload) => {
      setSystemStats(payload);
    });

    return () => {
      mounted = false;
      stopSystemStats();
    };
  }, []);

  useEffect(() => {
    const stopAppQuitState = window.deployMaster.onAppQuitState((payload) => {
      setAppQuitState(payload);
    });

    return () => {
      stopAppQuitState();
    };
  }, []);

  useEffect(() => {
    const stopUpdateProgress = window.deployMaster.onUpdateProgress((payload) => {
      setUpdateProgress(payload);
      setIsCheckingUpdate(false);

      if (payload.status === 'available' && payload.version) {
        pushToast(`发现新版本 v${payload.version}`, 'info');
      }
    });

    return () => {
      stopUpdateProgress();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    document.documentElement.dataset.theme = resolveTheme(themePreference);
  }, [themePreference]);

  useEffect(() => {
    localStorage.setItem(EDITOR_OPTIONS_STORAGE_KEY, JSON.stringify(editorOptions));
  }, [editorOptions]);

  useEffect(() => {
    localStorage.setItem(GLOBAL_NAMING_RULE_STORAGE_KEY, globalNamingRule.trim() || DEFAULT_GLOBAL_NAMING_RULE);
  }, [globalNamingRule]);

  useEffect(() => {
    localStorage.setItem(ALIASES_STORAGE_KEY, JSON.stringify(shortcutAliases));
  }, [shortcutAliases]);

  useEffect(() => {
    if (sortMode) {
      setCollapsedGroupKeys([]);
    }
  }, [sortMode]);

  useEffect(() => {
    if (!isSettingsOpen) {
      setDraggingEditorId(null);
      setEditorDropTargetId(null);
    }
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isAliasDropdownOpen || !aliasModalInfo) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!aliasDropdownRef.current?.contains(event.target as Node)) {
        setIsAliasDropdownOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isAliasDropdownOpen, aliasModalInfo]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (themePreference === 'system') {
        document.documentElement.dataset.theme = resolveTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handler);

    return () => {
      mediaQuery.removeEventListener('change', handler);
    };
  }, [themePreference]);

  useLayoutEffect(() => {
    if (!isProjectListVisible) {
      previousProjectRectsRef.current.clear();
      previousGroupRectsRef.current.clear();
      return;
    }

    const nextRects = new Map<string, DOMRect>();
    const nextGroupRects = new Map<string, DOMRect>();

    projects.forEach((project) => {
      const node = projectItemRefs.current.get(project.id);

      if (!node) {
        return;
      }

      const nextRect = node.getBoundingClientRect();
      nextRects.set(project.id, nextRect);

    });

    groupedProjects.forEach((group) => {
      const node = groupSectionRefs.current.get(group.key);

      if (!node) {
        return;
      }

      nextGroupRects.set(group.key, node.getBoundingClientRect());
    });

    const pendingGroupAnimationKeys = pendingGroupAnimationKeysRef.current;
    const pendingProjectAnimationIds = pendingProjectAnimationIdsRef.current;

    if (pendingGroupAnimationKeys?.size) {
      pendingGroupAnimationKeys.forEach((groupKey) => {
        const node = groupSectionRefs.current.get(groupKey);
        const previousRect = previousGroupRectsRef.current.get(groupKey);
        const nextRect = nextGroupRects.get(groupKey);

        if (!node || !previousRect || !nextRect) {
          return;
        }

        const translateX = previousRect.left - nextRect.left;
        const translateY = previousRect.top - nextRect.top;

        if (Math.abs(translateX) < 1 && Math.abs(translateY) < 1) {
          return;
        }

        node.getAnimations().forEach((animation) => animation.cancel());
        node.animate(
          [
            {
              transform: `translate(${translateX}px, ${translateY}px)`,
            },
            {
              transform: 'translate(0, 0)',
            },
          ],
          {
            duration: 210,
            easing: 'cubic-bezier(0.2, 0.9, 0.4, 1)',
          },
        );
      });
    } else if (pendingProjectAnimationIds?.size) {
      pendingProjectAnimationIds.forEach((projectId) => {
        const node = projectItemRefs.current.get(projectId);
        const previousRect = previousProjectRectsRef.current.get(projectId);
        const nextRect = nextRects.get(projectId);

        if (!node || !previousRect || !nextRect) {
          return;
        }

        const translateX = previousRect.left - nextRect.left;
        const translateY = previousRect.top - nextRect.top;

        if (Math.abs(translateX) < 1 && Math.abs(translateY) < 1) {
          return;
        }

        node.getAnimations().forEach((animation) => animation.cancel());
        node.animate(
          [
            {
              transform: `translate(${translateX}px, ${translateY}px)`,
            },
            {
              transform: 'translate(0, 0)',
            },
          ],
          {
            duration: 180,
            easing: 'cubic-bezier(0.2, 0.9, 0.4, 1)',
          },
        );
      });
    }

    previousProjectRectsRef.current = nextRects;
    previousGroupRectsRef.current = nextGroupRects;
    pendingProjectAnimationIdsRef.current = null;
    pendingGroupAnimationKeysRef.current = null;
  }, [groupedProjects, isProjectListVisible, projects]);

  useEffect(() => {
    const validGroupKeys = new Set(groupedProjects.map((group) => group.key));
    setCollapsedGroupKeys((current) => current.filter((key) => validGroupKeys.has(key)));
  }, [groupedProjects]);

  const orderedTasks = useMemo(
    () =>
      Object.values(tasks).sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    [tasks],
  );

  const runningTaskCount = orderedTasks.filter((task) => task.status === 'running').length;

  const addProject = async () => {
    setAddingProject(true);

    try {
      const addedProject = await window.deployMaster.addProject();

      if (!addedProject) {
        return;
      }

      setProjects((current) => {
        const nextProjects = current.filter((project) => project.id !== addedProject.id);
        return [...nextProjects, addedProject];
      });
      pushToast(`已添加项目 ${addedProject.projectName}`, 'success');
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    } finally {
      setAddingProject(false);
    }
  };

  const updateProject = async (project: ProjectConfig) => {
    try {
      const updatedProject = await window.deployMaster.updateProject(project);
      setProjects((current) =>
        current.map((item) => (item.id === updatedProject.id ? updatedProject : item)),
      );
      pushToast(`${updatedProject.projectName} 配置已保存`, 'success');
      return updatedProject;
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
      throw error;
    }
  };

  const updateProjectVersion = async (
    projectId: string,
    mode: 'patch' | 'minor' | 'major' | 'set',
    version?: string,
  ) => {
    try {
      const updatedProject = await window.deployMaster.updateProjectVersion(projectId, mode, version);
      setProjects((current) =>
        current.map((item) => (item.id === updatedProject.id ? updatedProject : item)),
      );
      pushToast(`版本已更新至 v${updatedProject.version}`, 'success');
      return updatedProject;
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
      throw error;
    }
  };

  const refreshProject = async (projectId: string) => {
    try {
      const refreshedProject = await window.deployMaster.refreshProject(projectId);
      setProjects((current) =>
        current.map((item) => (item.id === refreshedProject.id ? refreshedProject : item)),
      );
      pushToast(`${refreshedProject.projectName} 信息已刷新`, 'info');
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    }
  };

  const removeProject = async (projectId: string) => {
    try {
      await window.deployMaster.removeProject(projectId);
      setProjects((current) => current.filter((project) => project.id !== projectId));
      pushToast('项目已移除', 'info');
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    }
  };

  const saveShortcutAlias = (alias: string) => {
    const trimmed = alias.trim();

    if (!trimmed) {
      return;
    }

    setShortcutAliases((current) => {
      const filtered = current.filter((item) => item !== trimmed);
      return [trimmed, ...filtered].slice(0, 20);
    });
  };

  const deleteShortcutAlias = (alias: string) => {
    setShortcutAliases((current) => current.filter((item) => item !== alias));
  };

  const checkForUpdates = async () => {
    setIsCheckingUpdate(true);
    try {
      await window.deployMaster.checkForUpdates();
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
      setIsCheckingUpdate(false);
    }
  };

  const installUpdate = async () => {
    try {
      await window.deployMaster.installUpdate();
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    }
  };

  const runShortcut = async (projectId: string, shortcutId: string) => {
    const project = projects.find((item) => item.id === projectId);
    const shortcut = project?.shortcuts.find((item) => item.id === shortcutId);

    if (!project || !shortcut) {
      pushToast('项目或快捷命令不存在', 'error');
      return;
    }

    setAliasModalInfo({
      projectId,
      shortcutId,
      shortcutLabel: shortcut.label,
      projectDisplayName: getProjectDisplayName(project),
    });
    setAliasInput(shortcutAliases[0] || '');
    setIsAliasDropdownOpen(false);
  };

  const executeShortcutWithAlias = async () => {
    if (!aliasModalInfo) {
      return;
    }

    const { projectId, shortcutId } = aliasModalInfo;
    const trimmedAlias = aliasInput.trim();

    setAliasModalInfo(null);

    if (trimmedAlias) {
      saveShortcutAlias(trimmedAlias);
    }

    try {
      const result = await window.deployMaster.runShortcut(projectId, shortcutId, trimmedAlias);
      setSelectedTaskId(result.taskId);
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    }
  };

  const packageProject = async (projectId: string, profileId?: string) => {
    try {
      const result = await window.deployMaster.packageProject(
        projectId,
        profileId,
        globalNamingRule.trim() || DEFAULT_GLOBAL_NAMING_RULE,
      );
      setSelectedTaskId(result.taskId);
      pushToast('打包任务已启动', 'info');
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    }
  };

  const stopTask = async (taskId: string) => {
    try {
      await window.deployMaster.stopTask(taskId);
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    }
  };

  const openPath = async (targetPath: string) => {
    try {
      await window.deployMaster.openPath(targetPath);
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    }
  };

  const openInEditor = async (projectId: string, editor: EditorOption) => {
    try {
      await window.deployMaster.openInEditor(projectId, editor.command, editor.label);
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    }
  };

  const exportConfigFile = async () => {
    setConfigAction('export');

    try {
      const result = await window.deployMaster.exportConfigFile();

      if (!result) {
        return;
      }

      setIsSettingsOpen(false);
      pushToast(`已导出 ${result.projectCount} 个项目配置`, 'success');
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    } finally {
      setConfigAction(null);
    }
  };

  const importConfigFile = async () => {
    setConfigAction('import');

    try {
      const result = (await window.deployMaster.importConfigFile()) as ConfigImportResult | null;

      if (!result) {
        return;
      }

      setProjects(result.projects);
      setIsSettingsOpen(false);
      pushToast(
        `导入完成：成功 ${result.importedCount}，跳过 ${result.skippedCount}`,
        result.skippedCount > 0 ? 'info' : 'success',
      );
    } catch (error) {
      pushToast(formatErrorMessage(error), 'error');
    } finally {
      setConfigAction(null);
    }
  };

  const moveProject = async (projectId: string, direction: 'up' | 'down') => {
    const previousProjects = projects;
    const { nextProjects, affectedProjectIds } = moveProjectWithinGroup(
      previousProjects,
      projectId,
      direction,
    );

    if (!hasProjectOrderChanged(previousProjects, nextProjects)) {
      return;
    }

    pendingProjectAnimationIdsRef.current = new Set(affectedProjectIds);
    pendingGroupAnimationKeysRef.current = null;
    setProjects(nextProjects);

    try {
      const orderedProjects = await window.deployMaster.reorderProjects(
        nextProjects.map((project) => project.id),
      );
      setProjects(orderedProjects);
      pushToast('项目顺序已更新', 'success');
    } catch (error) {
      setProjects(previousProjects);
      pushToast(formatErrorMessage(error), 'error');
    }
  };

  const moveGroup = async (groupKey: string, direction: 'up' | 'down') => {
    const previousProjects = projects;
    const { nextProjects, affectedGroupKeys } = moveGroupBlock(previousProjects, groupKey, direction);

    if (!hasProjectOrderChanged(previousProjects, nextProjects)) {
      return;
    }

    pendingGroupAnimationKeysRef.current = new Set(affectedGroupKeys);
    pendingProjectAnimationIdsRef.current = null;
    setProjects(nextProjects);

    try {
      const orderedProjects = await window.deployMaster.reorderProjects(
        nextProjects.map((project) => project.id),
      );
      setProjects(orderedProjects);
      pushToast('分类顺序已更新', 'success');
    } catch (error) {
      setProjects(previousProjects);
      pushToast(formatErrorMessage(error), 'error');
    }
  };

  const toggleGroupCollapsed = (groupKey: string) => {
    if (sortMode) {
      return;
    }

    setCollapsedGroupKeys((current) =>
      current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey],
    );
  };

  const toggleProjectListVisibility = () => {
    setIsProjectListVisible((current) => {
      const next = !current;

      if (!next) {
        setSortMode(false);
      }

      return next;
    });
  };

  const updateEditorOption = (
    editorId: string,
    field: keyof Pick<EditorOption, 'label' | 'command'>,
    value: string,
  ) => {
    setEditorOptions((current) =>
      current.map((option) =>
        option.id === editorId
          ? {
              ...option,
              [field]: value,
            }
          : option,
      ),
    );
  };

  const removeEditorOption = (editorId: string) => {
    setEditorOptions((current) => current.filter((option) => option.id !== editorId));
  };

  const addEditorOption = () => {
    setEditorOptions((current) => [...current, createEditorOption()]);
  };

  const handleEditorOptionDrop = (targetEditorId: string) => {
    if (!draggingEditorId) {
      return;
    }

    setEditorOptions((current) =>
      reorderEditorOptionList(current, draggingEditorId, targetEditorId),
    );
    setDraggingEditorId(null);
    setEditorDropTargetId(null);
  };

  return (
    <main className="min-h-screen px-4 py-4 text-primary-ui lg:px-6 lg:py-5">
      <ToastRegion toasts={toasts} />

      {appQuitState ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/42 px-4 backdrop-blur-[3px]">
          <section className="surface-panel flex w-full max-w-sm flex-col items-center rounded-[28px] px-6 py-7 text-center shadow-[var(--shadow-panel)]">
            <span className="badge-accent inline-flex h-12 w-12 items-center justify-center rounded-full">
              <Icon name="time-task" className="animate-spin text-[20px]" />
            </span>
            <p className="text-primary-ui mt-4 text-base font-semibold">退出中，请稍候</p>
            <p className="text-muted-ui mt-2 text-sm leading-6">
              {appQuitState.activeTaskCount > 0
                ? `正在停止 ${appQuitState.activeTaskCount} 个运行中的任务并清理资源。`
                : '正在完成退出前清理。'}
            </p>
          </section>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/24 px-4 py-8 backdrop-blur-[2px]"
          onClick={() => setIsSettingsOpen(false)}
        >
          <section
            className="surface-panel w-full max-w-3xl rounded-[28px] p-4 lg:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-primary-ui text-base font-semibold">设置</p>
                <p className="text-muted-ui mt-1 text-xs">
                  统一管理配置文件以及全局编辑器选项。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                title="关闭设置"
                aria-label="关闭设置"
                className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
              >
                <Icon name="close" className="text-[16px]" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="surface-subpanel rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-primary-ui text-sm font-semibold">压缩命名规则</p>
                    <p className="text-muted-ui mt-1 text-xs leading-5">
                      全部项目统一使用这条命名规则。可用变量：
                      <code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/8">
                        {'{displayName}'}
                      </code>
                      <code className="mr-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/8">
                        {'{projectName}'}
                      </code>
                      <code className="mr-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/8">
                        {'{alias}'}
                      </code>
                      <code className="mr-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/8">
                        {'{profile}'}
                      </code>
                      <code className="mr-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/8">
                        {'{version}'}
                      </code>
                      <code className="mr-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/8">
                        {'{envFile}'}
                      </code>
                      <code className="mr-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/8">
                        {'{date}'}
                      </code>
                      <code className="mr-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/8">
                        {'{time}'}
                      </code>
                      <code className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/8">
                        {'{datetime}'}
                      </code>
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <input
                    value={globalNamingRule}
                    onChange={(event) => setGlobalNamingRule(event.target.value)}
                    className="ui-input w-full rounded-xl px-3.5 py-2.5 text-xs outline-none"
                    placeholder={DEFAULT_GLOBAL_NAMING_RULE}
                  />
                </div>
              </div>

              <div className="surface-subpanel rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-primary-ui text-sm font-semibold">配置文件</p>
                    <p className="text-muted-ui mt-1 text-xs leading-5">
                      导入和导出项目配置，方便备份、迁移和恢复。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsConfigSectionExpanded((current) => !current)}
                    title={isConfigSectionExpanded ? '收起配置文件' : '展开配置文件'}
                    aria-label={isConfigSectionExpanded ? '收起配置文件' : '展开配置文件'}
                    className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
                  >
                    <Icon
                      name={isConfigSectionExpanded ? 'up' : 'down'}
                      className="text-[16px]"
                    />
                  </button>
                </div>

                <div
                  className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${
                    isConfigSectionExpanded
                      ? 'mt-4 grid-rows-[1fr] opacity-100'
                      : 'mt-0 grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div
                        className="surface-item rounded-2xl p-4"
                      >
                        <p className="text-primary-ui text-sm font-semibold">导入配置</p>
                        <p className="text-muted-ui mt-1 text-xs leading-5">
                          从 JSON 配置文件恢复项目列表，并按项目路径自动合并已有配置。
                        </p>
                        <button
                          type="button"
                          onClick={importConfigFile}
                          disabled={configAction !== null}
                          className="btn-accent mt-4 rounded-full px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {configAction === 'import' ? '导入中...' : '选择配置文件'}
                        </button>
                      </div>

                      <div className="surface-item rounded-2xl p-4">
                        <p className="text-primary-ui text-sm font-semibold">导出配置</p>
                        <p className="text-muted-ui mt-1 text-xs leading-5">
                          将当前全部项目配置导出为 JSON，方便备份、迁移或共享给其他设备。
                        </p>
                        <button
                          type="button"
                          onClick={exportConfigFile}
                          disabled={configAction !== null}
                          className="btn-ghost mt-4 rounded-full px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {configAction === 'export' ? '导出中...' : '导出到文件'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="surface-subpanel rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-primary-ui text-sm font-semibold">编辑器选项</p>
                    <p className="text-muted-ui mt-1 text-xs leading-5">
                      项目卡片右上角会从这里读取可选编辑器。命令支持
                      <code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] dark:bg-white/8">
                        {'{projectPath}'}
                      </code>
                      占位符。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={addEditorOption}
                      className="btn-ghost rounded-full px-4 py-2 text-xs font-semibold"
                    >
                      添加编辑器
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditorSectionExpanded((current) => !current)}
                      title={isEditorSectionExpanded ? '收起编辑器选项' : '展开编辑器选项'}
                      aria-label={isEditorSectionExpanded ? '收起编辑器选项' : '展开编辑器选项'}
                      className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
                    >
                      <Icon
                        name={isEditorSectionExpanded ? 'up' : 'down'}
                        className="text-[16px]"
                      />
                    </button>
                  </div>
                </div>

                <div
                  className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${
                    isEditorSectionExpanded
                      ? 'mt-4 grid-rows-[1fr] opacity-100'
                      : 'mt-0 grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="space-y-3">
                      {editorOptions.length > 0 ? (
                        editorOptions.map((option, index) => (
                          <div
                            key={option.id}
                            onDragEnter={() => {
                              if (!draggingEditorId || draggingEditorId === option.id) {
                                return;
                              }

                              setEditorDropTargetId(option.id);
                            }}
                            onDragOver={(event) => {
                              if (!draggingEditorId) {
                                return;
                              }

                              event.preventDefault();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              handleEditorOptionDrop(option.id);
                            }}
                            className={`surface-item grid gap-3 rounded-2xl p-3 transition md:grid-cols-[auto_180px_minmax(0,1fr)_auto] ${
                              draggingEditorId === option.id ? 'scale-[0.99] opacity-70' : ''
                            } ${
                              editorDropTargetId === option.id && draggingEditorId !== option.id
                                ? 'ring-2 ring-[color:var(--accent-border)] ring-offset-2 ring-offset-transparent'
                                : ''
                            }`}
                          >
                            <div className="flex items-end md:items-center">
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) => {
                                  setDraggingEditorId(option.id);
                                  setEditorDropTargetId(option.id);
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', option.id);
                                }}
                                onDragEnd={() => {
                                  setDraggingEditorId(null);
                                  setEditorDropTargetId(null);
                                }}
                                title={`拖动排序 ${option.label || index + 1}`}
                                aria-label={`拖动排序 ${option.label || index + 1}`}
                                className="btn-ghost inline-flex h-10 w-10 cursor-grab items-center justify-center rounded-full active:cursor-grabbing"
                              >
                                <Icon name="sorting" className="text-[16px]" />
                              </button>
                            </div>

                            <label className="space-y-2">
                              <span className="text-muted-ui text-[11px] uppercase tracking-[0.18em]">
                                名称
                              </span>
                              <input
                                value={option.label}
                                onChange={(event) =>
                                  updateEditorOption(option.id, 'label', event.target.value)
                                }
                                className="ui-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                                placeholder={`编辑器 ${index + 1}`}
                              />
                            </label>

                            <label className="space-y-2">
                              <span className="text-muted-ui text-[11px] uppercase tracking-[0.18em]">
                                命令
                              </span>
                              <input
                                value={option.command}
                                onChange={(event) =>
                                  updateEditorOption(option.id, 'command', event.target.value)
                                }
                                className="ui-input w-full rounded-xl px-3 py-2 text-xs outline-none"
                                placeholder="code 或 trae {projectPath}"
                              />
                            </label>

                            <div className="flex items-end justify-end">
                              <button
                                type="button"
                                onClick={() => removeEditorOption(option.id)}
                                title={`删除编辑器 ${option.label || index + 1}`}
                                aria-label={`删除编辑器 ${option.label || index + 1}`}
                                className="btn-ghost inline-flex h-10 w-10 items-center justify-center rounded-full text-rose-500/80 hover:text-rose-500"
                              >
                                <Icon name="close" className="text-[16px]" />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="surface-item rounded-2xl border-dashed px-4 py-5 text-sm text-muted-ui">
                          暂无可用编辑器，点击右上角“添加编辑器”。
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="surface-subpanel rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-primary-ui text-sm font-semibold">应用更新</p>
                    <p className="text-muted-ui mt-1 text-xs leading-5">
                      检查 GitHub 上的最新版本，自动下载并安装更新。
                    </p>
                  </div>
                </div>

                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="badge-neutral rounded-full px-2.5 py-1 text-[11px]">
                      当前版本 v{window.deployMaster.getAppVersion?.() || '1.0.0'}
                    </span>
                    {updateProgress?.version ? (
                      <span className="badge-accent rounded-full px-2.5 py-1 text-[11px]">
                        最新版本 v{updateProgress.version}
                      </span>
                    ) : null}
                  </div>

                  {updateProgress?.status === 'downloading' ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-secondary-ui">
                        <span>正在下载更新...</span>
                        <span>{updateProgress.progress ?? 0}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                          style={{ width: `${updateProgress.progress ?? 0}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {updateProgress?.status === 'error' ? (
                    <p className="text-xs text-rose-400">
                      更新检查失败：{updateProgress.error}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {updateProgress?.status === 'downloaded' ? (
                      <button
                        type="button"
                        onClick={installUpdate}
                        className="btn-accent rounded-full px-4 py-2 text-xs font-semibold"
                      >
                        立即安装并重启
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={checkForUpdates}
                        disabled={isCheckingUpdate || updateProgress?.status === 'downloading'}
                        className="btn-ghost rounded-full px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isCheckingUpdate ? '检查中...' : '检查更新'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {aliasModalInfo ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/24 px-4 py-8 backdrop-blur-[2px]"
          onClick={() => setAliasModalInfo(null)}
        >
          <section
            className="surface-panel w-full max-w-sm rounded-[28px] p-4 lg:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-primary-ui text-base font-semibold">运行别名</p>
                <p className="text-muted-ui mt-1 text-xs">
                  {aliasModalInfo.projectDisplayName} · {aliasModalInfo.shortcutLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAliasModalInfo(null)}
                title="关闭"
                aria-label="关闭"
                className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
              >
                <Icon name="close" className="text-[16px]" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div ref={aliasDropdownRef} className="relative">
                <input
                  value={aliasInput}
                  onChange={(event) => setAliasInput(event.target.value)}
                  onFocus={() => setIsAliasDropdownOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void executeShortcutWithAlias();
                    }

                    if (event.key === 'Escape') {
                      if (isAliasDropdownOpen) {
                        setIsAliasDropdownOpen(false);
                      } else {
                        setAliasModalInfo(null);
                      }
                    }
                  }}
                  className="ui-input w-full rounded-xl px-3.5 py-2.5 text-xs outline-none"
                  placeholder="输入别名（可选，显示在导航页）"
                  autoFocus
                />

                {isAliasDropdownOpen && shortcutAliases.length > 0 ? (
                  <div className="absolute left-0 top-full z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-[color:var(--border-strong)] bg-[var(--surface)] p-1 shadow-[var(--shadow-panel)]">
                    {shortcutAliases.map((alias) => (
                      <div
                        key={alias}
                        className="flex items-center justify-between rounded-lg px-2.5 py-1.5 transition hover:bg-[var(--surface-hover)]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setAliasInput(alias);
                            setIsAliasDropdownOpen(false);
                          }}
                          className="min-w-0 flex-1 truncate text-left text-xs text-secondary-ui"
                        >
                          {alias}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteShortcutAlias(alias);
                          }}
                          title={`删除别名 ${alias}`}
                          aria-label={`删除别名 ${alias}`}
                          className="ml-2 shrink-0 text-muted-ui transition hover:text-rose-400"
                        >
                          <Icon name="close" className="text-[12px]" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAliasModalInfo(null)}
                  className="btn-ghost flex-1 rounded-full px-4 py-2.5 text-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void executeShortcutWithAlias()}
                  className="btn-accent flex-1 rounded-full px-4 py-2.5 text-xs font-semibold"
                >
                  确定运行
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <section className="surface-panel surface-hero relative overflow-hidden rounded-xl p-3 lg:p-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(78,205,196,0.18),transparent_30%),radial-gradient(circle_at_left,rgba(56,189,248,0.1),transparent_28%)]" />
        <div className="relative flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[10px] uppercase tracking-[0.38em] text-[var(--accent-text)]">
              Front-End Deploy Master
            </p>
            <h1 className="text-primary-ui mt-2 max-w-3xl text-2xl font-semibold tracking-tight md:text-3xl">
              EASY BUILD MASTER
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="badge-neutral rounded-full px-2.5 py-1.5 text-xs text-muted-ui font-medium">
              项目：{projects.length}
            </div>
            <div className="badge-neutral rounded-full px-2.5 py-1.5 text-xs text-muted-ui font-medium">
              运行中：{runningTaskCount}
            </div>
            <div
              className="badge-neutral rounded-full px-2.5 py-1.5 text-xs text-muted-ui font-medium"
              title="当前设备 CPU 使用率"
            >
              CPU：{formatUsagePercent(systemStats?.cpuUsage)}
            </div>
            <div
              className="badge-neutral rounded-full px-2.5 py-1.5 text-xs text-muted-ui font-medium"
              title={
                systemStats
                  ? `内存 ${formatMemorySize(systemStats.memoryUsed)} / ${formatMemorySize(systemStats.memoryTotal)}`
                  : '当前设备内存使用率'
              }
            >
              内存：{formatUsagePercent(systemStats?.memoryUsage)}
            </div>
            <button
              type="button"
              onClick={() => {
                setThemePreference(
                  themePreference === 'system' ? 'light' : themePreference === 'light' ? 'dark' : 'system'
                );
              }}
              title={`当前主题：${themePreference === 'system' ? '跟随系统' : themePreference === 'light' ? '浅色' : '深色'} (点击切换)`}
              aria-label="切换颜色主题"
              className="btn-ghost inline-flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-95"
            >
              <Icon
                name={
                  themePreference === 'system'
                    ? 'tool'
                    : themePreference === 'light'
                      ? 'daytime-mode'
                      : 'night-mode'
                }
                className="text-[16px]"
              />
            </button>
            <button
              type="button"
              onClick={addProject}
              disabled={addingProject}
              className="btn-accent rounded-full px-3.5 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {addingProject ? '选择中...' : '添加项目'}
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                title="打开设置"
                aria-label="打开设置"
                className="btn-ghost inline-flex h-10 w-10 items-center justify-center rounded-full"
              >
                <Icon name="settings" className="text-[16px]" />
              </button>
              {updateProgress?.status === 'available' || updateProgress?.status === 'downloaded' ? (
                <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-[var(--accent)] ring-2 ring-[var(--surface)]" />
              ) : null}
            </div>
            <button
              type="button"
              onClick={toggleProjectListVisibility}
              title={isProjectListVisible ? '隐藏项目列表' : '显示项目列表'}
              aria-label={isProjectListVisible ? '隐藏项目列表' : '显示项目列表'}
              className="btn-ghost inline-flex h-10 w-10 items-center justify-center rounded-full"
            >
              <Icon
                name={isProjectListVisible ? 'left-double-arrow' : 'right-double-arrow'}
                className="text-[16px]"
              />
            </button>
            <button
              type="button"
              onClick={() => setSortMode((current) => !current)}
              title={sortMode ? '完成排序' : '开启排序模式'}
              aria-label={sortMode ? '完成排序' : '开启排序模式'}
              disabled={!isProjectListVisible}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition ${
                sortMode ? 'btn-success' : 'btn-ghost'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <Icon name={sortMode ? 'success' : 'sorting'} className="text-[16px]" />
            </button>
          </div>
        </div>
      </section>

      <section
        className="workspace-layout mt-5"
        data-project-list-visible={isProjectListVisible ? 'true' : 'false'}
      >
        <div className="workspace-project-panel min-w-0 relative">
          {isProjectListVisible ? (
            <div className="space-y-4 animate-scale-fade-in min-w-[400px] origin-top-left">
              {sortMode && projects.length > 1 ? (
                <div className="badge-accent flex items-center justify-between rounded-[20px] px-4 py-3 text-sm">
                  <span>分类和组内项目都可用上下箭头排序，修改后自动保存。</span>
                </div>
              ) : null}
              {projects.length === 0 ? (
                <div className="surface-panel rounded-xl border-dashed px-5 py-7 text-center">
                  <p className="text-primary-ui text-base font-medium">还没有项目</p>
                  <p className="text-muted-ui mt-2 text-xs leading-6">
                    点击右上角“添加项目”，选择包含 package.json 的前端目录即可开始使用。
                  </p>
                </div>
              ) : (
                groupedProjects.map((group) => {
                  const isCollapsed = collapsedGroupKeys.includes(group.key);
                  const groupProjectIds = group.projects.map((project) => project.id);
                  const groupIndex = groupedProjects.findIndex((item) => item.key === group.key);

                  return (
                    <section
                      key={group.key}
                      ref={(node) => {
                        if (node) {
                          groupSectionRefs.current.set(group.key, node);
                        } else {
                          groupSectionRefs.current.delete(group.key);
                        }
                      }}
                      className="space-y-3"
                    >
                      <div className="surface-subpanel flex items-center justify-between gap-3 rounded-[20px] px-3.5 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="badge-accent inline-flex h-8 w-8 items-center justify-center rounded-full">
                              <Icon name="folder" className="text-[14px]" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-primary-ui truncate text-sm font-semibold">{group.label}</p>
                              <p className="text-muted-ui mt-0.5 text-[11px]">
                                {group.projects.length} 个项目
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {sortMode ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void moveGroup(group.key, 'up')}
                                title="上移分类"
                                aria-label={`上移分类 ${group.label}`}
                                disabled={groupIndex <= 0}
                                className="btn-ghost inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Icon name="up" className="text-[15px]" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void moveGroup(group.key, 'down')}
                                title="下移分类"
                                aria-label={`下移分类 ${group.label}`}
                                disabled={groupIndex >= groupedProjects.length - 1}
                                className="btn-ghost inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Icon name="down" className="text-[15px]" />
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => toggleGroupCollapsed(group.key)}
                            title={sortMode ? '排序模式下保持展开' : isCollapsed ? '展开分组' : '收起分组'}
                            aria-label={sortMode ? '排序模式下保持展开' : isCollapsed ? '展开分组' : '收起分组'}
                            disabled={sortMode}
                            className="btn-ghost inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Icon
                              name={isCollapsed && !sortMode ? 'down' : 'up'}
                              className="text-[16px]"
                            />
                          </button>
                        </div>
                      </div>

                      <div
                        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${
                          isCollapsed && !sortMode
                            ? 'mt-0 grid-rows-[0fr] opacity-0'
                            : 'mt-0 grid-rows-[1fr] opacity-100'
                        }`}
                      >
                        <div className="overflow-hidden">
                          <div className="space-y-4">
                            {group.projects.map((project, groupIndex) => (
                              <div
                                key={project.id}
                                ref={(node) => {
                                  if (node) {
                                    projectItemRefs.current.set(project.id, node);
                                  } else {
                                    projectItemRefs.current.delete(project.id);
                                  }
                                }}
                                className="transition-transform duration-200 ease-out"
                              >
                                <ProjectCard
                                  project={project}
                                  editorOptions={editorOptions}
                                  onSave={updateProject}
                                  onUpdateVersion={updateProjectVersion}
                                  onRefresh={refreshProject}
                                  onRemove={removeProject}
                                  onRunShortcut={runShortcut}
                                  onPackage={packageProject}
                                  onOpenPath={openPath}
                                  onOpenInEditor={openInEditor}
                                  sortMode={sortMode}
                                  canMoveUp={groupIndex > 0}
                                  canMoveDown={groupIndex < groupProjectIds.length - 1}
                                  onMoveProject={moveProject}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          ) : (
            <div className="surface-panel workspace-project-compact-list rounded-xl p-2.5 animate-scale-fade-in min-w-[168px] origin-top-left">
              {projects.length > 0 ? (
                groupedProjects.map((group) => (
                  <section key={group.key} className="space-y-2">
                    <div className="px-1">
                      <p className="text-faint-ui truncate text-[10px] font-semibold uppercase tracking-[0.2em]">
                        {group.label}
                      </p>
                    </div>

                    {group.projects.map((project) => {
                      const displayName = getProjectDisplayName(project);
                      const compactSubtitle = getProjectCompactSubtitle(project);
                      const platformLabel = getProjectPlatformLabel(project);

                      return (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => setIsProjectListVisible(true)}
                          title={displayName}
                          aria-label={`展开项目列表并查看 ${displayName}`}
                          className="workspace-project-thumb surface-item surface-item-hover"
                        >
                          <div className="workspace-project-thumb-top">
                            <span className="workspace-project-thumb-mark">
                              {getProjectMonogram(project)}
                            </span>
                            {project.lastPackagePath ? (
                              <span className="workspace-project-thumb-indicator" aria-hidden="true" />
                            ) : null}
                          </div>
                          <span className="workspace-project-thumb-name">{displayName}</span>
                          <span className="workspace-project-thumb-subtitle">{compactSubtitle}</span>
                          <div className="workspace-project-thumb-tags">
                            {platformLabel ? (
                              <span className="workspace-project-thumb-badge">{platformLabel}</span>
                            ) : null}
                            <span className="workspace-project-thumb-badge">{project.packageManager}</span>
                            <span className="workspace-project-thumb-badge">v{project.version}</span>
                          </div>
                        </button>
                      );
                    })}
                  </section>
                ))
              ) : (
                <div className="workspace-project-thumb workspace-project-thumb-empty surface-item border-dashed">
                  <span className="workspace-project-thumb-mark">0</span>
                  <span className="workspace-project-thumb-name">暂无</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="workspace-console-panel min-w-0">
          <TaskConsole
            tasks={orderedTasks}
            selectedTaskId={selectedTaskId}
            onSelect={setSelectedTaskId}
            onStop={stopTask}
            onOpenPath={openPath}
          />
        </div>
      </section>
    </main>
  );
}
