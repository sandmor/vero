import { prisma } from '@vero/db';

type Settings = {
  maxMessageLength: number;
  maxOutputTokens: number;
};

// Default values for settings
const defaultSettings: Settings = {
  maxMessageLength: 16000,
  maxOutputTokens: 4096,
};

async function getRawSetting(key: string): Promise<string | undefined> {
  try {
    const setting = await prisma.setting.findUnique({
      where: { id: key },
    });
    return setting?.value;
  } catch (error) {
    // In case of database errors, return undefined
    console.error(`Failed to get setting ${key}:`, error);
    return undefined;
  }
}

export async function getSettings(): Promise<Settings> {
  const maxMessageLengthRaw = await getRawSetting('maxMessageLength');
  const maxOutputTokensRaw = await getRawSetting('maxOutputTokens');

  const maxMessageLength =
    parseInt(maxMessageLengthRaw ?? '', 10) || defaultSettings.maxMessageLength;
  const maxOutputTokens =
    parseInt(maxOutputTokensRaw ?? '', 10) || defaultSettings.maxOutputTokens;

  return {
    maxMessageLength:
      maxMessageLength < 1
        ? defaultSettings.maxMessageLength
        : maxMessageLength,
    maxOutputTokens:
      maxOutputTokens < 1 ? defaultSettings.maxOutputTokens : maxOutputTokens,
  };
}
