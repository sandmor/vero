'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

// Lightweight internal icon button to avoid high-contrast default button styling
function IconButton({
  children,
  onClick,
  disabled,
  className = '',
  label,
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  className?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={`group relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 
        bg-white/5 text-white/90 backdrop-blur-sm transition 
        hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 
        disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

interface ImageViewerProps {
  src: string;
  alt: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ImageViewer({ src, alt, isOpen, onClose }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showUI, setShowUI] = useState(true);
  const hideUiTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Reset zoom and position when opening a new image
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setShowUI(true);
    }
  }, [isOpen, src]);

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      setShowUI(true);
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '0') {
        resetZoom();
      } else if (e.key === '+' || e.key === '=') {
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        zoomOut();
      } else if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      ) {
        e.preventDefault();
        const delta = 40;
        setPosition((p) => ({
          x:
            e.key === 'ArrowLeft'
              ? p.x + delta
              : e.key === 'ArrowRight'
                ? p.x - delta
                : p.x,
          y:
            e.key === 'ArrowUp'
              ? p.y + delta
              : e.key === 'ArrowDown'
                ? p.y - delta
                : p.y,
        }));
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Zoom functions
  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev * 1.2, 8));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev / 1.2, 0.15));
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setShowUI(true);
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((prev) => Math.max(0.15, Math.min(8, prev * delta)));
  }, []);

  // Mouse drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scale > 1) {
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
      }
    },
    [scale, position]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch handlers for mobile
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setShowUI(true);
      if (e.touches.length === 2) {
        const a = e.touches.item(0)!;
        const b = e.touches.item(1)!;
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        pinchStartDistanceRef.current = dist;
        pinchStartScaleRef.current = scale;
        return;
      }
      if (e.touches.length === 1 && scale > 1) {
        setIsDragging(true);
        setDragStart({
          x: e.touches[0].clientX - position.x,
          y: e.touches[0].clientY - position.y,
        });
      }
    },
    [scale, position]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDistanceRef.current) {
        e.preventDefault();
        const a = e.touches.item(0)!;
        const b = e.touches.item(1)!;
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const ratio = dist / pinchStartDistanceRef.current;
        setScale(() => {
          const next = Math.min(
            8,
            Math.max(0.15, pinchStartScaleRef.current * ratio)
          );
          return next;
        });
        return;
      }
      if (isDragging && e.touches.length === 1) {
        e.preventDefault();
        setPosition({
          x: e.touches[0].clientX - dragStart.x,
          y: e.touches[0].clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart]
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    pinchStartDistanceRef.current = null;
  }, []);

  // Auto-hide UI after inactivity
  const queueHideUi = useCallback(() => {
    if (hideUiTimerRef.current) clearTimeout(hideUiTimerRef.current);
    hideUiTimerRef.current = setTimeout(() => setShowUI(false), 2400);
  }, []);

  const signalActivity = useCallback(() => {
    setShowUI(true);
    queueHideUi();
  }, [queueHideUi]);

  useEffect(() => {
    if (!isOpen) return;
    queueHideUi();
    return () => {
      if (hideUiTimerRef.current) clearTimeout(hideUiTimerRef.current);
    };
  }, [isOpen, queueHideUi]);

  // Double click / double tap to toggle zoom
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (scale === 1) {
        setScale(2);
      } else {
        resetZoom();
      }
      setShowUI(true);
    },
    [scale, resetZoom]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 text-white"
      onClick={onClose}
      onMouseMove={signalActivity}
      onWheel={signalActivity}
    >
      {/* Close Button */}
      <div
        className={`absolute right-4 top-4 z-20 transition-opacity ${
          showUI ? 'opacity-100' : 'opacity-0'
        } `}
      >
        <IconButton label="Close" onClick={() => onClose()}>
          <X size={18} />
        </IconButton>
      </div>

      {/* Bottom toolbar */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 
        bg-gradient-to-t from-black/70 via-black/30 to-transparent pb-6 pt-24 transition-opacity ${
          showUI ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          <IconButton
            label="Zoom out"
            onClick={() => zoomOut()}
            disabled={scale <= 0.2}
          >
            <ZoomOut size={18} />
          </IconButton>
          <IconButton label="Reset" onClick={() => resetZoom()}>
            <RotateCcw size={18} />
          </IconButton>
          <div className="select-none text-xs tabular-nums text-white/80 w-14 text-center">
            {Math.round(scale * 100)}%
          </div>
          <IconButton
            label="Zoom in"
            onClick={() => zoomIn()}
            disabled={scale >= 8}
          >
            <ZoomIn size={18} />
          </IconButton>
        </div>
        <div className="pointer-events-none select-none text-[10px] font-medium tracking-wide text-white/40">
          Scroll / pinch to zoom · drag to pan · dbl‑click to toggle zoom · Esc
          to close
        </div>
      </div>

      {/* Image container */}
      <div
        ref={containerRef}
        className="relative flex h-full w-full items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'default',
        }}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          className="select-none transition-transform duration-150 ease-out will-change-transform"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            maxWidth: scale === 1 ? '100%' : 'none',
            maxHeight: scale === 1 ? '100%' : 'none',
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}
