'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isByokModelId } from '@/lib/ai/byok';

type ByokModel = {
  id: string;
  fullModelId: string;
  sourceType: 'platform' | 'custom';
  providerId: string | null;
  customProviderId: string | null;
  providerModelId: string;
  displayName: string;
  supportsTools: boolean;
};

export function useByokModels() {
  const { data, isLoading } = useQuery({
    queryKey: ['byok-models'],
    queryFn: async () => {
      const res = await fetch('/api/user/byok/models');
      if (!res.ok) return { models: [] };
      return res.json() as Promise<{ models: ByokModel[] }>;
    },
    staleTime: 60_000, // 1 minute
  });

  const models = data?.models ?? [];
  const modelIds = models.map((m) => m.fullModelId);

  /**
   * Check if a model ID is a BYOK model that the user has configured
   */
  const isUserByokModel = useCallback(
    (modelId: string): boolean => {
      if (!isByokModelId(modelId)) return false;
      return modelIds.includes(modelId);
    },
    [modelIds]
  );

  /**
   * Get the display name for a BYOK model
   */
  const getByokModelDisplayName = useCallback(
    (modelId: string): string | null => {
      const model = models.find((m) => m.fullModelId === modelId);
      return model?.displayName ?? null;
    },
    [models]
  );

  /**
   * Legacy-compatible: Determine which API key will be used for a given model.
   * In the new BYOK system, any model starting with "byok:" uses the user's key.
   */
  const getApiKeyUsageForModel = useCallback(
    (modelId: string): { willUseUserKey: boolean } => {
      return { willUseUserKey: isByokModelId(modelId) };
    },
    []
  );

  return {
    models,
    modelIds,
    isLoading,
    isUserByokModel,
    getByokModelDisplayName,
    getApiKeyUsageForModel,
  };
}
