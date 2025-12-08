'use client';

import type { ComponentType, HTMLAttributes } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import type { SyntaxHighlighterProps } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import { BlockTopBar } from './block-top-bar';

// Align the prism export with the React 19 JSX expectations once to avoid per-use casts.
const PrismSyntaxHighlighter = SyntaxHighlighter as unknown as ComponentType<SyntaxHighlighterProps>;

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: string;
  showLineNumbers?: boolean;
};

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  ...props
}: CodeBlockProps) => (
  <div
    className={cn(
      'relative w-full overflow-hidden rounded-md border bg-background text-foreground',
      className
    )}
    {...props}
  >
    <BlockTopBar title={language} content={code} />
    <div className="relative">
      <PrismSyntaxHighlighter
        className="overflow-hidden dark:hidden"
        codeTagProps={{
          className: 'font-mono text-sm',
        }}
        customStyle={{
          margin: 0,
          padding: '1rem',
          fontSize: '0.875rem',
          background: 'hsl(var(--background))',
          color: 'hsl(var(--foreground))',
          overflowX: 'auto',
          overflowWrap: 'break-word',
          wordBreak: 'break-all',
        }}
        language={language}
        lineNumberStyle={{
          color: 'hsl(var(--muted-foreground))',
          paddingRight: '1rem',
          minWidth: '2.5rem',
        }}
        showLineNumbers={showLineNumbers}
        style={oneLight}
      >
        {code}
      </PrismSyntaxHighlighter>
      <PrismSyntaxHighlighter
        className="hidden overflow-hidden dark:block"
        codeTagProps={{
          className: 'font-mono text-sm',
        }}
        customStyle={{
          margin: 0,
          padding: '1rem',
          fontSize: '0.875rem',
          background: 'hsl(var(--background))',
          color: 'hsl(var(--foreground))',
          overflowX: 'auto',
          overflowWrap: 'break-word',
          wordBreak: 'break-all',
        }}
        language={language}
        lineNumberStyle={{
          color: 'hsl(var(--muted-foreground))',
          paddingRight: '1rem',
          minWidth: '2.5rem',
        }}
        showLineNumbers={showLineNumbers}
        style={oneDark}
      >
        {code}
      </PrismSyntaxHighlighter>
    </div>
  </div>
);
