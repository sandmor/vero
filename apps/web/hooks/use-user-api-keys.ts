'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChatModelOption } from '@/lib/ai/models';

export type UserApiKeyWithModels = {
  providerId: string;
  apiKey: string;
  selectedModelIds: string[];
};

export function useUserApiKeys() {
  const [userApiKeys, setUserApiKeys] = useState<UserApiKeyWithModels[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUserApiKeys = async () => {
      try {
        const response = await fetch('/api/user/keys');
        if (response.ok) {
          const data = await response.json();
          const selections: Record<string, string[]> =
            data.userSelections ?? {};
          const keys: Record<string, string> = data.keys ?? {};
          const providerIds = new Set([
            ...Object.keys(keys),
            ...Object.keys(selections),
          ]);
          const keysArray: UserApiKeyWithModels[] = Array.from(providerIds).map(
            (providerId) => ({
              providerId,
              apiKey: keys[providerId] ?? '',
              selectedModelIds: selections[providerId] ?? [],
            })
          );
          setUserApiKeys(keysArray);
        }
      } catch (error) {
        console.error('Failed to load user API keys:', error);
      } finally {
        setLoading(false);
      }
    };

    loadUserApiKeys();
  }, []);

  /**
   * Determine which API key will be used for a given model
   * Returns { willUseUserKey: boolean, providerId?: string }
   *
   * BYOK is optional - only used when specific models are selected.
   * If no models selected for a provider's BYOK, global key is used instead.
   */
  const getApiKeyUsageForModel = useCallback(
    (modelId: string) => {
      const [provider] = modelId.split(':');
      const userKey = userApiKeys.find((key) => key.providerId === provider);

      if (!userKey || !userKey.apiKey) {
        return { willUseUserKey: false };
      }

      if (userKey.selectedModelIds.length > 0) {
        const isModelSelected = userKey.selectedModelIds.includes(modelId);
        return {
          willUseUserKey: isModelSelected,
          providerId: provider,
        };
      }

      // If user has a key but did not opt into model-level BYOK, fallback to app key.
      return { willUseUserKey: false };
    },
    [userApiKeys]
  );

  /**
   * Check if a provider has user key configured
   */
  const hasUserKeyForProvider = useCallback(
    (providerId: string) => {
      return userApiKeys.some(
        (key) => key.providerId === providerId && key.apiKey
      );
    },
    [userApiKeys]
  );

  /**
   * Get all models that will use user keys
   */
  const getModelsUsingUserKeys = useCallback(
    (availableModels: ChatModelOption[]) => {
      const modelsUsingUserKeys: string[] = [];

      for (const model of availableModels) {
        const usage = getApiKeyUsageForModel(model.id);
        if (usage.willUseUserKey) {
          modelsUsingUserKeys.push(model.id);
        }
      }

      return modelsUsingUserKeys;
    },
    [getApiKeyUsageForModel]
  );

  return {
    userApiKeys,
    loading,
    getApiKeyUsageForModel,
    hasUserKeyForProvider,
    getModelsUsingUserKeys,
  };
}
