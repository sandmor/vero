import { motion } from 'framer-motion';
import { memo } from 'react';
import { cn } from '@/lib/utils';

type LoadingDotsProps = {
  'aria-label'?: string;
  className?: string;
};

const PureLoadingDots = ({
  'aria-label': ariaLabel = 'Loading',
  className,
}: LoadingDotsProps) => (
  <div
    aria-label={ariaLabel}
    className={cn('flex items-center gap-1', className)}
    role="status"
  >
    {[0, 1, 2].map((index) => (
      <motion.span
        animate={{ y: ['0%', '-35%', '0%'] }}
        className="size-2 rounded-full bg-muted-foreground/70"
        key={index}
        transition={{
          duration: 0.6,
          repeat: Number.POSITIVE_INFINITY,
          ease: 'easeInOut',
          delay: index * 0.15,
        }}
      />
    ))}
    <span className="sr-only">{ariaLabel}</span>
  </div>
);

PureLoadingDots.displayName = 'LoadingDots';

export const LoadingDots = memo(PureLoadingDots);

type EmptyMessagePlaceholderProps = {
  className?: string;
  isLoading: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
};

const PureEmptyMessagePlaceholder = ({
  className,
  isLoading,
  loadingLabel = 'Generating response',
  emptyLabel = 'No response generated.',
}: EmptyMessagePlaceholderProps) => (
  <div
    className={cn('flex items-center text-muted-foreground text-sm', className)}
    data-testid="message-empty"
  >
    {isLoading ? (
      <LoadingDots aria-label={loadingLabel} />
    ) : (
      <span>{emptyLabel}</span>
    )}
  </div>
);

PureEmptyMessagePlaceholder.displayName = 'EmptyMessagePlaceholder';

export const EmptyMessagePlaceholder = memo(
  PureEmptyMessagePlaceholder,
  (prevProps, nextProps) => {
    // Only re-render if props that affect rendering actually changed
    return (
      prevProps.className === nextProps.className &&
      prevProps.isLoading === nextProps.isLoading &&
      prevProps.loadingLabel === nextProps.loadingLabel &&
      prevProps.emptyLabel === nextProps.emptyLabel
    );
  }
);
