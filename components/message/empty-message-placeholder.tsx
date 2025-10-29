import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

type LoadingDotsProps = {
  'aria-label'?: string;
  className?: string;
};

export const LoadingDots = ({
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

type EmptyMessagePlaceholderProps = {
  className?: string;
  isLoading: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
};

export const EmptyMessagePlaceholder = ({
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
