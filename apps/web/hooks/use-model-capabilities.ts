import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ManagedModelCapabilities,
  ModelFormat,
  ModelPricing,
} from '@/lib/ai/model-capabilities';

type ManagedModelCapabilitiesResponse = ManagedModelCapabilities[];
type SyncResponse = {
  synced: number;
  removed?: number;
  errors?: string[];
  details?: Record<string, { synced: number; removed?: number; errors: string[] }>;
};

export function useManagedModels() {
  return useQuery<ManagedModelCapabilitiesResponse>({
    queryKey: ['admin', 'model-capabilities'],
    queryFn: async () => {
      const res = await fetch('/api/admin/model-capabilities');
      if (!res.ok) throw new Error('Failed to fetch models');
      return res.json();
    },
    staleTime: 60000,
  });
}

export function useModelMutation() {
  const queryClient = useQueryClient();

  const createModel = useMutation({
    mutationFn: async (data: {
      id: string;
      name: string;
      creator: string;
      supportsTools?: boolean;
      supportedFormats?: ModelFormat[];
      maxOutputTokens?: number | null;
    }) => {
      const res = await fetch('/api/admin/model-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create model');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'model-capabilities'],
      });
    },
  });

  const updateModel = useMutation({
    mutationFn: async (data: {
      id: string;
      name?: string;
      creator?: string;
      supportsTools?: boolean;
      supportedFormats?: ModelFormat[];
      maxOutputTokens?: number | null;
    }) => {
      const { id, ...body } = data;
      const res = await fetch(`/api/admin/model-capabilities/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update model');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'model-capabilities'],
      });
    },
  });

  const deleteModel = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/model-capabilities/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete model');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'model-capabilities'],
      });
    },
  });

  return { createModel, updateModel, deleteModel };
}

export function useProviderMutation() {
  const queryClient = useQueryClient();

  const addProvider = useMutation({
    mutationFn: async (data: {
      modelId: string;
      providerId: string;
      providerModelId: string;
      pricing?: ModelPricing;
      isDefault?: boolean;
      customPlatformProviderId?: string;
    }) => {
      const { modelId, ...body } = data;
      const res = await fetch(
        `/api/admin/model-capabilities/${modelId}/providers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to add provider');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'model-capabilities'],
      });
    },
  });

  const updateProvider = useMutation({
    mutationFn: async (data: {
      modelId: string;
      providerId: string;
      providerModelId?: string;
      pricing?: ModelPricing | null;
      isDefault?: boolean;
      enabled?: boolean;
    }) => {
      const { modelId, providerId, ...body } = data;
      const res = await fetch(
        `/api/admin/model-capabilities/${modelId}/providers/${providerId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update provider');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'model-capabilities'],
      });
    },
  });

  const removeProvider = useMutation({
    mutationFn: async (data: { modelId: string; providerId: string }) => {
      const { modelId, providerId } = data;
      const res = await fetch(
        `/api/admin/model-capabilities/${modelId}/providers/${providerId}`,
        {
          method: 'DELETE',
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to remove provider');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'model-capabilities'],
      });
    },
  });

  return { addProvider, updateProvider, removeProvider };
}

/**
 * Sync source options:
 * - 'openrouter': Sync only OpenRouter models
 * - 'models.dev': Sync models.dev providers (optionally specify a specific provider)
 * - 'all': Sync both OpenRouter and all models.dev providers
 */
export type SyncSource = 'openrouter' | 'models.dev' | 'all';

export function useCatalogSync() {
  const queryClient = useQueryClient();

  const syncCatalog = useMutation({
    mutationFn: async (data: {
      source: SyncSource;
      provider?: string;
    }) => {
      const res = await fetch('/api/admin/model-capabilities/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to sync catalog');
      }
      return res.json() as Promise<SyncResponse>;
    },
    onSuccess: () => {
      // Invalidate catalog queries after sync
      queryClient.invalidateQueries({
        queryKey: ['admin', 'catalog'],
      });
      queryClient.invalidateQueries({
        queryKey: ['admin', 'model-capabilities', 'catalog'],
      });
    },
  });

  const pruneModels = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/model-capabilities/prune', {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to prune models');
      }
      return res.json() as Promise<{ removed: number }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'model-capabilities'],
      });
    },
  });

  return { syncCatalog, pruneModels };
}
