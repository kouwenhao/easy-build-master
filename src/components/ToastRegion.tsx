interface ToastItem {
  id: string;
  title: string;
  tone: 'success' | 'error' | 'info';
}

interface ToastRegionProps {
  toasts: ToastItem[];
}

const toneStyles: Record<ToastItem['tone'], string> = {
  success: 'toast-success',
  error: 'toast-error',
  info: 'toast-info',
};

export function ToastRegion({ toasts }: ToastRegionProps) {
  return (
    <div className="pointer-events-none fixed right-6 top-6 z-50 flex max-w-sm flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast rounded-full border px-4 py-2.5 text-xs shadow-sm transition-all animate-in slide-in-from-top-2 fade-in ${toneStyles[toast.tone]}`}
        >
          {toast.title}
        </div>
      ))}
    </div>
  );
}
