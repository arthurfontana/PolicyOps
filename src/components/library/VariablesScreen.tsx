import { useEffect, useState } from 'react';
import { VariableDetail } from './VariableDetail';
import { VariablesList } from './VariablesList';
import { useEditorStore } from '@/store/editor-store';

/** Rota `/library/variables` — docs/07-ux-e-editor.md §11. */
export function VariablesScreen() {
  const [selectedVariableId, setSelectedVariableId] = useState<string | null>(null);
  const pendingVariableFocus = useEditorStore((s) => s.pendingVariableFocus);
  const requestVariableFocus = useEditorStore((s) => s.requestVariableFocus);

  // "Ir para a Biblioteca" do inspector de POLICY_VARIABLE (docs/07 §17.5):
  // abre direto no detalhe da variável espelhada, mesmo padrão de
  // `pendingResnapshot` para o eixo.
  useEffect(() => {
    if (pendingVariableFocus === null) return;
    setSelectedVariableId(pendingVariableFocus);
    requestVariableFocus(null);
  }, [pendingVariableFocus, requestVariableFocus]);

  if (selectedVariableId !== null) {
    return <VariableDetail variableId={selectedVariableId} onBack={() => setSelectedVariableId(null)} />;
  }
  return <VariablesList onSelect={setSelectedVariableId} />;
}
