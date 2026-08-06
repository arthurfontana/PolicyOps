import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateDocument } from '@/core/document/validate';
import { readDocumentFromBytes } from '@/storage/document-io';
import {
  autoFixableCount,
  coerceToDocumentShape,
  describeAutoFix,
  diagnosticReport,
  groupBySeverity,
  repairDocument,
} from '@/storage/recovery';

/**
 * Modo de recuperação — docs/06-persistencia-e-concorrencia.md §10 e §11:
 * "documento com 5 defeitos conhecidos abre, lista os 5, corrige os
 * corrigíveis, e **o original não é tocado**".
 *
 * Os 5 defeitos são os fixtures da Sessão 02, um por invariante.
 */

const FIXTURES = path.resolve(import.meta.dirname, '..', '..', 'fixtures');

const DEFECTS = [
  // A referência inexistente some, mas a célula publicada fica **sem
  // decisão** — e I6 exige que versão publicada não tenha buraco. Qual
  // decisão colocar ali é pergunta para quem escreveu a política, não para o
  // programa: a correção automática resolve o que era seguro resolver e
  // entrega o resto explicitamente.
  { file: 'defect-catalog-ref-missing.json', invariant: 'I17', autoFixable: true, validAfter: false },
  { file: 'defect-invalid-cell-coord.json', invariant: 'I5', autoFixable: true, validAfter: true },
  { file: 'defect-orphan-tuple.json', invariant: 'I15', autoFixable: true, validAfter: true },
  { file: 'defect-position-gap.json', invariant: 'POSITION', autoFixable: true, validAfter: true },
  { file: 'defect-two-published-versions.json', invariant: 'I2', autoFixable: false, validAfter: false },
] as const;

const readFixture = (file: string) => new Uint8Array(readFileSync(path.join(FIXTURES, file)));
const parseFixture = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf-8'));

describe('os 5 defeitos conhecidos', () => {
  it('todos abrem em modo de recuperação, e cada um lista o seu problema', async () => {
    const listed: string[] = [];

    for (const defect of DEFECTS) {
      const read = await readDocumentFromBytes(readFixture(defect.file));
      // Abriu: o arquivo não foi descartado.
      expect(read.document.meta.name).toContain('Fixture');
      expect(read.issues.length).toBeGreaterThan(0);
      expect(read.issues.some((issue) => issue.invariant === defect.invariant)).toBe(true);
      listed.push(defect.invariant);
    }

    expect(listed).toHaveLength(5);
    expect(new Set(listed).size).toBe(5);
  });

  it('corrige os 4 corrigíveis e deixa o 5º para a mão humana', () => {
    for (const defect of DEFECTS) {
      const raw = parseFixture(defect.file);
      const validated = validateDocument(raw);
      expect(validated.ok).toBe(false);
      if (validated.ok) return;

      const repaired = repairDocument(raw, validated.issues);

      if (defect.autoFixable) {
        // O defeito em si foi corrigido…
        expect(repaired.fixed.some((issue) => issue.invariant === defect.invariant)).toBe(true);
        expect(repaired.remaining.some((issue) => issue.invariant === defect.invariant)).toBe(false);
        expect(repaired.actions.length).toBeGreaterThan(0);
      } else {
        // Duas versões publicadas na mesma matriz: escolher qual vale é
        // decisão de quem escreveu a política, não do programa.
        expect(repaired.remaining.some((issue) => issue.invariant === defect.invariant)).toBe(true);
      }

      // …e o documento só sai válido quando a correção não abre um buraco
      // que exige decisão humana.
      expect(validateDocument(repaired.document).ok).toBe(defect.validAfter);
    }
  });

  it('o arquivo original não é tocado — nem por leitura, nem por correção', async () => {
    for (const defect of DEFECTS) {
      const fullPath = path.join(FIXTURES, defect.file);
      const before = readFileSync(fullPath, 'utf-8');
      const sizeBefore = statSync(fullPath).size;

      const read = await readDocumentFromBytes(readFixture(defect.file));
      repairDocument(read.document, read.issues);

      expect(readFileSync(fullPath, 'utf-8')).toBe(before);
      expect(statSync(fullPath).size).toBe(sizeBefore);
    }
  });

  it('a correção trabalha sobre uma cópia: o objeto em memória também fica intacto', () => {
    const raw = parseFixture('defect-invalid-cell-coord.json') as Record<string, unknown>;
    const snapshot = JSON.stringify(raw);
    const validated = validateDocument(raw);
    if (validated.ok) throw new Error('fixture deveria falhar');

    repairDocument(raw, validated.issues);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});

describe('correções por tipo', () => {
  it('I17 — limpa a referência a catálogo inexistente', () => {
    const raw = parseFixture('defect-catalog-ref-missing.json');
    const validated = validateDocument(raw);
    if (validated.ok) throw new Error('fixture deveria falhar');

    const repaired = repairDocument(raw, validated.issues);
    expect(repaired.actions.some((action) => action.invariant === 'I17')).toBe(true);
    expect(repaired.actions[0]!.description).toMatch(/Limpar|Remover/);
    // A célula perdeu a decisão inexistente e virou uma pendência declarada,
    // em vez de uma referência quebrada gravada como se fosse válida.
    expect(repaired.remaining.map((issue) => issue.invariant)).toEqual(['I6']);
  });

  it('I5 — remove a célula de coordenada inválida', () => {
    const raw = parseFixture('defect-invalid-cell-coord.json');
    const validated = validateDocument(raw);
    if (validated.ok) throw new Error('fixture deveria falhar');

    const repaired = repairDocument(raw, validated.issues);
    expect(repaired.actions.some((action) => action.invariant === 'I5')).toBe(true);
  });

  it('I15 — remove a tupla órfã e as células que dependiam dela', () => {
    const raw = parseFixture('defect-orphan-tuple.json');
    const validated = validateDocument(raw);
    if (validated.ok) throw new Error('fixture deveria falhar');

    const repaired = repairDocument(raw, validated.issues);
    expect(repaired.actions.some((action) => action.invariant === 'I15')).toBe(true);
    expect(validateDocument(repaired.document).ok).toBe(true);
  });

  it('POSITION — renumera sem buracos, preservando a ordem', () => {
    const raw = parseFixture('defect-position-gap.json');
    const validated = validateDocument(raw);
    if (validated.ok) throw new Error('fixture deveria falhar');

    const repaired = repairDocument(raw, validated.issues);
    expect(repaired.actions.some((action) => action.invariant === 'POSITION')).toBe(true);

    const fixed = validateDocument(repaired.document);
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    const positions = fixed.document.catalog.map((item) => item.position).sort((a, b) => a - b);
    expect(positions).toEqual(positions.map((_, index) => index));
  });
});

describe('apresentação dos problemas', () => {
  it('agrupa por gravidade, em português', () => {
    const groups = groupBySeverity([
      { severity: 'ERROR', invariant: 'I5', path: 'a', message: 'erro' },
      { severity: 'WARNING', invariant: 'I9', path: 'b', message: 'aviso' },
    ]);
    expect(groups.map((group) => group.severity)).toEqual(['ERROR', 'WARNING']);
    expect(groups[0]!.label).toContain('Erros');
    expect(groups[1]!.label).toContain('Avisos');
  });

  it('conta e descreve as correções automáticas', () => {
    const issues = [
      { severity: 'ERROR' as const, invariant: 'I5', path: 'a', message: 'm', autoFix: 'REMOVE' as const },
      { severity: 'ERROR' as const, invariant: 'I2', path: 'b', message: 'm' },
    ];
    expect(autoFixableCount(issues)).toBe(1);
    expect(describeAutoFix(issues[0]!)).toBe('remover o registro inválido');
    expect(describeAutoFix(issues[1]!)).toBeNull();
  });

  it('gera um relatório de diagnóstico exportável', () => {
    const validated = validateDocument(parseFixture('defect-position-gap.json'));
    if (validated.ok) throw new Error('fixture deveria falhar');

    const report = diagnosticReport(
      'defect-position-gap.json',
      validated.issues,
      new Date('2026-08-05T12:00:00.000Z'),
    );
    expect(report).toContain('Relatório de diagnóstico');
    expect(report).toContain('defect-position-gap.json');
    expect(report).toContain('correção automática:');
  });
});

describe('coerceToDocumentShape', () => {
  it('dá forma exibível a um arquivo que não valida, sem inventar conteúdo', () => {
    const shaped = coerceToDocumentShape({ meta: { name: 'Quebrado' }, matrices: 'não é array' });
    expect(shaped.meta.name).toBe('Quebrado');
    expect(shaped.meta.revision).toBe(0);
    expect(shaped.matrices).toEqual([]);
    expect(shaped.variables).toEqual([]);
  });

  it('aguenta lixo completo', () => {
    const shaped = coerceToDocumentShape(42);
    expect(shaped.meta.name).toBe('Documento sem nome');
    expect(shaped.events).toEqual([]);
  });
});
