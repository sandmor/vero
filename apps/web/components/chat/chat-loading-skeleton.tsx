import { Skeleton } from '@/components/ui/skeleton';

type ChatLoadingSkeletonProps = {
  variant?: 'existing' | 'new';
};

// Visual placeholder that mirrors the live chat layout while data is loading.
export function ChatLoadingSkeleton({
  variant = 'existing',
}: ChatLoadingSkeletonProps) {
  if (variant === 'new') {
    return <NewChatSkeleton />;
  }

  return (
    <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
      <HeaderSkeleton />

      <div className="overscroll-behavior-contain -webkit-overflow-scrolling-touch flex-1 touch-pan-y overflow-y-scroll">
        <div className="mx-auto flex min-w-0 max-w-4xl flex-col gap-4 px-2 py-4 md:gap-6 md:px-4">
          <ThreadSkeleton />
        </div>
      </div>

      <ComposerSkeleton />
    </div>
  );
}

function NewChatSkeleton() {
  return (
    <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
      <HeaderSkeleton />

      <div className="overscroll-behavior-contain -webkit-overflow-scrolling-touch flex-1 touch-pan-y overflow-y-scroll">
        <div className="mx-auto flex min-w-0 max-w-4xl flex-1 flex-col gap-4 px-2 py-6 md:gap-6 md:px-4">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 md:px-8">
            <div className="space-y-4 md:space-y-5">
              <Skeleton className="h-7 w-40 rounded-lg md:h-8 md:w-52" />
              <Skeleton className="h-4 w-64 rounded-lg md:h-5 md:w-80" />
              <Skeleton className="h-4 w-52 rounded-lg md:h-5 md:w-64" />
            </div>
          </div>
        </div>
      </div>

      <ComposerSkeleton />
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 bg-background/95 px-2 py-1.5 shadow-sm md:px-2">
      <Skeleton className="h-9 w-9 rounded-lg" />
      <Skeleton className="h-8 w-24 rounded-lg" />
      <div className="ml-auto hidden items-center gap-2 md:flex">
        <Skeleton className="h-8 w-36 rounded-lg" />
        <Skeleton className="h-8 w-32 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
      <Skeleton className="ml-auto h-9 w-9 rounded-lg md:hidden" />
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-3">
        <Skeleton className="h-5 w-40 rounded-full" />
        <MessageBubbleSkeleton lines={['w-5/6', 'w-11/12', 'w-4/5']} />
      </div>

      <MessageBubbleSkeleton lines={['w-9/12', 'w-10/12']} metadataLines={2} />

      <MessageBubbleSkeleton
        attachment
        lines={['w-11/12', 'w-5/6', 'w-2/3']}
        metadataLines={3}
      />

      <MessageBubbleSkeleton
        variant="assistant"
        lines={['w-10/12', 'w-8/12', 'w-6/12']}
      />

      <ThinkingSkeleton />
    </div>
  );
}

function MessageBubbleSkeleton({
  variant = 'assistant',
  lines,
  attachment = false,
  metadataLines = 1,
}: {
  variant?: 'assistant' | 'user';
  lines: string[];
  attachment?: boolean;
  metadataLines?: number;
}) {
  return (
    <div className="flex w-full items-start gap-3 md:gap-4">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="flex w-full flex-col gap-3">
        {attachment ? (
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-20 w-40 rounded-xl" />
            <Skeleton className="h-20 w-32 rounded-xl" />
          </div>
        ) : null}
        <div
          className="rounded-2xl border border-border/60 bg-muted/30 p-4 shadow-sm dark:bg-muted/20"
          data-variant={variant}
        >
          <div className="flex flex-col gap-3">
            {lines.map((width, index) => (
              <Skeleton
                aria-hidden
                className={`h-4 ${width}`}
                key={`line-${index}`}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: metadataLines }).map((_, index) => (
            <Skeleton className="h-6 w-20 rounded-full" key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThinkingSkeleton() {
  return (
    <div className="flex items-start gap-3 md:gap-4">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-3 rounded-full" />
          <Skeleton className="h-3 w-3 rounded-full" />
          <Skeleton className="h-3 w-3 rounded-full" />
        </div>
        <Skeleton className="h-3 w-24 rounded-full" />
      </div>
    </div>
  );
}

function ComposerSkeleton() {
  return (
    <div className="sticky bottom-0 z-20 mx-auto flex w-full max-w-4xl gap-2 bg-background/95 px-2 pb-3 pt-2 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.35)] backdrop-blur md:px-4 md:pb-4">
      <div className="flex w-full flex-col gap-3 rounded-2xl border border-border/70 bg-background/80 p-3 md:p-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
