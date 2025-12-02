'use client';

import { useEffect, useState } from 'react';
import { ModelPicker } from '@/components/admin/model-picker';

export function ModelPickerFormFields({
  name,
  defaultValue = [],
}: {
  name: string;
  defaultValue?: string[];
}) {
  const [models, setModels] = useState<string[]>(defaultValue);
  useEffect(() => {
    setModels(defaultValue);
  }, [defaultValue]);
  return (
    <div className="space-y-2">
      <ModelPicker value={models} onChange={setModels} />
      {/* Hidden inputs to submit via parent form */}
      {models.map((id, i) => (
        <input key={`${id}-${i}`} type="hidden" name={name} value={id} />
      ))}
    </div>
  );
}
