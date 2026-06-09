import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import type { Command } from '@codemirror/view';
import { StreamLanguage } from '@codemirror/language';

import type { EnvFileSummary } from '../../shared/types';
import { Icon } from './Icon';

interface EnvEditorProps {
  projectId: string;
  isOpen: boolean;
  preferredFileName?: string | null;
  onFilesChange?: (files: EnvFileSummary[]) => void;
}

type NoticeTone = 'info' | 'success' | 'error';

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '环境文件操作失败';
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

function formatEnvSize(size?: number) {
  if (!size) {
    return '0 B';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  return `${(size / 1024).toFixed(1)} KB`;
}

function isValidEnvFileName(value: string) {
  return /^\.env(?:\..+)?$/.test(value);
}

/** 简单的 .env 语法高亮 */
const envLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.match(/^#.*/)) return 'lineComment';
    if (stream.match(/^[A-Z_][A-Z0-9_]*/)) return 'variableName';
    if (stream.match(/^=/)) return 'operator';
    if (stream.match(/^(?:true|false)/i)) return 'bool';
    if (stream.match(/^\d+/)) return 'number';
    if (stream.match(/^"[^"]*"/)) return 'string';
    if (stream.match(/^'[^']*'/)) return 'string';
    stream.next();
    return null;
  },
});

/** Ctrl+/ 切换 # 注释 */
const toggleEnvComment: Command = ({ state, dispatch }) => {
  const { selection } = state;
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let allCommented = true;

  const lineSet = new Set<number>();
  for (const range of selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let i = startLine; i <= endLine; i++) lineSet.add(i);
  }

  const lines = Array.from(lineSet).sort((a, b) => a - b);
  const meaningful = lines.filter((n) => state.doc.line(n).text.trim().length > 0);

  for (const n of meaningful) {
    if (!/^\s*#/.test(state.doc.line(n).text)) {
      allCommented = false;
      break;
    }
  }

  for (const n of lines) {
    const line = state.doc.line(n);
    if (line.text.trim().length === 0) continue;

    if (allCommented) {
      const match = line.text.match(/^(\s*)# ?/);
      if (match) {
        changes.push({ from: line.from, to: line.from + match[0].length, insert: match[1] });
      }
    } else {
      const indent = line.text.match(/^\s*/)?.[0] ?? '';
      changes.push({ from: line.from + indent.length, to: line.from + indent.length, insert: '# ' });
    }
  }

  if (changes.length === 0) return false;
  dispatch(state.update({ changes }));
  return true;
};

const envCommentKeymap = keymap.of([{ key: 'Mod-/', run: toggleEnvComment }]);

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

export function EnvEditor({
  projectId,
  isOpen,
  preferredFileName = null,
  onFilesChange,
}: EnvEditorProps) {
  const createInputRef = useRef<HTMLInputElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const [isSectionExpanded, setIsSectionExpanded] = useState(true);
  const [isFileEditMode, setIsFileEditMode] = useState(false);
  const [envFiles, setEnvFiles] = useState<EnvFileSummary[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createFileName, setCreateFileName] = useState('.env');
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [busyAction, setBusyAction] = useState<'save' | 'create' | null>(null);
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);

  const selectedEnvFile = useMemo(
    () => envFiles.find((file) => file.fileName === selectedFileName) ?? null,
    [envFiles, selectedFileName],
  );
  const isDirty = selectedFileName !== null && editorContent !== savedContent;

  const showNotice = (tone: NoticeTone, text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => {
      setNotice((current) => (current?.text === text ? null : current));
    }, 2400);
  };

  const loadEnvContent = async (fileName: string) => {
    setIsLoadingContent(true);

    try {
      const envFile = await window.deployMaster.readEnvFile(projectId, fileName);
      setSelectedFileName(envFile.fileName);
      setEditorContent(envFile.content);
      setSavedContent(envFile.content);
    } catch (error) {
      showNotice('error', formatErrorMessage(error));
    } finally {
      setIsLoadingContent(false);
    }
  };

  const loadEnvFiles = async (preferredFileName?: string | null) => {
    setIsLoadingList(true);

    try {
      const files = await window.deployMaster.listEnvFiles(projectId);
      setEnvFiles(files);
      onFilesChange?.(files);

      if (files.length === 0) {
        setSelectedFileName(null);
        setEditorContent('');
        setSavedContent('');
        return;
      }

      const nextFileName =
        preferredFileName && files.some((file) => file.fileName === preferredFileName)
          ? preferredFileName
          : selectedFileName && files.some((file) => file.fileName === selectedFileName)
            ? selectedFileName
            : files[0].fileName;

      if (nextFileName) {
        await loadEnvContent(nextFileName);
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

    void loadEnvFiles(preferredFileName);
  }, [isOpen, isSectionExpanded, onFilesChange, preferredFileName, projectId]);

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

  useEffect(() => {
    if (!isCreateDialogOpen) {
      return;
    }

    window.requestAnimationFrame(() => {
      createInputRef.current?.focus();
      createInputRef.current?.select();
    });
  }, [isCreateDialogOpen]);

  const handleSelectFile = async (fileName: string) => {
    if (fileName === selectedFileName) {
      return;
    }

    if (isDirty && !window.confirm('当前 .env 内容尚未保存，确定切换文件吗？')) {
      return;
    }

    await loadEnvContent(fileName);
  };

  const openCreateDialog = () => {
    setCreateFileName('.env');
    setIsCreateDialogOpen(true);
  };

  const closeCreateDialog = () => {
    if (busyAction === 'create') {
      return;
    }

    setIsCreateDialogOpen(false);
  };

  const handleCreateEnvFile = async () => {
    const normalizedFileName = createFileName.trim();

    if (!isValidEnvFileName(normalizedFileName)) {
      showNotice('error', '文件名需为 .env 或 .env.xxx 格式');
      return;
    }

    const existingFile = envFiles.find((file) => file.fileName === normalizedFileName);

    if (existingFile) {
      await handleSelectFile(existingFile.fileName);
      showNotice('info', `已切换到现有 ${existingFile.fileName}`);
      return;
    }

    setBusyAction('create');

    try {
      await window.deployMaster.saveEnvFile(projectId, normalizedFileName, '');
      await loadEnvFiles(normalizedFileName);
      setIsCreateDialogOpen(false);
      showNotice('success', `已创建 ${normalizedFileName}`);
    } catch (error) {
      showNotice('error', formatErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteEnvFile = async (fileName: string) => {
    const isDeletingSelected = selectedFileName === fileName;
    const confirmMessage =
      isDeletingSelected && isDirty
        ? `当前文件 ${fileName} 有未保存内容，删除后无法恢复，确定继续吗？`
        : `确认删除环境文件 ${fileName} 吗？`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setDeletingFileName(fileName);

    try {
      await window.deployMaster.deleteEnvFile(projectId, fileName);
      const nextPreferredFileName = preferredFileName === fileName ? null : preferredFileName;
      const nextSelectedFileName = selectedFileName === fileName ? null : selectedFileName;

      await loadEnvFiles(nextPreferredFileName || nextSelectedFileName);
      showNotice('success', `${fileName} 已删除`);
    } catch (error) {
      showNotice('error', formatErrorMessage(error));
    } finally {
      setDeletingFileName(null);
    }
  };

  const handleSave = async () => {
    if (!selectedFileName) {
      return;
    }

    setBusyAction('save');

    try {
      const savedFile = await window.deployMaster.saveEnvFile(
        projectId,
        selectedFileName,
        editorContent,
      );

      setSavedContent(editorContent);
      setEnvFiles((current) =>
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
          <p className="text-primary-ui text-sm font-medium">环境变量</p>
          <p className="text-muted-ui mt-1 text-xs">读取并编辑项目根目录下的 `.env*` 文件</p>
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
            onClick={() => void loadEnvFiles(selectedFileName)}
            title="刷新环境文件"
            aria-label="刷新环境文件"
            className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
          >
            <Icon name="time-history" className="text-[15px]" />
          </button>
          <button
            type="button"
            onClick={() => setIsFileEditMode((current) => !current)}
            title={isFileEditMode ? '完成编辑环境文件' : '编辑环境文件'}
            aria-label={isFileEditMode ? '完成编辑环境文件' : '编辑环境文件'}
            className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
          >
            <Icon
              name={isFileEditMode ? 'success' : 'edit'}
              className="text-[15px]"
            />
          </button>
          <button
            type="button"
            onClick={openCreateDialog}
            title={busyAction === 'create' ? '正在创建环境文件' : '新建环境文件'}
            aria-label={busyAction === 'create' ? '正在创建环境文件' : '新建环境文件'}
            className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
          >
            <Icon
              name={busyAction === 'create' ? 'time-task' : 'add'}
              className="text-[15px]"
            />
          </button>
          <button
            type="button"
            onClick={handleSave}
            title={busyAction === 'save' ? '正在保存 .env' : '保存 .env'}
            aria-label={busyAction === 'save' ? '正在保存 .env' : '保存 .env'}
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
            title={isSectionExpanded ? '收起环境变量' : '展开环境变量'}
            aria-label={isSectionExpanded ? '收起环境变量' : '展开环境变量'}
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
          <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="surface-item min-h-[260px] rounded-[18px] p-2">
              <div className="max-h-[420px] space-y-1 overflow-y-auto">
                {isLoadingList ? (
                  <div className="px-3 py-3 text-sm text-[var(--text-muted)]">读取环境文件中...</div>
                ) : envFiles.length > 0 ? (
                  envFiles.map((file) => (
                    <div
                      key={file.fileName}
                      className={`surface-item-hover relative w-full rounded-2xl border px-3 py-2.5 pr-10 text-left ${
                        selectedFileName === file.fileName
                          ? 'surface-selected border-[color:var(--accent-border)]'
                          : preferredFileName === file.fileName
                            ? 'env-preferred-file'
                            : 'border-[color:var(--border)] bg-transparent'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void handleSelectFile(file.fileName)}
                        className="block min-w-0 w-full text-left"
                      >
                        <p className="text-primary-ui truncate text-sm font-medium">{file.fileName}</p>
                        <p className="text-faint-ui mt-1 text-[11px]">
                          {formatEnvSize(file.size)} · {formatUpdatedAt(file.updatedAt)}
                        </p>
                      </button>
                      {isFileEditMode ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteEnvFile(file.fileName);
                          }}
                          title="删除环境文件"
                          aria-label={`删除 ${file.fileName}`}
                          disabled={deletingFileName === file.fileName}
                          className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-rose-300/70 text-rose-400 transition hover:border-rose-400 hover:bg-rose-500/8 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-400/35 dark:text-rose-300/80 dark:hover:border-rose-300/60 dark:hover:bg-rose-400/10 dark:hover:text-rose-200"
                        >
                          {deletingFileName === file.fileName ? (
                            <span className="text-[9px] leading-none">...</span>
                          ) : (
                            <Icon name="close" className="text-[13px]" />
                          )}
                        </button>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-3 text-sm text-[var(--text-muted)]">
                    当前项目还没有 `.env` 文件。可以直接创建默认 `.env`。
                  </div>
                )}
              </div>
            </aside>

            <div className="surface-item min-h-[260px] rounded-[18px] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-primary-ui text-sm font-medium">
                    {selectedFileName ?? '未选择环境文件'}
                  </p>
                  <p className="text-muted-ui mt-1 text-xs">
                    {selectedEnvFile
                      ? `${formatEnvSize(selectedEnvFile.size)} · 最近修改 ${formatUpdatedAt(selectedEnvFile.updatedAt)}`
                      : '选择左侧文件后即可编辑'}
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
                    extensions={[envLanguage, envCommentKeymap, cmBaseTheme]}
                    onCreateEditor={(view) => {
                      editorViewRef.current = view;
                    }}
                    basicSetup={{
                      lineNumbers: false,
                      highlightActiveLineGutter: false,
                      highlightActiveLine: true,
                      foldGutter: false,
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
                  placeholder="请先在左侧选择或创建 .env 文件"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {isCreateDialogOpen ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[20px] bg-slate-950/18 px-4 backdrop-blur-[2px]">
          <div className="surface-panel w-full max-w-sm rounded-2xl p-4">
            <p className="text-primary-ui text-sm font-semibold">新建环境文件</p>
            <p className="text-muted-ui mt-1 text-xs">请输入文件名，例如 `.env.staging`</p>

            <input
              ref={createInputRef}
              value={createFileName}
              onChange={(event) => setCreateFileName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleCreateEnvFile();
                }

                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeCreateDialog();
                }
              }}
              className="ui-input mt-3 w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
              placeholder=".env"
            />

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateDialog}
                className="btn-ghost rounded-full px-3 py-2 text-xs font-medium"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleCreateEnvFile()}
                className="btn-accent rounded-full px-3 py-2 text-xs font-medium"
              >
                {busyAction === 'create' ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
