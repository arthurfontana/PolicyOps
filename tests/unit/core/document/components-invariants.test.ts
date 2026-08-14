import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PolicyComponent, PolicyOpsDocument } from '@/core/document/schema';
import { deserialize, serialize } from '@/core/document/serialize';
import { checkI27, checkI28, checkI29, validateDocument } from '@/core/document/validate';

/**
 * I27, I28 e I29 — a árvore de política em repouso
 * (`14-governanca-de-alteracoes.md` §6, `03-modelo-do-documento.md` §9).
 *
 * A fixture é uma **mini-política no formato do documento real**: o capítulo
 * "4.2 Regras Duras e Prevenção a Fraude" com Visão Geral própria (seção
 * versionada), duas seções temáticas puras, três regras com reason code, o
 * espelho de uma matriz existente e o espelho de uma variável da Biblioteca.
 * Nenhuma das fixtures anteriores serve: todas são anteriores ao schema 5 e
 * nenhuma tem árvore de componentes, que é justamente o que estas invariantes
 * cobrem.
 *
 * Cada caso adultera **uma** coisa a partir dela — é o mesmo espírito dos
 * `defect-*.json`, só que montado em memória porque as combinações são muitas
 * para uma fixture por defeito.
 */

const fixturePath = fileURLToPath(new URL('../../../fixtures/mini-politica.json', import.meta.url));

function miniPolitica(): PolicyOpsDocument {
  const raw: unknown = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  const parsed = validateDocument(raw);
  if (!parsed.ok) throw new Error(`mini-politica.json inválida: ${JSON.stringify(parsed.issues)}`);
  return parsed.document;
}

/** Aplica uma adulteração cirúrgica na fixture e devolve o documento resultante. */
function adulterado(mutate: (doc: PolicyOpsDocument) => void): PolicyOpsDocument {
  const doc = structuredClone(miniPolitica());
  mutate(doc);
  return doc;
}

function byCode(doc: PolicyOpsDocument, code: string): PolicyComponent {
  const component = doc.components.find((candidate) => candidate.code === code);
  if (component === undefined) throw new Error(`Componente "${code}" não está na fixture.`);
  return component;
}

describe('mini-política (fixture do documento real)', () => {
  it('é um documento válido, com seção versionada e seção pura convivendo (I29)', () => {
    const doc = miniPolitica();

    expect(byCode(doc, 'CAP_REGRAS_DURAS').versions).toHaveLength(1);
    expect(byCode(doc, 'BLOQUEIOS_POR_DIVIDA').versions).toEqual([]);
    expect(byCode(doc, 'PREVENCAO_A_FRAUDE').versions).toEqual([]);
    expect(doc.components.filter((component) => component.type === 'RULE')).toHaveLength(3);
    expect(byCode(doc, 'MTZ_CORTE_DIGITAL').matrixId).toBe('mtx000000001');
    expect(byCode(doc, 'VAR_RISCO').variableId).toBe('var000000001');
    expect(checkI27(doc)).toEqual([]);
    expect(checkI28(doc)).toEqual([]);
    expect(checkI29(doc)).toEqual([]);
  });

  it('round-trip salvar → abrir → salvar sem diferença canônica', () => {
    const doc = miniPolitica();
    const once = serialize(doc);
    const reopened = validateDocument(deserialize(once));

    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(serialize(reopened.document)).toBe(once);
    expect(reopened.document.components).toEqual(doc.components);
  });

  it('as coleções novas saem na ordem canônica de docs/03 §1', () => {
    expect(Object.keys(JSON.parse(serialize(miniPolitica())))).toEqual([
      'schemaVersion',
      'meta',
      'variables',
      'compatibility',
      'catalog',
      'projects',
      'matrices',
      'templates',
      'importProfiles',
      'components',
      'changeRequests',
      'releases',
      'events',
    ]);
  });
});

describe('I27 — MATRIX e POLICY_VARIABLE são espelhos', () => {
  it('MATRIX sem matrixId, com matriz inexistente ou de outro projeto', () => {
    const semMatriz = adulterado((doc) => {
      delete byCode(doc, 'MTZ_CORTE_DIGITAL').matrixId;
    });
    expect(checkI27(semMatriz)).toHaveLength(1);
    expect(checkI27(semMatriz)[0]!.invariant).toBe('I27');

    const inexistente = adulterado((doc) => {
      byCode(doc, 'MTZ_CORTE_DIGITAL').matrixId = 'nao_existe_';
    });
    expect(checkI27(inexistente)[0]!.message).toContain('não existe neste documento');

    const outroProjeto = adulterado((doc) => {
      doc.projects.push({ ...doc.projects[0]!, id: 'proj00000002', code: 'OUTRO', position: 1 });
      byCode(doc, 'MTZ_CORTE_DIGITAL').projectId = 'proj00000002';
      byCode(doc, 'MTZ_CORTE_DIGITAL').parentId = undefined;
      byCode(doc, 'MTZ_CORTE_DIGITAL').position = 0;
    });
    expect(checkI27(outroProjeto).some((issue) => issue.message.includes('de outro projeto'))).toBe(true);
  });

  it('MATRIX com versão própria e MATRIX com filho', () => {
    const comVersao = adulterado((doc) => {
      byCode(doc, 'MTZ_CORTE_DIGITAL').versions = structuredClone(byCode(doc, 'CAP_REGRAS_DURAS').versions);
    });
    expect(checkI27(comVersao).some((issue) => issue.message.includes('não versiona nada'))).toBe(true);

    const comFilho = adulterado((doc) => {
      byCode(doc, 'REGRA_ORIGEM_LEGADO').parentId = byCode(doc, 'MTZ_CORTE_DIGITAL').id;
      byCode(doc, 'REGRA_ORIGEM_LEGADO').position = 0;
    });
    expect(checkI27(comFilho).some((issue) => issue.message.includes('é sempre folha'))).toBe(true);
    expect(validateDocument(comFilho).ok).toBe(false);
  });

  it('duas matrizes apontadas pelo mesmo nó é impossível; dois nós na mesma matriz é erro', () => {
    // "Duas matrizes num nó" não tem como existir no schema — `matrixId` é um
    // campo só. O que o documento consegue expressar, e I27 recusa, é o
    // recíproco: dois nós apontando a mesma matriz.
    const doisNos = adulterado((doc) => {
      const espelho = byCode(doc, 'MTZ_CORTE_DIGITAL');
      doc.components.push({
        ...structuredClone(espelho),
        id: 'cmp000000009',
        code: 'MTZ_CORTE_COPIA',
        position: 4,
      });
    });

    const issues = checkI27(doisNos);
    expect(issues.some((issue) => issue.message.includes('entra na árvore uma vez só'))).toBe(true);
    expect(validateDocument(doisNos).ok).toBe(false);
  });

  it('matrixId ou variableId em nó do tipo errado', () => {
    const regraComMatriz = adulterado((doc) => {
      byCode(doc, 'REGRA_DIVIDA_5000').matrixId = 'mtx000000001';
    });
    expect(checkI27(regraComMatriz).some((issue) => issue.message.includes('só MATRIX aponta matriz'))).toBe(
      true,
    );

    const regraComVariavel = adulterado((doc) => {
      byCode(doc, 'REGRA_DIVIDA_5000').variableId = 'var000000002';
    });
    expect(
      checkI27(regraComVariavel).some((issue) => issue.message.includes('espelha variável da Biblioteca')),
    ).toBe(true);
  });

  it('POLICY_VARIABLE com variável inexistente, e duas espelhando a mesma', () => {
    const inexistente = adulterado((doc) => {
      byCode(doc, 'VAR_RISCO').variableId = 'nao_existe_';
    });
    expect(checkI27(inexistente)[0]!.message).toContain('variável que não existe');

    const duplicado = adulterado((doc) => {
      doc.components.push({
        ...structuredClone(byCode(doc, 'VAR_RISCO')),
        id: 'cmp000000010',
        code: 'VAR_RISCO_COPIA',
        position: 4,
        versions: [],
      });
    });
    expect(checkI27(duplicado).some((issue) => issue.message.includes('o espelho é único'))).toBe(true);
  });
});

describe('I28 — árvore acíclica, position, profundidade, code e tags', () => {
  it('ciclo: um nó ancestral de si mesmo é denunciado uma vez por nó do ciclo', () => {
    const ciclo = adulterado((doc) => {
      byCode(doc, 'CAP_REGRAS_DURAS').parentId = byCode(doc, 'BLOQUEIOS_POR_DIVIDA').id;
    });

    const issues = checkI28(ciclo).filter((issue) => issue.message.includes('ancestral de si mesmo'));
    expect(issues.map((issue) => issue.path).sort()).toEqual(['components[0]', 'components[1]']);
    expect(validateDocument(ciclo).ok).toBe(false);
  });

  it('parentId inexistente, de outro projeto, e projeto inexistente', () => {
    const semPai = adulterado((doc) => {
      byCode(doc, 'BLOQUEIOS_POR_DIVIDA').parentId = 'nao_existe_';
    });
    expect(checkI28(semPai).some((issue) => issue.message.includes('pai que não existe'))).toBe(true);

    const outroProjeto = adulterado((doc) => {
      doc.projects.push({ ...doc.projects[0]!, id: 'proj00000002', code: 'OUTRO', position: 1 });
      byCode(doc, 'BLOQUEIOS_POR_DIVIDA').projectId = 'proj00000002';
    });
    expect(checkI28(outroProjeto).some((issue) => issue.message.includes('que é de outro projeto'))).toBe(
      true,
    );

    const semProjeto = adulterado((doc) => {
      byCode(doc, 'CAP_REGRAS_DURAS').projectId = 'nao_existe_';
    });
    expect(checkI28(semProjeto).some((issue) => issue.message.includes('projeto que não existe'))).toBe(true);
  });

  it('position com buraco entre irmãos', () => {
    // Segunda (e última) filha de "Bloqueios por Dívida": só ela sai do lugar,
    // então o buraco vira exatamente um problema, não a renumeração do grupo.
    const buraco = adulterado((doc) => {
      byCode(doc, 'REGRA_DIVIDA_VENCIDA').position = 5;
    });

    const issues = checkI28(buraco).filter((issue) => issue.message.includes('buraco'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I28');
    expect(issues[0]!.autoFix).toBe('RENUMBER');
  });

  it('profundidade acima de 6 níveis', () => {
    const fundo = adulterado((doc) => {
      let parentId = byCode(doc, 'REGRA_DIVIDA_5000').id;
      for (let level = 4; level <= 7; level++) {
        const id = `cmpfundo${String(level).padStart(4, '0')}`;
        doc.components.push({
          id,
          projectId: 'proj00000001',
          parentId,
          position: 0,
          code: `FUNDO_${level}`,
          name: `Nível ${level}`,
          type: 'SECTION',
          reviewStatus: 'STRUCTURED',
          createdAt: '2026-01-01T00:00:00.000Z',
          versions: [],
        });
        parentId = id;
      }
    });

    const issues = checkI28(fundo).filter((issue) => issue.message.includes('o teto é 6'));
    expect(issues.length).toBeGreaterThan(0);
    expect(validateDocument(fundo).ok).toBe(false);
  });

  it('code repetido dentro do projeto (E-GOV-06 em repouso)', () => {
    const repetido = adulterado((doc) => {
      byCode(doc, 'PREVENCAO_A_FRAUDE').code = 'BLOQUEIOS_POR_DIVIDA';
    });

    const issues = checkI28(repetido).filter((issue) => issue.message.includes('já está em uso'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.invariant).toBe('I28');
  });

  it('tag inexistente no catálogo e tag repetida no mesmo nó', () => {
    const inexistente = adulterado((doc) => {
      byCode(doc, 'REGRA_ORIGEM_LEGADO').tags = ['NAO_EXISTE'];
    });
    const issues = checkI28(inexistente);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('não existe no catálogo');
    expect(validateDocument(inexistente).ok).toBe(false);

    const repetida = adulterado((doc) => {
      byCode(doc, 'REGRA_ORIGEM_LEGADO').tags = ['CANAL_DIGITAL', 'CANAL_DIGITAL'];
    });
    expect(checkI28(repetida)[0]!.message).toContain('repetida');
  });
});

describe('I29 — versões de componente seguem o mesmo ciclo, inclusive em SECTION', () => {
  it('duas DRAFT ou duas PUBLISHED no mesmo componente', () => {
    const doisRascunhos = adulterado((doc) => {
      const regra = byCode(doc, 'REGRA_DIVIDA_5000');
      regra.versions = [
        { ...structuredClone(regra.versions[0]!), id: 'ver000000001', number: 2, state: 'DRAFT' },
        { ...structuredClone(regra.versions[0]!), id: 'ver000000002', number: 3, state: 'DRAFT' },
      ];
      for (const version of regra.versions) {
        delete version.effectiveFrom;
        delete version.publishedAt;
        delete version.publishedBy;
      }
    });
    expect(checkI29(doisRascunhos).some((issue) => issue.message.includes('em rascunho'))).toBe(true);

    const duasPublicadas = adulterado((doc) => {
      const regra = byCode(doc, 'REGRA_DIVIDA_5000');
      regra.versions = [
        structuredClone(regra.versions[0]!),
        { ...structuredClone(regra.versions[0]!), id: 'ver000000003', number: 2 },
      ];
    });
    expect(checkI29(duasPublicadas).some((issue) => issue.message.includes('publicadas'))).toBe(true);
  });

  it('publicada sem registros de publicação, e SUPERSEDED sem effectiveTo', () => {
    const semRegistros = adulterado((doc) => {
      delete byCode(doc, 'REGRA_DIVIDA_5000').versions[0]!.publishedBy;
    });
    expect(checkI29(semRegistros)[0]!.message).toContain('registros de publicação');

    const semEffectiveTo = adulterado((doc) => {
      byCode(doc, 'REGRA_DIVIDA_5000').versions[0]!.state = 'SUPERSEDED';
    });
    expect(checkI29(semEffectiveTo).some((issue) => issue.message.includes('não tem effectiveTo'))).toBe(true);
  });

  it('rascunho com vigência carimbada', () => {
    const rascunhoVigente = adulterado((doc) => {
      const version = byCode(doc, 'REGRA_DIVIDA_5000').versions[0]!;
      version.state = 'DRAFT';
      delete version.publishedAt;
      delete version.publishedBy;
    });
    expect(
      checkI29(rascunhoVigente).some((issue) => issue.message.includes('rascunho mas já tem vigência')),
    ).toBe(true);
  });

  it('payload que não casa com o tipo do componente — inclusive na seção versionada', () => {
    const regraComListaPayload = adulterado((doc) => {
      byCode(doc, 'REGRA_DIVIDA_5000').versions[0]!.payload = {
        kind: 'LIST',
        businessDescription: 'Payload de lista numa regra.',
      };
    });
    expect(checkI29(regraComListaPayload)[0]!.message).toContain('payload LIST');

    const secaoComRulePayload = adulterado((doc) => {
      byCode(doc, 'CAP_REGRAS_DURAS').versions[0]!.payload = {
        kind: 'RULE',
        businessDescription: 'Payload de regra numa seção.',
      };
    });
    expect(checkI29(secaoComRulePayload)[0]!.message).toContain('o esperado é OTHER');
  });

  it('cadeia de vigência com buraco ou sobreposição', () => {
    const comBuraco = adulterado((doc) => {
      const regra = byCode(doc, 'REGRA_DIVIDA_5000');
      const v1 = structuredClone(regra.versions[0]!);
      v1.state = 'SUPERSEDED';
      v1.effectiveTo = '2026-05-01T00:00:00.000Z';
      regra.versions = [
        v1,
        {
          ...structuredClone(regra.versions[0]!),
          id: 'ver000000004',
          number: 2,
          effectiveFrom: '2026-06-01T00:00:00.000Z',
        },
      ];
    });
    expect(
      checkI29(comBuraco).some((issue) => issue.message.includes('sobreposição ou um buraco')),
    ).toBe(true);

    const semEffectiveTo = adulterado((doc) => {
      const regra = byCode(doc, 'REGRA_DIVIDA_5000');
      regra.versions = [
        structuredClone(regra.versions[0]!),
        {
          ...structuredClone(regra.versions[0]!),
          id: 'ver000000005',
          number: 2,
          state: 'DRAFT',
          effectiveFrom: '2026-06-01T00:00:00.000Z',
        },
      ];
    });
    expect(
      checkI29(semEffectiveTo).some((issue) => issue.message.includes('ficaria sobreposto')),
    ).toBe(true);
  });

  it('seção sem versões nunca produz problema de ciclo de vida', () => {
    const doc = miniPolitica();
    const semVersoes = doc.components.filter((component) => component.versions.length === 0);
    expect(semVersoes.map((component) => component.code)).toEqual([
      'BLOQUEIOS_POR_DIVIDA',
      'PREVENCAO_A_FRAUDE',
      'MTZ_CORTE_DIGITAL',
    ]);
    expect(checkI29(doc)).toEqual([]);
  });
});
