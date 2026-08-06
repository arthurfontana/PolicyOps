import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeHeaderLayout } from '@/core/axes/header-layout';
import { generateTuples, type ApplicableCompatibility } from '@/core/axes/tuples';
import { decodePath, pathPrefix } from '@/core/axes/paths';
import type { Axis, AxisLevel } from '@/core/document/schema';
import { isDomainError } from '@/core/errors';
import { compat } from './fixtures';

/**
 * Teste de propriedade de docs/04-eixos-aninhados.md §8: para **qualquer**
 * configuração válida de níveis e regras, `computeHeaderLayout` produz no
 * último nível exatamente `tuples.length` cabeçalhos, e a soma dos spans de
 * cada nível é igual a `tuples.length`.
 */

const MAX_LEVELS = 3;
const MAX_DOMAINS = 4;

const boolRow = fc.array(fc.boolean(), { minLength: MAX_DOMAINS, maxLength: MAX_DOMAINS });
const boolMatrix = fc.array(boolRow, { minLength: MAX_DOMAINS, maxLength: MAX_DOMAINS });

const configArb = fc.record({
  sizes: fc.array(fc.integer({ min: 1, max: MAX_DOMAINS }), { minLength: 1, maxLength: MAX_LEVELS }),
  rulePresent: fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }),
  ruleDefault: fc.array(fc.constantFrom<'ALL' | 'NONE'>('ALL', 'NONE'), {
    minLength: 2,
    maxLength: 2,
  }),
  allowed: fc.array(boolMatrix, { minLength: 2, maxLength: 2 }),
  listed: fc.array(boolRow, { minLength: 2, maxLength: 2 }),
  suppressionMask: fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
});

function buildLevels(sizes: number[]): AxisLevel[] {
  return sizes.map((size, index) => ({
    id: `lvl-${index}`,
    variableId: `V${index}`,
    variableVersionId: `V${index}-v1`,
    label: `Nível ${index}`,
    domains: Array.from({ length: size }, (_unused, position) => ({
      code: `L${index}_D${position}`,
      label: `Nível ${index} · domínio ${position}`,
      position,
    })),
  }));
}

describe('propriedade: spans do cabeçalho somam sempre o número de tuplas', () => {
  it('vale para qualquer configuração válida de níveis, regras e supressões', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const levels = buildLevels(config.sizes);

        const compatibility: ApplicableCompatibility[] = [];
        for (let pair = 0; pair + 1 < config.sizes.length; pair++) {
          if (!config.rulePresent[pair]!) continue;
          const parentSize = config.sizes[pair]!;
          const childSize = config.sizes[pair + 1]!;
          const allow: Record<string, string[]> = {};
          for (let parent = 0; parent < parentSize; parent++) {
            if (!config.listed[pair]![parent]!) continue;
            const children: string[] = [];
            for (let child = 0; child < childSize; child++) {
              if (config.allowed[pair]![parent]![child]!) children.push(`L${pair + 1}_D${child}`);
            }
            allow[`L${pair}_D${parent}`] = children;
          }
          compatibility.push(
            compat({
              parentVariableId: `V${pair}`,
              childVariableId: `V${pair + 1}`,
              allow,
              defaultForUnlisted: config.ruleDefault[pair]!,
            }),
          );
        }

        let generated;
        try {
          generated = generateTuples({ levels, compatibility });
        } catch (error) {
          // Configuração impossível (NO_VALID_TUPLES) não tem cabeçalho a checar.
          expect(isDomainError(error) && error.code).toBe('NO_VALID_TUPLES');
          return;
        }

        // Uma supressão manual a cada duas tuplas, para exercitar o layout
        // assimétrico — mantendo ao menos uma tupla viva.
        const suppressions = generated.tuples.filter(
          (_unused, index) => index > 0 && config.suppressionMask[index]!,
        );
        const { tuples } = generateTuples({
          levels,
          compatibility,
          manualSuppressions: suppressions,
        });

        const axis: Axis = {
          role: 'Y',
          levels,
          tuples,
          derivedFrom: { compatibilityVersionIds: [] },
        };
        const rows = computeHeaderLayout(axis);

        expect(rows).toHaveLength(levels.length);
        for (const row of rows) {
          const total = row.cells.reduce((sum, cell) => sum + cell.span, 0);
          expect(total).toBe(tuples.length);

          // Os cabeçalhos cobrem as tuplas em blocos contíguos, sem buraco.
          let cursor = 0;
          for (const cell of row.cells) {
            expect(cell.startIndex).toBe(cursor);
            expect(cell.span).toBeGreaterThan(0);
            expect(cell.path).toBe(pathPrefix(tuples[cell.startIndex]!, row.level + 1));
            expect(cell.code).toBe(decodePath(tuples[cell.startIndex]!)[row.level]);
            cursor += cell.span;
          }
        }

        const lastRow = rows[rows.length - 1]!;
        expect(lastRow.cells).toHaveLength(tuples.length);
        expect(lastRow.cells.every((cell) => cell.span === 1)).toBe(true);
        expect(lastRow.cells.map((cell) => cell.path)).toEqual(tuples);
      }),
      { numRuns: 300 },
    );
  });
});
