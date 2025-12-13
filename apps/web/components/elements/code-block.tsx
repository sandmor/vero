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

function getLanguageDisplayName(langId: string): string {
  if (!langId) return '';
  const id = langId.toLowerCase().trim();

  // Exceptions & Acronyms
  const overrides: Record<string, string> = {
    cpp: 'C++',
    abap: 'ABAP',
    cobol: 'COBOL',
    matlab: 'MATLAB',
    graphql: 'GraphQL',
    latex: 'LaTeX',
    powershell: 'PowerShell',
    objectivec: 'Objective-C',
    vbnet: 'VB.NET',
    plsql: 'PL/SQL',
    css: 'CSS',
    sql: 'SQL',
    json: 'JSON',
    xml: 'XML',
    yaml: 'YAML',
    html: 'HTML',
    php: 'PHP',
    toml: 'TOML',
    csv: 'CSV',
    wasm: 'WebAssembly',
    ts: 'TypeScript',
    tsx: 'TSX',
    jsx: 'JSX',
  };

  if (overrides[id]) return overrides[id];

  // Heuristics
  // Handles: csharp, fsharp, qsharp -> C#, F#, Q#
  if (id.endsWith('sharp') && id.length < 8) {
    return id.replace('sharp', '#').toUpperCase();
  }

  // Handles: typescript, coffeescript -> TypeScript, CoffeeScript
  if (id.endsWith('script') && id !== 'script') {
    return capitalize(id.slice(0, -6)) + 'Script';
  }

  // Handles: dns-zone-file, visual-basic -> Dns Zone File, Visual Basic
  if (id.includes('-')) {
    return id.split('-').map(capitalize).join(' ');
  }

  // Fallback: zig, python, java -> Zig, Python, Java
  return capitalize(id);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Align the prism export with the React 19 JSX expectations once to avoid per-use casts.
const PrismSyntaxHighlighter =
  SyntaxHighlighter as unknown as ComponentType<SyntaxHighlighterProps>;

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
    <BlockTopBar title={getLanguageDisplayName(language)} content={code} />
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
