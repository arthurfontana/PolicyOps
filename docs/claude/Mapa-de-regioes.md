# Mapa de âncoras de região

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Sessão S31 (ADR-006). Este mapa é um
> **índice de navegação**, não documentação de domínio — para o detalhe funcional de cada
> feature, use a tabela "Onde vive o quê" do `CLAUDE.md`, que aponta para `docs/01..14-*.md`.

## Convenção

Arquivos de `src/` acima de ~600 linhas ganham comentários-âncora grep-áveis por seção:

```
// #region: <slug-em-kebab-case>
```

- Um comentário de linha só, sem `#endregion` — o objetivo é `grep`, não colapsar/expandir no
  editor. `grep -rn "// #region:" src/` lista todas as âncoras do repositório com o arquivo e a
  linha atual.
- O slug deriva do título da seção já existente no arquivo (muitos arquivos de `src/core/` já
  tinham blocos divisores `// ---...---\n// Título\n// ---...---`; a âncora foi inserida logo
  depois do divisor de fechamento, sem tocar em nenhuma outra linha). Onde não havia divisor
  (a maioria dos componentes React grandes), a âncora foi colocada antes do início de cada
  função/seção lógica (helpers, componente principal, handlers, JSX).
- **Só o comentário muda** — nenhum código foi movido, renomeado ou reformatado nesta sessão.
  Extração de módulo (quando fizer sentido) fica para quando uma sessão futura tocar o arquivo
  por outro motivo — incremental, nunca big-bang (ADR-007, `docs/13-decisoes.md`).
- Linhas abaixo são a posição no momento da S31; deslocam com edições futuras — use o `grep`
  acima para a posição exata a qualquer momento. Nenhuma sessão precisa manter este mapa
  sincronizado linha a linha; ele existe para orientar por nome de arquivo + slug, não por
  número exato.

## Arquivos anotados (17)

### `src/core/document/schema.ts`
| Linha | Âncora |
|---|---|
| 33 | `primitivos-definidos-em-primitives-ver-o-comentario-la-sobre-o-ciclo` |
| 53 | `2-biblioteca-de-variaveis` |
| 229 | `3-biblioteca-de-compatibilidade` |
| 295 | `4-biblioteca-de-conteudo` |
| 339 | `5-projetos-e-matrizes` |
| 366 | `6-versao-de-matriz` |
| 509 | `7-templates` |
| 585 | `8-auditoria` |
| 655 | `9-evidencias` |
| 720 | `1-estrutura-de-topo` |

### `src/core/document/validate.ts`
Uma âncora por invariante (`i1-...` a `i26-...`, mais uma checagem adicional fora da tabela
I1–I18) — `grep -n "// #region: i" src/core/document/validate.ts` isola qualquer `checkIN`
individualmente.

### `src/core/document/create.ts`
| Linha | Âncora |
|---|---|
| 73 | `create-sample-document-docs-03-modelo-do-documento-md-11` |

### `src/core/axes/levels.ts`
| Linha | Âncora |
|---|---|
| 42 | `utilitarios-internos` |
| 155 | `5-1-adicionar-nivel` |
| 309 | `5-2-remover-nivel` |
| 480 | `5-3-reordenar-niveis` |

### `src/core/versioning/lifecycle.ts`
| Linha | Âncora |
|---|---|
| 54 | `1-5-imutabilidade-a-guarda-mais-importante-do-sistema` |
| 91 | `localizacao` |
| 134 | `1-1-matrix-create` |
| 427 | `1-2-version-create-draft` |
| 527 | `version-create-without-base-restauracao-de-matriz-nunca-publicada` |
| 667 | `1-3-version-publish` |
| 862 | `1-4-version-discard-draft` |
| 909 | `version-add-note` |
| 946 | `consultas-de-apoio` |

### `src/core/versioning/axis-commands.ts`
| Linha | Âncora |
|---|---|
| 65 | `utilitarios` |
| 120 | `inverso-comum-restaurar-o-eixo-e-as-celulas` |
| 178 | `axis-add-level-docs-04-5-1` |
| 254 | `axis-remove-level-docs-04-5-2` |
| 321 | `axis-reorder-levels-docs-04-5-3` |
| 391 | `axis-suppress-tuples-e-axis-restore-tuples-docs-04-5-4-docs-07-8` |
| 591 | `axis-resnapshot-docs-05-5-4` |
| 682 | `escrita-e-revalidacao` |
| 698 | `previews-a-interface-nunca-aplica-sem-mostrar-antes-docs-07-7` |

### `src/core/library/variables.ts`
| Linha | Âncora |
|---|---|
| 118 | `variable-create` |
| 243 | `variable-update-meta` |
| 287 | `variable-create-draft-variable-discard-draft` |
| 412 | `variable-save-domains` |
| 545 | `variable-publish` |
| 622 | `variable-archive` |
| 695 | `variable-duplicate` |

### `src/core/library/compatibility.ts`
| Linha | Âncora |
|---|---|
| 210 | `compat-create` |
| 353 | `compat-create-draft-compat-discard-draft` |
| 475 | `compat-save-map` |
| 599 | `compat-publish` |
| 663 | `compat-archive` |

### `src/core/import/profile.ts`
| Linha | Âncora |
|---|---|
| 24 | `tipos-5-4` |
| 97 | `zod-5-4` |
| 185 | `normalizacao-de-valores` |
| 242 | `leitura-do-perfil` |
| 303 | `rn-19-reconhecimento-pelo-cabecalho` |
| 324 | `i21-i22-validacao` |
| 588 | `rn-19-cabecalho-parecido-mas-diferente-ct-12` |

### `src/core/import/plan.ts`
| Linha | Âncora |
|---|---|
| 155 | `eixos-projetados-para-a-matriz-nova` |
| 226 | `agrupamento-das-linhas-resolvidas` |
| 291 | `plan-import` |
| 743 | `hashes` |

### `src/core/merge/documents.ts`
| Linha | Âncora |
|---|---|
| 69 | `utilidades-puras` |
| 154 | `contexto` |
| 217 | `diferenca-campo-a-campo` |
| 334 | `conflitos` |
| 356 | `colecoes-simples-catalogo-projetos-templates` |
| 463 | `bibliotecas-versionadas-variaveis-e-regras-de-compatibilidade` |
| 709 | `matrizes` |
| 1246 | `codigos-duplicados` |
| 1377 | `eventos-metadados-e-posicoes` |
| 1520 | `merge-documents` |

### `src/core/queries.ts`
| Linha | Âncora |
|---|---|
| 40 | `vigencia-docs-05-6` |
| 83 | `linha-do-tempo-de-vigencia-docs-07-ux-e-editor-md-10-docs-prompts-s15` |
| 123 | `historico-e-auditoria` |
| 187 | `defasagem-de-eixo-docs-05-5-2` |
| 258 | `tela-de-rascunhos-docs-prompts-s13-ciclo-de-vida-md-item-5` |
| 286 | `navegacao-de-projeto-matriz-versao-docs-09-s09` |
| 370 | `tags-e-filtro-de-matrizes-docs-07-ux-e-editor-md-15-docs-03-4-5` |
| 483 | `biblioteca-de-variaveis` |
| 579 | `biblioteca-de-compatibilidade-docs-08-4-docs-07-11` |
| 750 | `get-editor-view-tudo-que-o-grid-precisa-calculado-uma-vez-so` |
| 900 | `templates-docs-07-ux-e-editor-md-11-docs-prompts-s17-parte-a` |
| 943 | `carga-de-matrizes-origem-dos-rascunhos-docs-12-6-2-us-10` |

### `src/components/grid/Grid.tsx`
| Linha | Âncora |
|---|---|
| 181 | `celula` |
| 401 | `grid` |

### `src/components/library/DomainsEditor.tsx`
| Linha | Âncora |
|---|---|
| 72 | `helpers-de-linha-e-dominio` |
| 120 | `templates-e-csv` |
| 163 | `feedback-de-parse-e-colagem` |
| 238 | `helpers-de-issues` |
| 254 | `sortable-row` |
| 431 | `sortable-grouping-row` |
| 507 | `grouping-dimensions-editor` |
| 576 | `grouping-range-row` |
| 649 | `domains-editor` |
| 860 | `domains-editor-jsx` |

### `src/components/matrix/MatrixScreen.tsx`
| Linha | Âncora |
|---|---|
| 69 | `matrix-screen-estado-e-hooks` |
| 120 | `matrix-screen-efeitos-e-derivados` |
| 170 | `matrix-screen-handlers` |
| 347 | `matrix-screen-jsx` |

### `src/components/templates/TemplateEditor.tsx`
| Linha | Âncora |
|---|---|
| 50 | `helpers-de-linha-e-regra` |
| 106 | `componentes-de-selecao-reutilizaveis` |
| 166 | `template-editor` |
| 274 | `handlers-de-regras-e-salvamento` |
| 354 | `jsx-formulario-e-preview` |

### `src/store/persistence-store.ts`
| Linha | Âncora |
|---|---|
| 50 | `tipos-de-estado-derivado` |
| 98 | `interface-persistence-state` |
| 191 | `helpers-de-modulo-fora-do-react` |
| 210 | `use-persistence-store` |
| 213 | `helpers-internos-do-store` |
| 516 | `estado-inicial-e-acoes` |

## Quando um arquivo novo cruzar ~600 linhas

Adicione as âncoras seguindo a mesma convenção (título de seção → slug kebab-case) e uma entrada
nova nesta lista. Não é obrigatório fazer isso na sessão que fez o arquivo crescer — só na
próxima sessão que precisar navegar nele, se ainda não tiver âncoras.
