'use client';

import { type ComponentProps, memo } from 'react';
import { Streamdown } from 'streamdown';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import { useTheme } from 'next-themes';
import { cn, normalizeLatexMathDelimiters } from '@/lib/utils';

export type MarkdownProps = ComponentProps<typeof Streamdown>;

const MarkdownComponent = ({
  className,
  children,
  ...props
}: MarkdownProps) => {
  const { resolvedTheme } = useTheme();
  const mermaidTheme = resolvedTheme === 'dark' ? 'dark' : 'default';
  let content = children;

  if (typeof content === 'string') {
    content = normalizeLatexMathDelimiters(content);
  }

  const extraRemarkPlugins: any[] = [
    remarkBreaks,
    [remarkMath, { singleDollarTextMath: true }],
  ];

  const mergedProps = {
    ...props,
    remarkPlugins: [
      ...(Array.isArray((props as any).remarkPlugins)
        ? (props as any).remarkPlugins
        : []),
      ...extraRemarkPlugins,
    ],
    mermaidConfig: {
      theme: mermaidTheme,
    },
  } as typeof props & { remarkPlugins: any[] };

  return (
    <Streamdown
      key={mermaidTheme}
      className={cn(
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:break-words [&_.katex-display]:px-2 [&_.katex-display]:py-3 [&_.katex-display]:rounded-md [&_.katex-display]:bg-muted/40 [&_code]:whitespace-pre-wrap [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto',
        className
      )}
      {...mergedProps}
    >
      {content}
    </Streamdown>
  );
};

export const Markdown = memo(
  MarkdownComponent,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.className === nextProps.className
);

Markdown.displayName = 'Markdown';
