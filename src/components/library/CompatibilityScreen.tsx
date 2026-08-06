import { useState } from 'react';
import { CompatibilityDetail } from './CompatibilityDetail';
import { CompatibilityList } from './CompatibilityList';

/** Rota `/library/compatibility` — docs/07-ux-e-editor.md §11. */
export function CompatibilityScreen() {
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);

  if (selectedRuleId !== null) {
    return <CompatibilityDetail ruleId={selectedRuleId} onBack={() => setSelectedRuleId(null)} />;
  }
  return <CompatibilityList onSelect={setSelectedRuleId} />;
}
