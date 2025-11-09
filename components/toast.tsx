'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast as sonnerToast } from 'sonner';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle, Info } from 'lucide-react';

const iconsByType: Record<'success' | 'error' | 'info', ReactNode> = {
  success: <CheckCircle />,
  error: <AlertTriangle />,
  info: <Info />,
};

export type ToastAction = {
  label: string;
  onClick?: () => void;
  primary?: boolean;
};

export function toast(
  props: Omit<ToastProps, 'id'> & { actions?: ToastAction[] }
) {
  return sonnerToast.custom((id) => (
    <Toast
      description={props.description}
      id={id}
      type={props.type}
      actions={props.actions}
    />
  ));
}

function Toast(props: ToastProps & { actions?: ToastAction[] }) {
  const { id, type, description, actions } = props;

  const descriptionRef = useRef<HTMLDivElement>(null);
  const [multiLine, setMultiLine] = useState(false);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) {
      return;
    }

    const update = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
      const lines = Math.round(el.scrollHeight / lineHeight);
      setMultiLine(lines > 1);
    };

    update(); // initial check
    const ro = new ResizeObserver(update); // re-check on width changes
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex toast-mobile:w-[356px] w-full justify-center">
      <div
        className={cn(
          'flex toast-mobile:w-fit w-full flex-row gap-3 rounded-lg p-3',
          multiLine ? 'items-start' : 'items-center',
          // background by type
          type === 'error'
            ? 'bg-red-50 border border-red-100'
            : type === 'info'
              ? 'bg-blue-50 border border-blue-100'
              : 'bg-zinc-100'
        )}
        data-testid="toast"
        key={id}
      >
        <div
          className={cn(
            'data-[type=error]:text-red-600 data-[type=success]:text-green-600 data-[type=info]:text-blue-600',
            { 'pt-1': multiLine }
          )}
          data-type={type}
        >
          {iconsByType[type]}
        </div>
        <div className="flex-1 text-sm text-zinc-950" ref={descriptionRef}>
          {description}
        </div>
        {actions && actions.length > 0 && (
          <div className="ml-3 flex items-center gap-2">
            {actions.map((a, idx) => (
              <button
                key={idx}
                onClick={() => {
                  try {
                    a.onClick?.();
                  } finally {
                    sonnerToast.dismiss(id);
                  }
                }}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium',
                  a.primary
                    ? type === 'error'
                      ? 'bg-white text-red-700 shadow-sm hover:bg-red-50'
                      : type === 'info'
                        ? 'bg-white text-blue-700 shadow-sm hover:bg-blue-50'
                        : 'bg-white text-green-700 shadow-sm hover:bg-green-50'
                    : 'bg-transparent text-zinc-800/80 hover:text-zinc-900'
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type ToastProps = {
  id: string | number;
  type: 'success' | 'error' | 'info';
  description: string;
};
