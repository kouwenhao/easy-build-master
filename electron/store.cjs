const { app } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_NAMING_RULE = '{displayName}_{datetime}';
const EDITOR_COMMAND_MAP = {
  vscode: 'code',
  antigravity: 'antigravity',
  trae: 'trae',
};

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

class ProjectStore {
  constructor() {
    this.cache = null;
  }

  get filePath() {
    return path.join(app.getPath('userData'), 'projects.json');
  }

  async ensureLoaded() {
    if (this.cache) {
      return this.cache;
    }

    try {
      const fileContent = await fs.readFile(this.filePath, 'utf-8');
      this.cache = JSON.parse(fileContent);
    } catch {
      this.cache = { projects: [] };
      await this.persist();
    }

    return this.cache;
  }

  async persist() {
    if (!this.cache) {
      return;
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  normalizeProject(project) {
    const editorId =
      typeof project.editorId === 'string' && project.editorId.trim()
        ? project.editorId.trim()
        : 'vscode';
    const editorCommand =
      typeof project.editorCommand === 'string' && project.editorCommand.trim()
        ? project.editorCommand.trim()
        : editorId === 'custom'
          ? ''
          : EDITOR_COMMAND_MAP[editorId] || EDITOR_COMMAND_MAP.vscode;
    const availableScripts = Array.isArray(project.availableScripts)
      ? project.availableScripts
          .map((script) => ({
            name: typeof script.name === 'string' ? script.name : '',
            label: typeof script.label === 'string' ? script.label : '',
            command: typeof script.command === 'string' ? script.command : '',
          }))
          .filter((script) => script.name && script.command)
      : [];

    const publishProfiles =
      Array.isArray(project.publishProfiles) && project.publishProfiles.length > 0
        ? project.publishProfiles
            .map((profile) => ({
              id: typeof profile.id === 'string' && profile.id.trim() ? profile.id : randomUUID(),
              name: normalizeString(profile.name, '正式').trim() || '正式',
              buildCommand: normalizeString(profile.buildCommand, project.buildCommand || '').trim(),
              distDir: normalizeString(profile.distDir, project.distDir || 'dist').trim() || 'dist',
              releaseDir:
                normalizeString(profile.releaseDir, project.releaseDir || 'dist-releases').trim() ||
                'dist-releases',
              envFileName: normalizeString(profile.envFileName).trim(),
              namingRule:
                normalizeString(profile.namingRule, project.namingRule || DEFAULT_NAMING_RULE).trim() ||
                DEFAULT_NAMING_RULE,
              lastPackagedAt: normalizeString(profile.lastPackagedAt).trim() || undefined,
              lastPackagePath: normalizeString(profile.lastPackagePath).trim() || undefined,
            }))
            .filter((profile) => profile.buildCommand || profile.distDir || profile.releaseDir)
        : [
            {
              id: randomUUID(),
              name: '正式',
              buildCommand: normalizeString(project.buildCommand).trim(),
              distDir: normalizeString(project.distDir, 'dist').trim() || 'dist',
              releaseDir: normalizeString(project.releaseDir, 'dist-releases').trim() || 'dist-releases',
              envFileName: normalizeString(project.envFileName).trim(),
              namingRule:
                normalizeString(project.namingRule, DEFAULT_NAMING_RULE).trim() || DEFAULT_NAMING_RULE,
              lastPackagedAt: normalizeString(project.lastPackagedAt).trim() || undefined,
              lastPackagePath: normalizeString(project.lastPackagePath).trim() || undefined,
            },
          ];

    const activeProfileId =
      typeof project.activeProfileId === 'string' &&
      publishProfiles.some((profile) => profile.id === project.activeProfileId)
        ? project.activeProfileId
        : publishProfiles[0].id;
    const activeProfile =
      publishProfiles.find((profile) => profile.id === activeProfileId) ?? publishProfiles[0];
    const latestProfile = [...publishProfiles]
      .filter((profile) => profile.lastPackagedAt)
      .sort((left, right) => right.lastPackagedAt.localeCompare(left.lastPackagedAt))[0];

    return {
      ...project,
      alias: typeof project.alias === 'string' ? project.alias.trim() : '',
      groupName: typeof project.groupName === 'string' ? project.groupName.trim() : '',
      platformLabel: typeof project.platformLabel === 'string' ? project.platformLabel.trim() : '',
      editorId,
      editorCommand,
      activeProfileId,
      buildCommand: activeProfile.buildCommand,
      distDir: activeProfile.distDir,
      releaseDir: activeProfile.releaseDir,
      publishProfiles,
      availableScripts,
      lastPackagedAt:
        normalizeString(project.lastPackagedAt).trim() ||
        latestProfile?.lastPackagedAt ||
        activeProfile.lastPackagedAt,
      lastPackagePath:
        normalizeString(project.lastPackagePath).trim() ||
        latestProfile?.lastPackagePath ||
        activeProfile.lastPackagePath,
    };
  }

  async list() {
    const store = await this.ensureLoaded();
    return [...store.projects].map((project) => this.normalizeProject(project));
  }

  async findById(id) {
    const store = await this.ensureLoaded();
    const project = store.projects.find((projectItem) => projectItem.id === id);
    return project ? this.normalizeProject(project) : undefined;
  }

  async findByRoot(rootPath) {
    const store = await this.ensureLoaded();
    const project = store.projects.find((projectItem) => projectItem.rootPath === rootPath);
    return project ? this.normalizeProject(project) : undefined;
  }

  async upsert(project) {
    const store = await this.ensureLoaded();
    const normalizedProject = this.normalizeProject(project);
    const index = store.projects.findIndex((item) => item.id === normalizedProject.id);

    if (index >= 0) {
      store.projects[index] = normalizedProject;
    } else {
      store.projects.push(normalizedProject);
    }

    await this.persist();
    return normalizedProject;
  }

  async remove(id) {
    const store = await this.ensureLoaded();
    store.projects = store.projects.filter((project) => project.id !== id);
    await this.persist();
  }

  async reorder(projectIds) {
    const store = await this.ensureLoaded();
    const projectMap = new Map(
      store.projects.map((project) => [project.id, this.normalizeProject(project)]),
    );
    const reorderedProjects = [];

    for (const projectId of projectIds) {
      const project = projectMap.get(projectId);

      if (project) {
        reorderedProjects.push(project);
        projectMap.delete(projectId);
      }
    }

    for (const project of store.projects) {
      if (projectMap.has(project.id)) {
        reorderedProjects.push(this.normalizeProject(project));
      }
    }

    store.projects = reorderedProjects;
    await this.persist();
    return [...store.projects];
  }

  async replaceAll(projects) {
    const store = await this.ensureLoaded();
    store.projects = Array.isArray(projects)
      ? projects.map((project) => this.normalizeProject(project))
      : [];
    await this.persist();
    return [...store.projects];
  }
}

module.exports = {
  ProjectStore,
};
