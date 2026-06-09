import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';

import type { VueConfigFileSummary } from '../../shared/types';
import { Icon } from './Icon';

interface VueConfigEditorProps {
  projectId: string;
  isOpen: boolean;
  onFilesChange?: (files: VueConfigFileSummary[]) => void;
}

type NoticeTone = 'info' | 'success' | 'error';

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Vue 配置文件操作失败';
}

function formatUpdatedAt(value?: string) {
  if (!value) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatFileSize(size?: number) {
  if (!size) {
    return '0 B';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  return `${(size / 1024).toFixed(1)} KB`;
}

const cmBaseTheme = EditorView.theme({
  '&': {
    minHeight: '300px',
    maxHeight: '500px',
    borderRadius: '18px',
    border: '1px solid var(--border)',
    fontSize: '13px',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--accent-border)',
  },
});

export function VueConfigEditor({
  projectId,
  isOpen,
  onFilesChange,
}: VueConfigEditorProps) {
  const [isSectionExpanded, setIsSectionExpanded] = useState(true);
  const [configFiles, setConfigFiles] = useState<VueConfigFileSummary[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [busyAction, setBusyAction] = useState<'save' | null>(null);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const scrolledToFileRef = useRef<string | null>(null);

  const selectedConfigFile = useMemo(
    () => configFiles.find((file) => file.fileName === selectedFileName) ?? null,
    [configFiles, selectedFileName],
  );
  const isDirty = selectedFileName !== null && editorContent !== savedContent;

  const showNotice = (tone: NoticeTone, text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => {
      setNotice((current) => (current?.text === text ? null : current));
    }, 2400);
  };

  const loadConfigContent = async (fileName: string) => {
    setIsLoadingContent(true);

    try {
      const configFile = await window.deployMaster.readVueConfigFile(projectId, fileName);
      setSelectedFileName(configFile.fileName);
      setEditorContent(configFile.content);
      setSavedContent(configFile.content);
    } catch (error) {
      showNotice('error', formatErrorMessage(error));
    } finally {
      setIsLoadingContent(false);
    }
  };

  // 尝试滚动到 devServer 行的辅助函数
  const tryScrollToDevServer = useCallback(() => {
    if (!selectedFileName || !editorContent) return;
    if (scrolledToFileRef.current === selectedFileName) return;

    const view = editorViewRef.current;
    if (!view) return;

    // 标记已尝试，防止重复滚动
    scrolledToFileRef.current = selectedFileName;

    requestAnimationFrame(() => {
      // 再次检查 view 和文档是否就绪
      if (!view.state.doc.length) return;

      const lines = editorContent.split('\n');
      const devServerLineIndex = lines.findIndex((line) => /devServer\s*[:{]/.test(line));

      if (devServerLineIndex > 0) {
        const lineNum = devServerLineIndex + 1;
        const lineInfo = view.state.doc.line(lineNum);
        view.dispatch({
          selection: { anchor: lineInfo.from },
          effects: EditorView.scrollIntoView(lineInfo.from, { y: 'start', yMargin: 100 }),
        });
      }
    });
  }, [selectedFileName, editorContent]);

  // 内容加载后自动滚动到 devServer 行（仅首次加载时）
  useEffect(() => {
    tryScrollToDevServer();
  }, [tryScrollToDevServer]);

  const loadConfigFiles = async () => {
    setIsLoadingList(true);

    try {
      const files = await window.deployMaster.listVueConfigFiles(projectId);
      setConfigFiles(files);
      onFilesChange?.(files);

      if (files.length === 0) {
        setSelectedFileName(null);
        setEditorContent('');
        setSavedContent('');
        return;
      }

      const nextFileName =
        selectedFileName && files.some((file) => file.fileName === selectedFileName)
          ? selectedFileName
          : files[0].fileName;

      if (nextFileName) {
        await loadConfigContent(nextFileName);
      }
    } catch (error) {
      showNotice('error', formatErrorMessage(error));
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !isSectionExpanded) {
      return;
    }

    void loadConfigFiles();
  }, [isOpen, isSectionExpanded, onFilesChange, projectId]);

  useEffect(() => {
    if (!isOpen || !isSectionExpanded) {
      return;
    }

    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const isSaveShortcut =
        (event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S');

      if (!isSaveShortcut) {
        return;
      }

      // 只在 CodeMirror 编辑器获得焦点时拦截
      if (!editorViewRef.current?.hasFocus) {
        return;
      }

      event.preventDefault();

      if (selectedFileName && busyAction !== 'save') {
        void handleSave();
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown, true);
    };
  }, [busyAction, isOpen, isSectionExpanded, selectedFileName, editorContent]);

  const handleSelectFile = async (fileName: string) => {
    if (fileName === selectedFileName) {
      return;
    }

    if (isDirty && !window.confirm('当前配置内容尚未保存，确定切换文件吗？')) {
      return;
    }

    await loadConfigContent(fileName);
  };

  const handleCreateConfigFile = async (fileType: 'js' | 'ts') => {
    const fileName = `vue.config.${fileType}`;

    if (configFiles.some((file) => file.fileName === fileName)) {
      await handleSelectFile(fileName);
      showNotice('info', `已切换到现有 ${fileName}`);
      return;
    }

    try {
      const defaultContent =
        fileType === 'js'
          ? `const { defineConfig } = require('@vue/cli-service');\n\nmodule.exports = defineConfig({\n  transpileDependencies: true,\n});\n`
          : `import { defineConfig } from '@vue/cli-service';\n\nexport default defineConfig({\n  transpileDependencies: true,\n});\n`;

      await window.deployMaster.saveVueConfigFile(projectId, fileName, defaultContent);
      await loadConfigFiles();
      showNotice('success', `已创建 ${fileName}`);
    } catch (error) {
      showNotice('error', formatErrorMessage(error));
    }
  };

  const handleDeleteConfigFile = async (fileName: string) => {
    const isDeletingSelected = selectedFileName === fileName;
    const confirmMessage =
      isDeletingSelected && isDirty
        ? `当前文件 ${fileName} 有未保存内容，删除后无法恢复，确定继续吗？`
        : `确认删除配置文件 ${fileName} 吗？`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      await window.deployMaster.deleteVueConfigFile(projectId, fileName);
      await loadConfigFiles();
      showNotice('success', `${fileName} 已删除`);
    } catch (error) {
      showNotice('error', formatErrorMessage(error));
    }
  };

  const handleSave = async () => {
    if (!selectedFileName) {
      return;
    }

    setBusyAction('save');

    try {
      const savedFile = await window.deployMaster.saveVueConfigFile(
        projectId,
        selectedFileName,
        editorContent,
      );

      setSavedContent(editorContent);
      setConfigFiles((current) =>
        current.map((file) => (file.fileName === savedFile.fileName ? savedFile : file)),
      );
      showNotice('success', `${selectedFileName} 已保存`);
    } catch (error) {
      showNotice('error', formatErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const handleEditorChange = useCallback((value: string) => {
    setEditorContent(value);
  }, []);

  const isDark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  return (
    <section className="surface-subpanel relative mt-4 rounded-[20px] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-primary-ui text-sm font-medium">Vue 配置</p>
          <p className="text-muted-ui mt-1 text-xs">读取并编辑项目根目录下的 `vue.config.js/ts` 文件</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notice ? (
            <span
              className={`rounded-full px-2 py-1 text-[11px] ${
                notice.tone === 'success'
                  ? 'status-success'
                  : notice.tone === 'error'
                    ? 'status-error'
                    : 'status-running'
              }`}
            >
              {notice.text}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void loadConfigFiles()}
            title="刷新配置文件"
            aria-label="刷新配置文件"
            className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
          >
            <Icon name="time-history" className="text-[15px]" />
          </button>
          <button
            type="button"
            onClick={() => void handleCreateConfigFile('js')}
            title="创建 vue.config.js"
            aria-label="创建 vue.config.js"
            className="btn-ghost inline-flex h-9 items-center justify-center rounded-full px-2 text-xs"
          >
            + JS
          </button>
          <button
            type="button"
            onClick={() => void handleCreateConfigFile('ts')}
            title="创建 vue.config.ts"
            aria-label="创建 vue.config.ts"
            className="btn-ghost inline-flex h-9 items-center justify-center rounded-full px-2 text-xs"
          >
            + TS
          </button>
          <button
            type="button"
            onClick={handleSave}
            title={busyAction === 'save' ? '正在保存配置' : '保存配置'}
            aria-label={busyAction === 'save' ? '正在保存配置' : '保存配置'}
            disabled={!isDirty || !selectedFileName || !isSectionExpanded}
            className="btn-accent inline-flex h-9 w-9 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon
              name={busyAction === 'save' ? 'time-task' : 'save'}
              className="text-[15px]"
            />
          </button>
          <button
            type="button"
            onClick={() => setIsSectionExpanded((current) => !current)}
            title={isSectionExpanded ? '收起 Vue 配置' : '展开 Vue 配置'}
            aria-label={isSectionExpanded ? '收起 Vue 配置' : '展开 Vue 配置'}
            className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
          >
            <Icon name={isSectionExpanded ? 'up' : 'down'} className="text-[16px]" />
          </button>
        </div>
      </div>

      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${
          isSectionExpanded
            ? 'grid-rows-[1fr] opacity-100 mt-3'
            : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'
        }`}
      >
        <div className="overflow-hidden">
          {isLoadingList ? (
            <div className="px-3 py-3 text-sm text-[var(--text-muted)]">读取 Vue 配置文件中...</div>
          ) : configFiles.length > 0 ? (
            <div className="space-y-3">
              {/* 文件选择标签 */}
              {configFiles.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {configFiles.map((file) => (
                    <button
                      key={file.fileName}
                      type="button"
                      onClick={() => void handleSelectFile(file.fileName)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        selectedFileName === file.fileName
                          ? 'bg-[var(--accent)] text-white'
                          : 'surface-item-hover border border-[color:var(--border)]'
                      }`}
                    >
                      {file.fileName}
                      <span className="ml-1.5 opacity-60">{formatFileSize(file.size)}</span>
                    </button>
                  ))}
                  {configFiles.map((file) => (
                    <button
                      key={`delete-${file.fileName}`}
                      type="button"
                      onClick={() => void handleDeleteConfigFile(file.fileName)}
                      title={`删除 ${file.fileName}`}
                      aria-label={`删除 ${file.fileName}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-300/70 text-rose-400 transition hover:border-rose-400 hover:bg-rose-500/8 hover:text-rose-500 dark:border-rose-400/35 dark:text-rose-300/80 dark:hover:border-rose-300/60 dark:hover:bg-rose-400/10 dark:hover:text-rose-200"
                    >
                      <Icon name="close" className="text-[11px]" />
                    </button>
                  ))}
                </div>
              )}

              {/* 编辑器区域 */}
              <div className="surface-item min-h-[260px] rounded-[18px] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-primary-ui text-sm font-medium">
                      {selectedFileName ?? '未选择配置文件'}
                    </p>
                    <p className="text-muted-ui mt-1 text-xs">
                      {selectedConfigFile
                        ? `${formatFileSize(selectedConfigFile.size)} · 最近修改 ${formatUpdatedAt(selectedConfigFile.updatedAt)}`
                        : '选择文件后即可编辑'}
                    </p>
                  </div>
                  {isDirty ? (
                    <span className="status-running rounded-full px-2 py-1 text-[11px]">未保存</span>
                  ) : null}
                </div>

                {selectedFileName ? (
                  <div className="mt-3 overflow-hidden rounded-[18px]">
                    <CodeMirror
                      value={editorContent}
                      onChange={handleEditorChange}
                      readOnly={isLoadingContent}
                      theme={isDark ? oneDark : undefined}
                      extensions={[javascript(), cmBaseTheme]}
                      onCreateEditor={(view) => {
                        editorViewRef.current = view;
                        // effect 可能在 view 创建前就跑过了，这里再试一次
                        tryScrollToDevServer();
                      }}
                      basicSetup={{
                        lineNumbers: true,
                        highlightActiveLineGutter: true,
                        highlightActiveLine: true,
                        foldGutter: true,
                        autocompletion: false,
                      }}
                    />
                  </div>
                ) : (
                  <textarea
                    value={editorContent}
                    onChange={(event) => setEditorContent(event.target.value)}
                    disabled={true}
                    spellCheck={false}
                    className="ui-input mt-3 min-h-[300px] w-full resize-y rounded-[18px] px-4 py-3 font-mono text-[13px] leading-6 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder="请先创建 vue.config.js 或 vue.config.ts 文件"
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="surface-item min-h-[260px] rounded-[18px] p-3">
              <div className="flex flex-col items-center justify-center py-8">
                <p className="text-muted-ui text-sm">当前项目还没有 Vue 配置文件</p>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCreateConfigFile('js')}
                    className="btn-accent rounded-full px-4 py-2 text-sm"
                  >
                    创建 vue.config.js
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateConfigFile('ts')}
                    className="btn-accent rounded-full px-4 py-2 text-sm"
                  >
                    创建 vue.config.ts
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
