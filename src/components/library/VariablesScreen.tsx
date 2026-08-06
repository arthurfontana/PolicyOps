import { useState } from 'react';
import { VariableDetail } from './VariableDetail';
import { VariablesList } from './VariablesList';

/** Rota `/library/variables` — docs/07-ux-e-editor.md §11. */
export function VariablesScreen() {
  const [selectedVariableId, setSelectedVariableId] = useState<string | null>(null);

  if (selectedVariableId !== null) {
    return <VariableDetail variableId={selectedVariableId} onBack={() => setSelectedVariableId(null)} />;
  }
  return <VariablesList onSelect={setSelectedVariableId} />;
}
