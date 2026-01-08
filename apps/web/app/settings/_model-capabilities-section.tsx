import {
  getManagedModels,
  getAllCatalogEntries,
} from '@/lib/ai/model-capabilities';
import { ModelCapabilitiesManager } from '@/components/admin/model-capabilities-manager';

export const dynamic = 'force-dynamic';

export default async function ModelCapabilitiesSection() {
  const [models, catalog] = await Promise.all([
    getManagedModels(),
    getAllCatalogEntries(),
  ]);

  return (
    <section className="space-y-5 rounded-3xl border border-border/60 bg-muted/10 p-6 shadow-sm backdrop-blur-sm">
      <ModelCapabilitiesManager
        initialModels={models}
        initialCatalog={catalog}
      />
    </section>
  );
}
