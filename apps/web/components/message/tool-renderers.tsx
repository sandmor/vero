import type { ReactNode } from 'react';
import { memo } from 'react';
import equal from 'fast-deep-equal';

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/elements/tool';
import { CodeBlock } from '@/components/elements/code-block';
import { Weather } from '@/components/weather';
import type { ChatMessage } from '@/lib/types';
import type { ExecutionResult } from '@/lib/ai/tools/sandbox/types';
import type { SerializableError } from '@/lib/ai/tools/sandbox/errors';

type MessagePart = NonNullable<ChatMessage['parts']>[number];
export type ToolPart = Extract<MessagePart, { type: `tool-${string}` }>; // covers every tool emitted part

export type ToolRendererContext = {
  isReadonly: boolean;
};

type ArchivePart = Extract<
  ToolPart,
  { type: 'tool-readArchive' | 'tool-writeArchive' | 'tool-manageChatPins' }
>;

type WeatherPart = Extract<ToolPart, { type: 'tool-getWeather' }>;

type RunCodePart = Extract<ToolPart, { type: 'tool-runCode' }>;

const sectionTitleClass =
  'font-medium text-muted-foreground text-xs uppercase tracking-wide';

const isExecutionResult = (value: unknown): value is ExecutionResult => {
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  return status === 'ok' || status === 'error';
};

const formatSerializableError = (
  error: SerializableError | null | undefined
) => {
  if (!error) return undefined;
  const parts = [error.name, error.message].filter(Boolean);
  return parts.length ? parts.join(': ') : undefined;
};

const WeatherRenderer = memo(
  ({ part }: { part: WeatherPart }) => {
    const { toolCallId, state, input, output } = part;
    const isRecord =
      output && typeof output === 'object' && !Array.isArray(output);
    const explicitError =
      output && typeof output === 'object' && 'error' in output
        ? String((output as { error: unknown }).error)
        : undefined;
    const errorText =
      state === 'output-error'
        ? (part.errorText ?? explicitError)
        : explicitError;
    const canRenderWeather = Boolean(!errorText && isRecord);

    return (
      <Tool
        className="w-full max-w-full overflow-hidden"
        defaultOpen
        key={toolCallId}
      >
        <ToolHeader state={state} type="tool-getWeather" />
        <ToolContent>
          {state === 'input-available' ? (
            <ToolInput input={input ?? {}} />
          ) : null}
          {state === 'output-available' ? (
            <ToolOutput
              errorText={errorText}
              output={
                canRenderWeather ? <Weather weatherAtLocation={output} /> : null
              }
            />
          ) : null}
          {state === 'output-error' ? (
            <ToolOutput
              errorText={errorText ?? 'Unable to retrieve weather data.'}
            />
          ) : null}
        </ToolContent>
      </Tool>
    );
  },
  (prevProps, nextProps) => equal(prevProps.part, nextProps.part)
);

WeatherRenderer.displayName = 'WeatherRenderer';

const ArchiveRenderer = memo(
  ({ part }: { part: ArchivePart }) => {
    const { toolCallId, type, state, input, output, errorText } = part;
    const outputHasError =
      output &&
      typeof output === 'object' &&
      !Array.isArray(output) &&
      'error' in output;
    const derivedError = outputHasError
      ? String((output as { error: unknown }).error ?? '')
      : undefined;

    return (
      <Tool
        className="w-full max-w-full overflow-hidden"
        defaultOpen
        key={toolCallId}
      >
        <ToolHeader state={state} type={type} />
        <ToolContent>
          <ToolInput input={input ?? {}} />
          {state === 'output-available' || state === 'output-error' ? (
            <ToolOutput
              errorText={
                state === 'output-error'
                  ? (errorText ?? derivedError)
                  : derivedError
              }
              output={
                state === 'output-available' && !outputHasError && output ? (
                  <CodeBlock
                    code={JSON.stringify(output, null, 2)}
                    language="json"
                  />
                ) : null
              }
            />
          ) : null}
        </ToolContent>
      </Tool>
    );
  },
  (prevProps, nextProps) => equal(prevProps.part, nextProps.part)
);

ArchiveRenderer.displayName = 'ArchiveRenderer';

const RunCodeRenderer = memo(
  ({ part }: { part: RunCodePart }) => {
    const { toolCallId, state, input, output, errorText } = part;
    const execution = isExecutionResult(output) ? output : undefined;
    const executionError =
      execution?.status === 'error' ? execution.error : null;
    const stdout = execution?.stdout ?? [];
    const stderr = execution?.stderr ?? [];
    const truncatedStdout = execution?.truncatedStdout ?? 0;
    const truncatedStderr = execution?.truncatedStderr ?? 0;
    const runtimeMs = execution?.runtimeMs;
    const codeSize = execution?.codeSize;
    const environment = execution?.environment;

    const code =
      input && typeof input === 'object' && 'code' in input
        ? String((input as { code?: unknown }).code ?? '')
        : '';
    const timeoutMs =
      input && typeof input === 'object' && 'timeoutMs' in input
        ? (input as { timeoutMs?: number }).timeoutMs
        : undefined;

    const derivedError =
      formatSerializableError(executionError ?? null) ?? errorText ?? undefined;

    return (
      <Tool
        className="w-full max-w-full overflow-hidden"
        defaultOpen
        key={toolCallId}
      >
        <ToolHeader state={state} type="tool-runCode" />
        <ToolContent className="[&_pre]:max-w-full [&_pre]:wrap-break-word">
          {(state === 'input-available' ||
            state === 'output-available' ||
            state === 'output-error') &&
          code ? (
            <div className="space-y-2 p-4">
              <h4 className={sectionTitleClass}>Code Executed</h4>
              <CodeBlock code={code} language="typescript" />
              {timeoutMs ? (
                <p className="text-muted-foreground text-xs">
                  Timeout: {timeoutMs}ms
                </p>
              ) : null}
            </div>
          ) : null}

          {state === 'output-available' && execution ? (
            <div className="space-y-4 p-4 pt-0">
              {execution.result !== null && execution.result !== undefined ? (
                <div className="space-y-2">
                  <h4 className={sectionTitleClass}>Result</h4>
                  <div className="rounded-md bg-green-500/10 p-3">
                    <pre className="max-w-full overflow-x-auto font-mono text-xs">
                      {typeof execution.result === 'object'
                        ? JSON.stringify(execution.result, null, 2)
                        : String(execution.result)}
                    </pre>
                  </div>
                </div>
              ) : null}

              {stdout.length ? (
                <div className="space-y-2">
                  <h4 className={sectionTitleClass}>Console Output</h4>
                  <div className="rounded-md bg-muted/50 p-3">
                    <pre className="max-w-full overflow-x-auto font-mono text-xs">
                      {stdout.join('\n')}
                    </pre>
                  </div>
                  {truncatedStdout > 0 ? (
                    <p className="text-muted-foreground text-xs">
                      +{truncatedStdout} more lines truncated
                    </p>
                  ) : null}
                </div>
              ) : null}

              {stderr.length ? (
                <div className="space-y-2">
                  <h4 className={sectionTitleClass}>Error Output</h4>
                  <div className="rounded-md bg-red-500/10 p-3">
                    <pre className="max-w-full overflow-x-auto font-mono text-xs text-red-600 dark:text-red-400">
                      {stderr.join('\n')}
                    </pre>
                  </div>
                  {truncatedStderr > 0 ? (
                    <p className="text-muted-foreground text-xs">
                      +{truncatedStderr} more lines truncated
                    </p>
                  ) : null}
                </div>
              ) : null}

              {environment ? (
                <div className="space-y-2">
                  <h4 className={sectionTitleClass}>Execution Info</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {runtimeMs ? (
                      <div className="rounded-md bg-muted/30 p-2">
                        <span className="text-muted-foreground">Runtime:</span>{' '}
                        <span className="font-medium">{runtimeMs}ms</span>
                      </div>
                    ) : null}
                    {environment.language ? (
                      <div className="rounded-md bg-muted/30 p-2">
                        <span className="text-muted-foreground">Language:</span>{' '}
                        <span className="font-medium">
                          {environment.language}
                        </span>
                      </div>
                    ) : null}
                    {environment.timeoutMs ? (
                      <div className="rounded-md bg-muted/30 p-2">
                        <span className="text-muted-foreground">Timeout:</span>{' '}
                        <span className="font-medium">
                          {environment.timeoutMs}ms
                        </span>
                      </div>
                    ) : null}
                    {codeSize ? (
                      <div className="rounded-md bg-muted/30 p-2">
                        <span className="text-muted-foreground">
                          Code Size:
                        </span>{' '}
                        <span className="font-medium">{codeSize} chars</span>
                      </div>
                    ) : null}
                  </div>
                  {environment.warnings && environment.warnings.length ? (
                    <div className="mt-2 rounded-md bg-yellow-500/10 p-2">
                      <p className="font-medium text-xs text-yellow-700 dark:text-yellow-400">
                        ⚠️ Warnings:
                      </p>
                      <ul className="ml-4 mt-1 list-disc text-xs text-yellow-600 dark:text-yellow-300">
                        {environment.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {executionError ? (
                <div className="space-y-2">
                  <h4 className={sectionTitleClass}>Execution Error</h4>
                  <div className="rounded-md bg-red-500/10 p-3">
                    <p className="font-medium text-xs text-red-600 dark:text-red-400">
                      {executionError.name}: {executionError.message}
                    </p>
                    {executionError.stack ? (
                      <pre className="mt-2 max-w-full overflow-x-auto font-mono text-xs text-red-500">
                        {executionError.stack}
                      </pre>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {state === 'output-error' ? (
            <ToolOutput
              className="pt-0"
              errorText={derivedError ?? 'Code execution failed.'}
            />
          ) : null}
        </ToolContent>
      </Tool>
    );
  },
  (prevProps, nextProps) => equal(prevProps.part, nextProps.part)
);

RunCodeRenderer.displayName = 'RunCodeRenderer';

export const renderToolPart = (
  part: ToolPart,
  context: ToolRendererContext
): ReactNode => {
  switch (part.type) {
    case 'tool-getWeather':
      return <WeatherRenderer key={part.toolCallId} part={part} />;
    case 'tool-readArchive':
    case 'tool-writeArchive':
    case 'tool-manageChatPins':
      return <ArchiveRenderer key={part.toolCallId} part={part} />;

    case 'tool-runCode':
      return <RunCodeRenderer key={part.toolCallId} part={part} />;
    default:
      return null;
  }
};
