export const CODE_LANGUAGE_IDS = [
  'python',
  'javascript',
  'typescript',
  'java',
  'csharp',
  'cpp',
  'go',
  'rust',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'scala',
  'bash',
  'shell',
  'powershell',
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGE_IDS)[number];

export type CodeLanguageDefinition = {
  id: CodeLanguage;
  label: string;
  aliases: string[];
};

export const CODE_LANGUAGES: CodeLanguageDefinition[] = [
  { id: 'python', label: 'Python', aliases: ['python', 'py'] },
  {
    id: 'javascript',
    label: 'JavaScript',
    aliases: ['javascript', 'js', 'node.js', 'nodejs', 'node'],
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    aliases: ['typescript', 'ts'],
  },
  { id: 'java', label: 'Java', aliases: ['java'] },
  { id: 'csharp', label: 'C#', aliases: ['c#', 'c sharp', 'csharp', 'dotnet'] },
  { id: 'cpp', label: 'C++', aliases: ['c++', 'cpp'] },
  { id: 'go', label: 'Go', aliases: ['go', 'golang'] },
  { id: 'rust', label: 'Rust', aliases: ['rust'] },
  { id: 'ruby', label: 'Ruby', aliases: ['ruby', 'rb'] },
  { id: 'php', label: 'PHP', aliases: ['php'] },
  { id: 'swift', label: 'Swift', aliases: ['swift'] },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kotlin'] },
  { id: 'scala', label: 'Scala', aliases: ['scala'] },
  { id: 'bash', label: 'Bash', aliases: ['bash'] },
  { id: 'shell', label: 'Shell', aliases: ['shell', 'sh'] },
  {
    id: 'powershell',
    label: 'PowerShell',
    aliases: ['powershell', 'ps', 'ps1'],
  },
];

export const EXECUTION_SUPPORTED_LANGUAGES: CodeLanguage[] = ['python'];

function escapeAlias(alias: string) {
  return alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectCodeLanguageFromText(text: string): CodeLanguage | null {
  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase();

  for (const definition of CODE_LANGUAGES) {
    for (const alias of definition.aliases) {
      const pattern = new RegExp(
        `(?:^|[^a-z0-9_])${escapeAlias(alias)}(?:$|[^a-z0-9_])`
      );
      if (pattern.test(normalized)) {
        return definition.id;
      }
    }
  }

  return null;
}

export function isExecutionSupported(language: string | undefined | null) {
  if (!language) return false;
  return EXECUTION_SUPPORTED_LANGUAGES.includes(language as CodeLanguage);
}

export function coerceCodeLanguage(value: unknown): CodeLanguage | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.toLowerCase();
  for (const definition of CODE_LANGUAGES) {
    if (definition.id === normalized) {
      return definition.id;
    }
    if (
      definition.aliases.some((alias) => alias.toLowerCase() === normalized)
    ) {
      return definition.id;
    }
  }
  return null;
}
