'use client';

import { type ComponentProps, memo } from 'react';
import { Streamdown } from 'streamdown';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import { useTheme } from 'next-themes';
import { cn, normalizeLatexMathDelimiters } from '@/lib/utils';
import { CodeBlock } from './code-block';
import { TableView } from './table-view';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
    remarkGfm,
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
    components: {
      ...((props as any).components || {}),
      table: (props: any) => <TableView {...props} />,
      thead: ({ node, ...props }: any) => <TableHeader {...props} />,
      tbody: ({ node, ...props }: any) => <TableBody {...props} />,
      tr: ({ node, ...props }: any) => <TableRow {...props} />,
      th: ({ node, ...props }: any) => <TableHead {...props} />,
      td: ({ node, ...props }: any) => <TableCell {...props} />,
      code: ({ node, inline, className, children, ...props }: any) => {
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : '';
        const codeContent = String(children).replace(/\n$/, '');

        if (!inline && (language === 'tsv' || language === 'csv')) {
          return <TableView content={codeContent} />;
        }

        if (!inline && match) {
          return (
            <CodeBlock
              language={language}
              code={codeContent}
              className="my-4"
              {...props}
            />
          );
        }

        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    },
  } as typeof props & { remarkPlugins: any[] };

  return (
    <Streamdown
      key={mermaidTheme}
      className={cn(
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:break-words [&_.katex-display]:px-2 [&_.katex-display]:py-3 [&_.katex-display]:rounded-md [&_.katex-display]:bg-muted/40 [&_code]:whitespace-pre-wrap [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto',
        className
      )}
      mode='static'
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
