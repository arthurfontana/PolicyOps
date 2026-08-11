import { useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { columnsWithRole, type DecisionRule, type TagRule } from '@/core/import/profile';
import { useDocumentStore } from '@/store/document-store';
import { useImportStore } from '@/store/import-store';

/** Passo 4 — conteúdo. docs/12-carga-de-matrizes.md US-05 (RN-11), RN-07, US-09. */
export function Step4Content() {
  const document = useDocumentStore((s) => s.document);
  const profile = useImportStore((s) => s.profile);
  const setDecisionRules = useImportStore((s) => s.setDecisionRules);
  const setMissingRowPolicy = useImportStore((s) => s.setMissingRowPolicy);
  const setTagRules = useImportStore((s) => s.setTagRules);

  useEffect(() => {
    const partitionColumns = columnsWithRole(profile, 'PARTITION').map((c) => c.column);
    const wantedKeys = new Set<string>([
      ...partitionColumns.map((column) => `PARTITION:${column}`),
      ...(profile.unpivot !== undefined ? ['UNPIVOT'] : []),
    ]);
    const currentKeys = new Set(
      profile.tagRules.map((rule) => (rule.source === 'PARTITION' ? `PARTITION:${rule.column}` : rule.source)),
    );
    const same = wantedKeys.size === currentKeys.size && [...wantedKeys].every((key) => currentKeys.has(key));
    if (same) return;
    const next: TagRule[] = [
      ...partitionColumns.map(
        (column): TagRule =>
          profile.tagRules.find((rule) => rule.source === 'PARTITION' && rule.column === column) ?? {
            source: 'PARTITION',
            column,
            group: column,
            codePrefix: '',
          },
      ),
      ...(profile.unpivot !== undefined
        ? [
            profile.tagRules.find((rule) => rule.source === 'UNPIVOT') ?? {
              source: 'UNPIVOT' as const,
              group: profile.unpivot.label,
              codePrefix: '',
            },
          ]
        : []),
    ];
    setTagRules(next);
  }, [profile, setTagRules]);

  if (document === null) return null;

  const offers = document.catalog.filter((item) => item.kind === 'OFFER' && item.archivedAt === undefined);
  const decisions = document.catalog.filter((item) => item.kind === 'DECISION' && item.archivedAt === undefined);

  const whenRules = profile.decisionRules.filter(
    (rule): rule is Extract<DecisionRule, { when: unknown }> => 'when' in rule,
  );
  const otherwise = profile.decisionRules.find((rule): rule is Extract<DecisionRule, { otherwise: string }> =>
    'otherwise' in rule,
  );

  function updateWhenRule(index: number, patch: Partial<{ equals: string[]; setDecision: string }>) {
    const next = whenRules.map((rule, i) =>
      i === index ? { when: { field: 'offer' as const, equals: patch.equals ?? rule.when.equals }, setDecision: patch.setDecision ?? rule.setDecision } : rule,
    );
    setDecisionRules([...next, ...(otherwise !== undefined ? [otherwise] : [])]);
  }

  function addWhenRule() {
    const next: DecisionRule = { when: { field: 'offer', equals: [] }, setDecision: decisions[0]?.code ?? '' };
    setDecisionRules([...whenRules, next, ...(otherwise !== undefined ? [otherwise] : [])]);
  }

  function removeWhenRule(index: number) {
    setDecisionRules([...whenRules.filter((_, i) => i !== index), ...(otherwise !== undefined ? [otherwise] : [])]);
  }

  function setOtherwise(code: string) {
    setDecisionRules([...whenRules, { otherwise: code }]);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Regras de decisão (oferta → decisão)
            </h3>
            <Button type="button" variant="outline" size="sm" onClick={addWhenRule}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar regra
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ofertas</TableHead>
                <TableHead>Decisão</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {whenRules.map((rule, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {offers.map((offer) => (
                        <label key={offer.code} className="flex items-center gap-1 text-xs">
                          <Checkbox
                            checked={rule.when.equals.includes(offer.code)}
                            onCheckedChange={(checked) => {
                              const equals =
                                checked === true
                                  ? [...rule.when.equals, offer.code]
                                  : rule.when.equals.filter((code) => code !== offer.code);
                              updateWhenRule(index, { equals });
                            }}
                          />
                          {offer.code}
                        </label>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="w-48">
                    <Select value={rule.setDecision || undefined} onValueChange={(value) => updateWhenRule(index, { setDecision: value })}>
                      <SelectTrigger aria-label={`Decisão da regra ${index + 1}`}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {decisions.map((decision) => (
                          <SelectItem key={decision.code} value={decision.code}>
                            {decision.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" aria-label="Remover regra" onClick={() => removeWhenRule(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="text-xs italic text-neutral-500 dark:text-neutral-400">demais ofertas</TableCell>
                <TableCell className="w-48">
                  <Select value={otherwise?.otherwise || undefined} onValueChange={setOtherwise}>
                    <SelectTrigger aria-label="Decisão padrão (otherwise)">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {decisions.map((decision) => (
                        <SelectItem key={decision.code} value={decision.code}>
                          {decision.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Combinação sem linha no arquivo
          </h3>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">Política para combinações sem linha no arquivo</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="missing-row-policy"
                className="mt-0.5"
                checked={profile.missingRowPolicy === 'KEEP'}
                onChange={() => setMissingRowPolicy('KEEP')}
              />
              <span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">Preservar</span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {' '}
                  — o conteúdo atual da célula não é tocado (padrão, RN-07).
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="missing-row-policy"
                className="mt-0.5"
                checked={profile.missingRowPolicy === 'CLEAR'}
                onChange={() => setMissingRowPolicy('CLEAR')}
              />
              <span>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">Esvaziar</span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {' '}
                  — a célula fica vazia quando o arquivo não traz a combinação.
                </span>
              </span>
            </label>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Regras de tag (perfil apenas — S23 aplica no documento)
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Origem</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Prefixo de código</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profile.tagRules.map((rule, index) => (
                <TableRow key={index}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {rule.source === 'PARTITION' ? rule.column : profile.unpivot?.label ?? 'Desdobramento'}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="w-40"
                      value={rule.group}
                      onChange={(event) => {
                        const next = [...profile.tagRules];
                        next[index] = { ...rule, group: event.target.value };
                        setTagRules(next);
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="w-32"
                      value={rule.codePrefix ?? ''}
                      onChange={(event) => {
                        const next = [...profile.tagRules];
                        next[index] = { ...rule, codePrefix: event.target.value.toUpperCase() };
                        setTagRules(next);
                      }}
                      placeholder="CANAL_"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

