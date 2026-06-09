import { useEffect, useMemo, useRef, useState } from 'react';

import type { TaskLogEvent, TaskStateEvent } from '../../shared/types';
import { Icon } from './Icon';

export interface TaskView extends TaskStateEvent {
  logs: TaskLogEvent[];
}

interface TaskConsoleProps {
  tasks: TaskView[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  onStop: (taskId: string) => void;
  onOpenPath: (targetPath: string) => void;
}

const statusStyles: Record<TaskStateEvent['status'], string> = {
  running: 'status-running',
  success: 'status-success',
  error: 'status-error',
  cancelled: 'status-cancelled',
};

const statusText: Record<TaskStateEvent['status'], string> = {
  running: '运行中',
  success: '成功',
  error: '失败',
  cancelled: '已停止',
};

function StatusIcon({ status }: { status: TaskStateEvent['status'] }) {
  if (status === 'running') {
    return <Icon name="time-task" className="text-[14px]" />;
  }

  if (status === 'success') {
    return <Icon name="success" className="text-[14px]" />;
  }

  if (status === 'error') {
    return <Icon name="error" className="text-[14px]" />;
  }

  return <Icon name="stop" className="text-[14px]" />;
}

function formatDateTime(value?: string) {
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

export function TaskConsole({
  tasks,
  selectedTaskId,
  onSelect,
  onStop,
  onOpenPath,
}: TaskConsoleProps) {
  const logContainerRef = useRef<HTMLPreElement>(null);
  const [isTaskListVisible, setIsTaskListVisible] = useState(true);

  const selectedTask = useMemo(() => {
    if (!tasks.length) {
      return null;
    }

    if (!selectedTaskId) {
      return tasks[0];
    }

    return tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    const element = logContainerRef.current;

    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, [selectedTask]);

  return (
    <section
      className="surface-panel flex min-h-[780px] flex-row overflow-hidden rounded-xl"
      style={{
        height: '780px',
        maxHeight: 'calc(100vh - 220px)',
      }}
    >
      <aside
        className={`flex min-h-0 shrink-0 flex-col bg-[var(--surface-deep)] transition-[width,opacity,border-color] duration-300 ease-[cubic-bezier(0.2,0.9,0.4,1)] ${
          isTaskListVisible
            ? 'w-[300px] border-r border-[color:var(--border)] opacity-100'
            : 'w-0 overflow-hidden border-r-transparent opacity-0'
        }`}
      >
        <div className="flex h-full w-[300px] flex-col origin-top-left">
          <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
            <div>
              <p className="text-primary-ui text-xs font-medium">任务控制台</p>
            </div>
            <span className="badge-neutral rounded-full px-2 py-0.5 text-xs">{tasks.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tasks.length === 0 ? (
              <div className="surface-item rounded-2xl border-dashed px-4 py-5 text-sm text-[var(--text-muted)]">
                还没有运行任务
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onSelect(task.id)}
                    className={`surface-item surface-item-hover w-full rounded-xl px-3 py-2.5 text-left ${
                      selectedTask?.id === task.id
                        ? 'surface-selected'
                        : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-primary-ui truncate text-sm font-medium">{task.title}</p>
                        <p className="text-muted-ui mt-1 truncate text-xs">{task.projectName}</p>
                      </div>
                      <span
                        title={statusText[task.status]}
                        aria-label={statusText[task.status]}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${statusStyles[task.status]}`}
                      >
                        <StatusIcon status={task.status} />
                      </span>
                    </div>
                    <p className="text-faint-ui mt-1.5 text-[10px]">{formatDateTime(task.startedAt)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-[color:var(--border)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-primary-ui truncate text-sm font-semibold">
              {selectedTask?.title ?? '等待任务启动'}
            </p>
            <p className="text-muted-ui mt-1 truncate text-xs">
              {selectedTask?.command ?? '点击项目卡片中的按钮即可执行命令'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsTaskListVisible((current) => !current)}
              title={isTaskListVisible ? '隐藏任务列表' : '显示任务列表'}
              aria-label={isTaskListVisible ? '隐藏任务列表' : '显示任务列表'}
              className="btn-ghost inline-flex h-10 w-10 items-center justify-center rounded-full"
            >
              <Icon
                name={isTaskListVisible ? 'left-double-arrow' : 'right-double-arrow'}
                className="text-[16px]"
              />
            </button>
            {selectedTask?.outputPath ? (
              <button
                type="button"
                onClick={() => onOpenPath(selectedTask.outputPath!)}
                title="打开输出"
                aria-label="打开输出"
                className="btn-ghost inline-flex h-10 w-10 items-center justify-center rounded-full"
              >
                <Icon name="folder" className="text-[16px]" />
              </button>
            ) : null}
            {selectedTask?.status === 'running' ? (
                <button
                  type="button"
                  onClick={() => onStop(selectedTask.id)}
                  title="停止任务"
                  aria-label="停止任务"
                  className="btn-danger inline-flex h-10 w-10 items-center justify-center rounded-full"
                >
                  <Icon name="stop-fill" className="text-[16px]" />
                </button>
              ) : null}
          </div>
        </div>

        <div className="text-muted-ui grid gap-2 border-b border-[color:var(--border)] px-4 py-3 text-[11px] md:grid-cols-4">
          <div>
            <span className="text-faint-ui block">开始时间</span>
            <span className="text-secondary-ui mt-1 block">{formatDateTime(selectedTask?.startedAt)}</span>
          </div>
          <div>
            <span className="text-faint-ui block">结束时间</span>
            <span className="text-secondary-ui mt-1 block">{formatDateTime(selectedTask?.endedAt)}</span>
          </div>
          <div>
            <span className="text-faint-ui block">退出状态</span>
            <span className="text-secondary-ui mt-1 block">
              {selectedTask ? statusText[selectedTask.status] : '--'}
            </span>
          </div>
          <div>
            <span className="text-faint-ui block">错误信息</span>
            <span className="text-secondary-ui mt-1 block truncate">
              {selectedTask?.errorMessage ?? '--'}
            </span>
          </div>
        </div>

        <pre
          ref={logContainerRef}
          className="console-body min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words"
        >
          {selectedTask
            ? selectedTask.logs.length > 0
              ? selectedTask.logs.map((log, index) => (
                  <span
                    key={`${log.timestamp}-${index}`}
                    className={
                      log.stream === 'stderr'
                        ? 'console-error'
                        : log.stream === 'system'
                          ? 'console-system'
                          : undefined
                    }
                  >
                    {log.chunk}
                  </span>
                ))
              : '等待日志输出...'
            : '点击左侧任务以查看日志'}
        </pre>
      </div>
    </section>
  );
}
