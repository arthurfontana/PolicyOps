# Decisões (ADRs e DECs)

> Catálogo do **porquê**. Os documentos normativos (`02` a `12`) descrevem como o sistema é; as
> decisões abaixo explicam por que ficou assim. Decisão nunca se apaga nem se reescreve: decisão
> revertida ganha uma DEC nova com o campo **Substitui** apontando a antiga.

Prefixos em uso: `ADR-` para decisões globais de arquitetura, `DEC-<ÉPICO>-` para decisões de um
domínio funcional (`CARGA` = carga de matrizes, `12-carga-de-matrizes.md`; `PLAT` = plataforma
local, `14-plataforma-local.md`; `GOV` = governança de alterações,
`14-governanca-de-alteracoes.md`).

---

## ADR-001: a plataforma ganha um servidor local por usuário

| Campo | Conteúdo |
|---|---|
| **Decisão** | Abandonar a estratégia "HTML aberto do SharePoint" como modo principal. O produto passa a ser distribuído numa **pasta de rede** com um **servidor Python local por usuário** (launcher `iniciar.bat`), que serve a SPA em `http://127.0.0.1` e faz todo o I/O contra a pasta. Sem máquina central. |
| **Data / gatilho** | 2026-08-14, revisão de arquitetura após o fechamento dos épicos MVP/Carga. |
| **Páginas afetadas** | `14-plataforma-local.md` (novo), `01-visao-e-escopo.md` §2–§3, §7–§8, `02-arquitetura.md` §1, `06-persistencia-e-concorrencia.md`, `11-operacao.md` |

**Contexto.** A premissa original ("zero instalação, abre do SharePoint") falhou no ambiente
real: o time abre o HTML por caminho de rede/cópia local (`file://`), onde a File System Access
API não existe — **o modo `FULL` nunca funcionou** e todo uso caiu no `DOWNLOAD_ONLY` (abrir por
seletor, salvar por download), que é operacionalmente ruim. Ao mesmo tempo, o ambiente real tem o
que a premissa proibia: pastas de rede compartilhadas e Python instalável nas máquinas
(padrão já validado em produção corporativa pelo AppCreditoSimulador).

**Justificativa.**

- Um servidor local elimina a dependência do navegador para tocar arquivo: salvar direto,
  conflito, lock e backup passam a funcionar em qualquer navegador.
- Servidor **por usuário** (e não central) preserva a propriedade mais valiosa da arquitetura
  atual: zero operação — nenhuma máquina sempre ligada, nenhuma porta na rede, nenhum dono de
  serviço. A coordenação entre usuários continua pelos arquivos (hash + lock consultivo).
- Abre as três capacidades pedidas pelo negócio que o navegador sozinho não dá: identidade
  amarrada ao Windows (ADR-003), evidências hospedadas (ADR-004) e um caminho natural para, se
  um dia fizer sentido, promover o mesmo servidor a uma máquina central — o contrato da API não
  mudaria.

## ADR-002: o servidor entra por baixo do `StorageAdapter`; o front e o core não mudam de dono

| Campo | Conteúdo |
|---|---|
| **Decisão** | A SPA React/TypeScript e o `src/core/` permanecem integralmente. O servidor é **infraestrutura**: um novo `server-adapter.ts` implementa a interface `StorageAdapter` existente sobre HTTP local, e o Python **nunca** contém regra de negócio — não valida invariantes, não migra schema, não interpreta o documento além de `meta.acl`. A regra "zero requisições de rede" passa a ser lida como "zero requisições **externas**". |
| **Data / gatilho** | 2026-08-14, junto com ADR-001. |
| **Páginas afetadas** | `02-arquitetura.md` §2–§4, `06-persistencia-e-concorrencia.md` §1–§2, `14-plataforma-local.md` §3–§4 |

**Contexto.** A alternativa era migrar a aplicação para um web app Python "de verdade" (templates
ou API por entidade + front fino). Isso jogaria fora ~45 mil linhas testadas de core/UI e
duplicaria as invariantes em duas linguagens — o tipo de reescrita big-bang que os guardrails da
metodologia proíbem.

**Justificativa.** O ponto fraco da arquitetura nunca foi o front — foi o navegador não poder
gravar arquivo. Trocando só a camada que já era trocável por desenho (os adapters), o custo da
migração fica confinado: um adapter novo + um servidor pequeno e testável. O documento continua
sendo salvo inteiro (o modelo de concorrência hash+merge de `06` não muda), e os modos `FULL` e
`DOWNLOAD_ONLY` sobrevivem como fallback de graça.

## ADR-003: identidade é o login Windows, capturado pelo servidor; papéis vivem no documento

| Campo | Conteúdo |
|---|---|
| **Decisão** | No modo `SERVER`, a identidade é o login de rede (`getpass.getuser()`), capturado no boot e carimbado em auditoria, `savedBy`, lock e evidências — sem senha, sem diálogo. O documento ganha `meta.acl` opcional com papéis `READER`/`EDITOR`/`PUBLISHER`/`ADMIN` (`schemaVersion: 4`, aditiva). ACL vazia = modo aberto. Enforcement fino na interface; o servidor recusa gravação de `READER`. |
| **Data / gatilho** | 2026-08-14, pedido de "visão mais amarrada de identificação dos usuários". |
| **Páginas afetadas** | `14-plataforma-local.md` §6, `02-arquitetura.md` §6, `03-modelo-do-documento.md` (na S29), `01-visao-e-escopo.md` §3.1 |

**Contexto.** As alternativas eram manter o nome digitado (identidade fraca — qualquer um digita
qualquer coisa), criar login/senha próprio (atrito diário, senha para esquecer, e uma promessa de
segurança que a arquitetura de arquivo compartilhado não pode cumprir) ou autenticação Windows
integrada de verdade (SSPI/Kerberos — complexidade desproporcional para um processo local).

**Justificativa.** O login de rede capturado na máquina do próprio usuário é gratuito, não
falsificável por descuido (ninguém "esquece" de trocar o nome) e é exatamente o identificador que
uma auditoria interna reconhece. Papéis no documento dão o controle organizacional que faltava
(quem pode publicar, quem pode carregar) sem fingir ser segurança: quem tem escrita na pasta
edita o JSON na mão, e a documentação continua dizendo isso explicitamente.

## ADR-004: evidências em acervo gerenciado, navegável e em claro — nunca opaco

| Campo | Conteúdo |
|---|---|
| **Decisão** | Anexar evidência = **copiar** o arquivo para `_evidencias/` na pasta de rede, em estrutura legível por humanos (`{projeto}/{matriz}/{versão}/{data}_{nome original}`), com SHA-256 registrado no documento. **Sem criptografia, sem nomes opacos, sem banco de blobs.** Evidência é imutável; excluir move para `_evidencias/_lixeira/`, nunca apaga. |
| **Data / gatilho** | 2026-08-14, necessidade de anexar arquivos de evidência (DBs, ofícios) às políticas. |
| **Páginas afetadas** | `14-plataforma-local.md` §7, `03-modelo-do-documento.md` (na S30), `11-operacao.md` §1–§2 |

**Contexto.** As alternativas eram (a) só referenciar caminhos de rede existentes (zero cópia,
mas o link quebra silenciosamente quando alguém move o arquivo — inaceitável para evidência de
auditoria), (b) acervo opaco/criptografado com nomes por hash (integridade máxima, mas os
arquivos ficam reféns da aplicação), (c) acervo gerenciado em claro.

**Justificativa.** O requisito decisivo é o cenário de desastre: **se a aplicação quebrar, o
time precisa continuar acessando os arquivos históricos pelo Explorer**. Por isso o acervo é um
diretório comum, navegável, com nomes originais preservados — a aplicação é a porta de entrada
preferencial, não a única. A integridade que a criptografia daria vem do hash: o documento
registra o SHA-256 e o download confere, o que detecta adulteração/corrupção sem esconder nada.
A cópia (em vez da referência) garante que o link não quebra, porque o acervo pertence à
aplicação e a regra operacional é "não renomear nem mover" (`11-operacao.md` §1).

## ADR-005: FastAPI com instalação em camadas — venv + índice pip + wheels offline embarcadas

| Campo | Conteúdo |
|---|---|
| **Decisão** | O servidor usa **FastAPI + uvicorn** (+ `python-multipart`), instalados por `instalar.bat` numa venv descartável: tenta o índice pip corporativo primeiro e cai para as **wheels Windows x64 embarcadas** no pacote (`pip install --no-index --find-links wheels`). O `iniciar.bat` do dia a dia não instala nada e não bloqueia. Segurança de processo: bind exclusivo `127.0.0.1`, token aleatório por boot em `X-PolicyOps-Token`, zero rede externa. |
| **Data / gatilho** | 2026-08-14, junto com ADR-001. |
| **Páginas afetadas** | `14-plataforma-local.md` §3, §5, §9, `02-arquitetura.md` §2 |

**Contexto.** A alternativa conservadora era um servidor 100% stdlib (`http.server`), imune a
pip bloqueado. O usuário preferiu FastAPI pela produtividade e manutenção, **desde que** o time
final só execute um `.bat` sem nenhuma intervenção.

**Justificativa.** O risco do pip corporativo é neutralizado embarcando as wheels no próprio
artefato publicado — a instalação vira determinística e offline. O padrão inteiro (venv em
camadas com contingência de wheels, launcher que orienta em vez de travar, bind local + token) é
transcrição do que já roda em produção no mesmo ambiente corporativo no AppCreditoSimulador
(`release/iniciar.bat`, `release/python/instalar_motor.bat`, DEC-HX-008 daquele projeto) — não é
aposta, é reuso de solução validada. Contrapartida assumida: cada dependência Python nova exige
wheel embarcada, por isso a lista é fechada em três e ampliá-la requer aprovação explícita.

## ADR-006: o custo de contexto das sessões é tratado como requisito de arquitetura

| Campo | Conteúdo |
|---|---|
| **Decisão** | Adotar os guardrails de consumo de contexto da metodologia (skill `especificacao-e-sessoes`): `CLAUDE.md` como índice enxuto com mapa "onde vive o quê", documentação em camadas, guard mecânico de tamanho no CI, âncoras de região nos arquivos grandes e pesquisa exploratória via subagent. A reorganização é a sessão S31 — **extração incremental, nunca reescrita big-bang**. |
| **Data / gatilho** | 2026-08-14, sintoma relatado: custo alto de tokens a cada ajuste/evolução. |
| **Páginas afetadas** | `CLAUDE.md`, `09-roadmap-de-entregas.md`, prompt `S31` |

**Contexto.** O repositório chegou a ~45 mil linhas de TS e ~4.200 linhas de documentação
normativa. Cada sessão de evolução paga um custo fixo de boot mais Reads extensos — o mesmo
sintoma diagnosticado e resolvido no AppCreditoSimulador (corte de ~92% do custo de boot), cuja
estrutura (`CLAUDE.md` índice ≤450 linhas + docs em camadas + `check-claude-md` no CI) serve de
modelo pronto.

**Justificativa.** O custo de tokens é recorrente e cresce com o produto; tratá-lo como
"incômodo" garante que piore. Tratá-lo como requisito — com teto mecânico e estrutura de
camadas — o torna estável: feature nova passa a custar 1 linha de índice + 1 doc de domínio, e
sessões leem por ponteiro em vez de por varredura.

## ADR-007: âncoras de região são um comentário `// #region: <slug>` só, sem par de fechamento

| Campo | Conteúdo |
|---|---|
| **Decisão** | Nos arquivos de `src/` acima de ~600 linhas, cada seção lógica ganha um comentário `// #region: <slug-kebab-case>` logo no início (derivado do título já existente, quando havia um bloco divisor `// ---...---`). **Sem** `// #endregion` de fechamento — o contrato é `grep -rn "// #region:" src/`, não dobra/expande de editor. Nenhum código foi movido ou renomeado; a extração de módulo fica para quando uma sessão futura tocar o arquivo por outro motivo (incremental, nunca big-bang). Índice em `docs/claude/Mapa-de-regioes.md`. |
| **Data / gatilho** | 2026-08-14, sessão S31 (ADR-006), execução das âncoras de região (G5). |
| **Páginas afetadas** | `docs/claude/Mapa-de-regioes.md` (novo), `CLAUDE.md` § Onde vive o quê |

**Contexto.** O AppCreditoSimulador (modelo pronto citado na ADR-006) usa `// ═══ REGIÃO: <nome>
═══` com um mapa por arquivo (`docs/claude/Mapa-App.md`) para o único arquivo gigante daquele
projeto (`App.jsx`, um componente). O PolicyOps tem 17 arquivos acima de ~600 linhas espalhados
entre `src/core/` e `src/components/` — um mapa por arquivo teria virado 17 documentos pequenos
por pouco ganho; a alternativa avaliada era não ter marcador nenhum e confiar só nos nomes de
função exportada, mas isso não ajuda em arquivos com muita lógica não-exportada entre as seções
(ex.: os componentes React grandes) nem permite grep único do repositório inteiro.

**Justificativa.** Um único slug ASCII grep-ável por seção, sem par de fechamento, é o menor
comprometimento que ainda cumpre o objetivo (navegação por 1 grep) sem impor uma sintaxe de
editor (dobra/expande) que a base de código não usava até aqui. Um `Mapa-de-regioes.md` único
para o repositório inteiro (em vez de 17 arquivos) evita o próprio problema que a S31 existe
para resolver: mais um lugar sujeito a desatualizar. A maioria das seções (13 dos 17 arquivos)
já tinha blocos divisores com título — a âncora reaproveita esse título como slug em vez de
inventar um vocabulário novo, então a maior parte do trabalho foi mecânico (script de uso único,
descartado depois da sessão) em vez de julgamento arquivo por arquivo.

**Trade-off aceito.** Sem `#endregion`, o editor não dobra a seção automaticamente — aceito
porque o caso de uso real é "onde fica X" (grep), não "recolher tudo e ver o esqueleto do
arquivo" (que os blocos divisores já existentes, em 13 dos 17 arquivos, resolvem sozinhos com
`// ---...---`).

---

## DEC-CARGA-001: uma matriz por canal de venda

| Campo | Conteúdo |
|---|---|
| **Decisão** | Cada linha da tabela de origem produz **uma matriz por coluna de oferta** (teto, geral, digital, URA, PAP, outbound): 17 partições × 6 canais = 102 matrizes, cada uma com o grid enxuto de 21 × até 27. |
| **Data / gatilho** | 2026-08-10, análise do `CINEMINHA_20260708.csv` para a carga inicial. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §1, §5.3 |

**Contexto.** Uma célula do PolicyOps guarda uma oferta só, e a extração traz seis valores por
combinação de perfil. As alternativas eram: (a) canal como nível do eixo X, produzindo 17 matrizes
de 126 colunas; (b) uma matriz por canal, produzindo 102 matrizes enxutas; (c) guardar só o teto na
célula e os cinco canais em `attrs`.

**Justificativa.**

- Os canais não são derivados: verificado nos dados que só 34% das linhas têm os seis valores
  iguais, e que a URA fica zerada em 51% das linhas contra 25% do digital. O canal carrega decisão
  de política de verdade, então precisa ser dado de primeira classe — o que elimina (c), onde o
  canal não aparece no grid, não entra na legenda e o diff só sabe dizer "attrs mudou".
- O grid de cada matriz continua sendo o "cineminha" que a área já lê hoje (21 × até 27), em vez
  de um grid de 126 colunas com seis blocos quase idênticos — o que elimina (a).
- Versionamento por canal é a granularidade mais fina possível de lastro: "em julho mudou só o
  digital do G4 Risco Alto" é uma frase que a linha do tempo passa a produzir sozinha.

**Trade-off aceito.** 102 matrizes num projeto só, e uma carga que pode criar dezenas de rascunhos
de uma vez. Mitigado por tags e filtro (DEC-CARGA-003) e pela fila de revisão (DEC-CARGA-005).

---

## DEC-CARGA-002: um projeto só, com código composto

| Campo | Conteúdo |
|---|---|
| **Decisão** | As 102 matrizes vivem no projeto existente `POLITICA_B2C`, com código composto pelas colunas de partição e pelo canal (`MTZ_G4_RISCO_ALTO_DIGITAL`), gerado por padrão com marcadores. |
| **Data / gatilho** | 2026-08-10, mesma discussão de DEC-CARGA-001. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §5.4 (`codeTemplate`), §6.1 |

**Contexto.** Com 102 matrizes, a alternativa era quebrar em projetos (um por canal, ou um por
cluster) para dar navegação.

**Justificativa.**

- Projeto é a unidade de portfólio e de vigência (`getPortfolioAt`); quebrar por canal daria uma
  navegação boa mas fixaria **uma** hierarquia, e a área precisa cortar por canal, por cluster e
  por risco conforme a pergunta.
- Tags resolvem a navegação em N dimensões sem congelar nenhuma (DEC-CARGA-003).
- Mantém a política B2C inteira como um portfólio único, que é como ela é aprovada.

**Trade-off aceito.** Lista de 102 itens na barra lateral e portfólio de 102 cards na tela de
vigência — só toleráveis porque o filtro por tag existe.

---

## DEC-CARGA-003: tags de matriz com grupo, no catálogo

| Campo | Conteúdo |
|---|---|
| **Decisão** | Matrizes ganham `tags: string[]`, referenciando `CatalogItem` de kind `TAG`, que passa a ter `group?: string`. O usuário cria tags livremente enquanto cadastra; a busca filtra por facetas de grupo. |
| **Data / gatilho** | 2026-08-10, pedido explícito do usuário ao escolher projeto único. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §4, §5, §9; `07-ux-e-editor.md` §15; `12-carga-de-matrizes.md` US-09 |

**Justificativa.**

- O kind `TAG` já existe no catálogo desde a S08 — reaproveitá-lo dá rótulo, cor, arquivamento e
  renomeação de graça, em vez de inventar um registro paralelo de tags livres.
- `group` transforma uma lista plana em facetas (`Canal: Digital` **e** `Cluster: G4`), que é a
  forma como a pergunta real é feita.
- A carga preenche as tags a partir das colunas de partição e da dimensão desdobrada, então as 102
  matrizes nascem classificadas sem trabalho manual.

**Trade-off aceito.** Tags são referência viva (renomear muda a exibição em toda parte, inclusive
no histórico) — a mesma decisão já tomada para os demais itens de catálogo
(`05-regras-de-negocio.md` §5.5).

---

## DEC-CARGA-004: decisão derivada da oferta, com a oferta preservada

| Campo | Conteúdo |
|---|---|
| **Decisão** | A célula carregada recebe as duas coisas: `offer` com o item de catálogo do valor lido (inclusive `OFERTA_0`) e `decision` derivada por tabela de regras do perfil (`OFERTA_0 → REPROVADO`, demais → `APROVADO`). |
| **Data / gatilho** | 2026-08-10; a extração não tem coluna de decisão e I6 exige decisão em toda célula para publicar. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` US-05, CT-08, RN-11 |

**Justificativa.**

- Guardar o valor da oferta como decisão misturaria dois conceitos e mataria o resumo semântico do
  diff, que classifica decisões em aprovadoras e reprovadoras (`05-regras-de-negocio.md` §4.3).
- Guardar só a decisão perderia o valor da oferta, que é o que a célula precisa exibir.
- Com os dois campos, a comparação entre cargas passa a dizer "8 células fechadas, 4 ofertas
  alteradas" sem nenhum trabalho extra.

**Trade-off aceito.** A regra de derivação é configuração do perfil, não invariante: mudar a regra
entre duas cargas produz diferença de decisão sem que nenhuma oferta tenha mudado. Por isso a
tabela de regras é exibida no passo 4 e gravada no perfil, dentro do documento.

---

## DEC-CARGA-005: a carga para no rascunho

| Campo | Conteúdo |
|---|---|
| **Decisão** | A carga nunca publica. Cria matriz nova em `DRAFT` e rascunho v(n+1) nas alteradas, e entrega uma fila de revisão onde a publicação é feita item a item (ou em lote, só dos revisados). |
| **Data / gatilho** | 2026-08-10, escolha explícita do usuário: "o usuário precisa revisar cada um deles para aprovar a publicação". |
| **Páginas afetadas** | `12-carga-de-matrizes.md` US-07, RN-10, §6.2 |

**Justificativa.**

- Política de crédito em vigor sem revisão humana é o pior modo de falha do produto.
- Publicar exige nota de ao menos 10 caracteres e vigência (`05-regras-de-negocio.md` §1.3) —
  decisões que pertencem a quem revisa, não ao arquivo.
- O rascunho já é o lugar natural: ele existe, tem diff, tem descarte, e a tela de Rascunhos já
  lista tudo o que está pendente.

**Trade-off aceito.** Uma carga com 30 matrizes alteradas exige 30 revisões. Mitigado pelo lote
"publicar revisados" e pelo fato de que, na prática, a maioria das matrizes vem inalterada
(DEC-CARGA-006).

---

## DEC-CARGA-006: matriz inalterada não recebe rascunho

| Campo | Conteúdo |
|---|---|
| **Decisão** | Matriz cujo conteúdo é idêntico ao da versão publicada não recebe rascunho, versão nem evento. A carga é seletiva por natureza, e a segunda carga do mesmo arquivo produz zero alterações. |
| **Data / gatilho** | 2026-08-10, requisito central do usuário: "somente para aqueles que realmente alterar… não que toda carga sempre crie novos e percamos o lastro". |
| **Páginas afetadas** | `12-carga-de-matrizes.md` RN-02, RN-05, CT-01, CT-02 |

**Justificativa.**

- É o que faz a linha do tempo de cada matriz significar alguma coisa: uma versão nova passa a ser
  evidência de mudança real, não subproduto do calendário.
- Torna a idempotência testável (CT-01), e idempotência é a única forma barata de provar que o
  motor de comparação está correto.
- Reduz o crescimento do arquivo: sem isso, cada carga mensal acrescentaria ~2,5 MB de células
  duplicadas.

**Trade-off aceito.** Não existe registro de "a carga passou por aqui e nada mudou" na matriz — só
no evento `IMPORT_RUN` do documento, que guarda o total de inalteradas. É deliberado: o evento fica
no documento, não em 99 matrizes.

---

## DEC-CARGA-007: o perfil de carga mora no documento

| Campo | Conteúdo |
|---|---|
| **Decisão** | O mapeamento (papéis de coluna, de-para de valores, regras de decisão, tags, padrões de código) é gravado em `importProfiles`, no topo do documento, elevando `schemaVersion` para 3 com migração 2→3. |
| **Data / gatilho** | 2026-08-10, escolha do usuário entre documento, arquivo separado e `localStorage`. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §7.1, §9, §10; `12-carga-de-matrizes.md` US-08 |

**Justificativa.**

- O perfil **é** documentação: ele registra como a tabela corporativa se traduz no modelo de
  política. Guardá-lo fora do documento espalha a verdade em dois lugares.
- Viaja com o `.json` no SharePoint: qualquer pessoa do time faz a carga seguinte sem remontar o
  mapeamento, que é o requisito de "processo reutilizável".
- `localStorage` seria por máquina e por navegador; arquivo separado seria mais um artefato para
  perder e para versionar à parte.

**Trade-off aceito.** Uma migração de schema a mais e algumas dezenas de KB no documento.

---

## DEC-CARGA-008: o arquivo pode montar a biblioteca, mas em passo explícito

| Campo | Conteúdo |
|---|---|
| **Decisão** | O assistente propõe variáveis, domínios, itens de catálogo e o mapa de compatibilidade deduzidos do arquivo, mas isso é um passo próprio, revisável e anterior; a aplicação de células **nunca** cria entidade de biblioteca. |
| **Data / gatilho** | 2026-08-10; o `CINEMINHA` traz 28 domínios de faixa e o mapa de compatibilidade completo, e digitá-los à mão seria a maior parte do custo da carga inicial. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` US-04, RN-17 |

**Justificativa.**

- O arquivo já contém a informação: os pares (modelo adicional, faixa) que aparecem nele **são** o
  mapa de compatibilidade, e os valores distintos de cada coluna de eixo são os domínios.
- Separar o passo mantém a biblioteca sob controle de quem edita a política: nada nasce sem alguém
  ver a lista.
- Usar os comandos normais (`variable/*`, `compat/*`, `catalog/*`) evita um caminho privilegiado de
  escrita que escaparia das invariantes e da auditoria.

**Trade-off aceito.** A carga inicial tem um passo a mais. Nas cargas seguintes ele desaparece
sozinho, porque não há pendência.

---

## DEC-CARGA-009: divergência estrutural bloqueia a matriz inteira

| Campo | Conteúdo |
|---|---|
| **Decisão** | Quando o arquivo traz uma combinação que não existe nos eixos da matriz, a matriz inteira fica `ESTRUTURA DIVERGENTE` e é ignorada pela aplicação — nunca aplicada em parte. A resolução assistida (S25, `src/core/import/structural.ts` + `apply-structural.ts`) automatiza o **caminho de biblioteca e o resnapshot** — nunca a aplicação de célula em si, que continua pela carga normal na passada seguinte. Ver DEC-CARGA-017. |
| **Data / gatilho** | 2026-08-10, desenho do plano de carga. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` RN-06, CT-03, §7 |

**Justificativa.**

- `tuples` é snapshot congelado e só muda por ato explícito do usuário
  (`05-regras-de-negocio.md` §5); a carga não é esse ato.
- Aplicar as células que "cabem" e descartar as que não cabem deixaria a matriz num estado que
  ninguém pediu e que o diff não explica.
- Bloquear por matriz, e não a carga inteira, mantém as outras 101 aplicáveis.

**Trade-off aceito.** Enquanto a S25 não existir, uma faixa nova exige o caminho manual: publicar
nova versão da variável, criar rascunho, adotar (`axis/resnapshot`) e recarregar.

---

## DEC-CARGA-010: o plano é recalculado na aplicação

| Campo | Conteúdo |
|---|---|
| **Decisão** | `import/apply` recebe o `planHash` do plano revisado, recalcula o plano sobre o documento corrente e falha com `IMPORT_PLAN_STALE` se divergir — sem gravar nada. |
| **Data / gatilho** | 2026-08-10, desenho do comando; o documento pode mudar entre a revisão e a confirmação (undo, outra edição, recuperação de buffer). |
| **Páginas afetadas** | `12-carga-de-matrizes.md` RN-14, CT-11, §5.4 |

**Justificativa.**

- Comando é puro e valida antes de tocar (`08-camada-de-comandos.md` §1): aplicar um plano
  calculado contra outro estado violaria essa regra na prática, ainda que não na assinatura.
- O mesmo raciocínio já existe na persistência, com detecção de conflito por revisão
  (`06-persistencia-e-concorrencia.md` §5).

**Trade-off aceito.** O plano é calculado duas vezes; a menos de 1 s para 102 matrizes, é barato
diante do risco de sobrescrever trabalho alheio.

---

## DEC-CARGA-011: matriz nova suprime o que o arquivo não observa

| Campo | Conteúdo |
|---|---|
| **Decisão** | Ao **criar** uma matriz, a carga marca como suprimidas (`axis.manualSuppressions`) as tuplas de eixo que o arquivo não traz em nenhuma linha. Em matriz já existente isso nunca acontece: ausência de linha segue `missingRowPolicy`. |
| **Data / gatilho** | 2026-08-10; ao dimensionar os eixos do caso real, o produto de eixos gerou 110 tuplas em Y para cineminhas que usam 21 ou 22. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` RN-21, CT-16, §5.4; `04-eixos-aninhados.md` §5.4 (o mecanismo) |

**Contexto.** A variável do nível externo do eixo Y é uma só para todas as matrizes — seis modelos
adicionais no caso real —, mas cada cineminha usa um ou dois deles. Sem supressão, cada matriz
nasceria com centenas de combinações pendentes que jamais seriam preenchidas, e I6 impediria a
publicação para sempre. As alternativas eram: uma variável de modelo por cluster, ou uma regra de
compatibilidade que dependesse da partição.

**Justificativa.**

- Supressão manual é o mecanismo que a arquitetura já criou para exatamente isso
  (`04-eixos-aninhados.md` §5.4): explícita, visível na interface como "88 combinações
  suprimidas", restaurável e auditada.
- Uma variável de modelo por cluster multiplicaria a biblioteca por sete e quebraria a
  comparabilidade entre cineminhas, que é o que permite comparar o mesmo canal entre clusters.
- Compatibilidade é por par de variáveis, não por matriz — "quais modelos existem neste
  cineminha" é informação da matriz, não da biblioteca. Colocá-la numa regra global seria mentir
  sobre o significado da regra.

**Trade-off aceito.** Matrizes nascem com uma lista de supressões relativamente longa (83 a 108
tuplas), e o alerta de `04-eixos-aninhados.md` §5.4 — "se o escape hatch começar a ser usado em
escala, reabra o desenho" — passa a valer com uma ressalva registrada aqui: neste caso o uso em
escala é esperado e correto, porque a assimetria é por matriz, não por regra.

---

## DEC-CARGA-012: severidade no problema, e o plano bloqueia por inteiro ou por matriz

| Campo | Conteúdo |
|---|---|
| **Decisão** | `ImportIssue` carrega `severity` derivada do código: os códigos de §5.8 são `ERROR` e bloqueiam o plano inteiro (`matrices: []`); os códigos de aviso descrevem o que a carga fez e, no máximo, bloqueiam **uma** matriz, que sai `BLOCKED` com `reason`. |
| **Data / gatilho** | 2026-08-11, S21: o plano tem uma única lista `issues`, e a interface precisa saber o que impede de avançar sem interpretar código por código. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §5.4, §5.5, §5.8 |

**Contexto.** `parseDelimitedTable` devolve `warnings` e `errors` separados, mas `ImportPlan` tem
uma lista só. Sem severidade explícita, a tela teria de manter a sua própria tabela de "o que é
grave", que sairia do lugar na primeira mudança do motor. Faltava também vocabulário para o que a
carga faz e precisa dizer — conferência divergente, linha ignorada, combinação sem linha, tuplas
suprimidas —, que não é erro nenhum.

**Justificativa.**

- Severidade é propriedade do **código**, não da situação: o mesmo `IMPORT_UNMAPPED_VALUE` sempre
  bloqueia, sempre pelo mesmo motivo (RN-16). Derivá-la em `issues.ts` mantém uma única verdade.
- Plano com erro não classifica matriz alguma: "nenhuma matriz do plano é aplicável" (CT-05) fica
  verdadeiro por construção, sem um campo `applicable` por linha que alguém pudesse esquecer de
  checar.
- Problema de uma matriz continua sendo de uma matriz (DEC-CARGA-009): rascunho aberto, grid acima
  do teto ou falta de versão-base viram `BLOCKED` com aviso, e as outras 101 seguem aplicáveis.

**Trade-off aceito.** Um erro num canto do arquivo esconde o plano inteiro — inclusive as matrizes
que estavam perfeitas. É o comportamento que o assistente quer no passo 3 (resolver a pendência
antes de ver o plano), e o custo é recalcular o plano depois da correção, que leva menos de 1 s.

---

## DEC-CARGA-013: o plano descreve os eixos da matriz nova

| Campo | Conteúdo |
|---|---|
| **Decisão** | `MatrixPlan.axes` traz, só nas matrizes `NEW`, os eixos projetados: pins de versão de variável, snapshot de domínios, tuplas efetivas e `manualSuppressions`. `projectImportAxes(doc, profile)` expõe a mesma projeção sem a supressão por matriz. |
| **Data / gatilho** | 2026-08-11, S21: RN-21 fala em tuplas suprimidas, e `suppressedCombinations` (um número) não diz **quais**. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §5.4, CT-16 |

**Contexto.** A aplicação (S24) precisa criar a matriz com exatamente os eixos que o plano
prometeu, e o plano precisa poder ser revisado — "88 combinações marcadas como inexistentes" só é
auditável se der para ver quais são.

**Justificativa.**

- Uma projeção só: se a S24 recalculasse os eixos por conta própria, passariam a existir duas
  respostas para "como esta matriz nasce", e elas divergiriam no primeiro `variable/publish` entre
  o plano e a aplicação.
- A projeção é por **perfil**, não por matriz: os níveis vêm das colunas de eixo, então ela é
  calculada uma vez por carga e compartilhada pelas 102 linhas do plano. Só o recorte de tuplas
  muda de matriz para matriz.
- Matriz existente não ganha `axes`: os eixos dela são os da versão publicada, que a carga nunca
  altera (RN-01).

**Trade-off aceito.** O plano fica maior — cada matriz nova carrega a lista de supressões. Em
troca, `import/apply` vira uma transcrição do plano revisado, sem decisão nova na hora de gravar.

---

## DEC-CARGA-014: quatro ajustes do assistente descobertos ao implementar a S22

| Campo | Conteúdo |
|---|---|
| **Decisão** | Quatro decisões de implementação, pequenas mas não óbvias a partir dos documentos anteriores, tomadas ao construir o assistente (`src/components/import/`): (1) drop-zone própria por passo, não o `DropTarget` global; (2) o passo 2 não pode exigir que os eixos já estejam publicados; (3) o diff do plano não embute `CompareView`; (4) o código de decisão nasce no próprio passo 4. |
| **Data / gatilho** | 2026-08-11, S22 — cada uma apareceu como um bloqueio real ao rodar o assistente ponta a ponta contra o recorte do CINEMINHA. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §6.1.1, `07-ux-e-editor.md` §14 |

**(1) `FileDropZone` própria, não o `DropTarget` global.** O `DropTarget` de `02-arquitetura.md`
escuta `drop` em `window` inteiro e sempre chama `openDroppedFile`, que tenta abrir o arquivo
solto **como documento**. Um `.csv` da extração não é um documento — reaproveitar o componente
global faria o shell tentar interpretar o cineminha como um `.json` inválido. A drop-zone do passo
1 é local ao elemento e chama `stopPropagation` no `drop`, para o evento não subir até o listener
global. "Reaproveitar `DropTarget`" (texto da sessão) vale como reaproveitar o padrão visual e de
interação — borda tracejada, overlay "solte o arquivo" —, não a instância que abre documentos.

**(2) O passo 2 não pode travar em "variável de eixo sem versão publicada".** Numa carga inicial,
as variáveis de eixo mapeadas no próprio passo 2 (via "+ Nova variável") nascem sem domínio nem
publicação — só o passo 3 resolve isso. Se o cálculo de tamanho de grid (I16) exigisse a
publicação para responder, o passo 2 nunca teria "Avançar" liberado numa carga inicial, e não
haveria como chegar ao passo 3 para publicar. `checkGridSize` por isso devolve um terceiro estado,
`PENDING` (distinto de `OK` e `OVER`), que não bloqueia — o teto de 6.000 continua sendo aplicado
de verdade por `planImport` no passo 5, que é quem tem autoridade sobre I16 (RN-18).

**(3) O passo 5 não embute `CompareView` no diff de uma matriz.** `CompareView` (`07-ux-e-editor.md`
§9) compara duas versões que já existem no documento. Uma matriz `NEW` do plano não tem nenhuma —
"antes" e "depois" teriam que ser sintetizados só para a tela, dobrando a lógica que `plan.ts` já
resolveu internamente (`syntheticVersion`, não exportado). Expandir uma matriz no passo 5 lista
`plan.changes` diretamente (célula, campo, antes/depois), que é exatamente o resultado que
`planImport` já calculou via `src/core/diff/` — sem reconstruir nada.

**(4) O código de decisão nasce no passo 4, não é uma lacuna do passo 3.** Diferente de domínio,
oferta ou compatibilidade — que vêm de valores **do arquivo** —, a decisão é uma classificação que
o perfil impõe (`decisionRules`, DEC-CARGA-004): o arquivo não traz nenhuma coluna "decisão", então
não há como o passo 3 propor `APROVADO`/`REPROVADO` a partir de dados observados. E como
`decisionRules` só existe depois que o usuário o preenche no passo 4, um código de decisão
referenciado ali só apareceria como lacuna do passo 3 numa segunda visita — um usuário que nunca
volta ao passo 3 depois do passo 4 ficaria sem meio de criar o item. O select de decisão do passo 4
ganha "Novo código de decisão…", que despacha `catalog/create` ali mesmo e já seleciona a regra —
tags continuam vindo do passo 3 (kind `TAG`), porque são derivadas de valores observados
(partição/desdobramento), o mesmo caso dos domínios e ofertas.

**Trade-off aceito.** Nenhuma das quatro altera contrato do motor da S21 nem invariante do
documento — são só onde, na composição de tela, cada responsabilidade fica. Registradas juntas
porque nenhuma seria óbvia de prever sem montar o assistente inteiro e rodá-lo contra um arquivo
real.

## DEC-CARGA-015: o passo 5 volta a usar `CompareView`, sobre um documento descartável

| Campo | Conteúdo |
|---|---|
| **Decisão** | Expandir "Ver diff" numa matriz do plano abre o `CompareView` de `07-ux-e-editor.md` §9 dentro do assistente. O par de versões que ele exige é montado por `src/components/import/plan-preview.ts`: um documento **descartável**, em memória, com uma matriz sintética de duas versões — o "antes" (a publicada, ou o grid vazio numa matriz nova) e o "depois" (o mesmo grid com as células da carga aplicadas). Substitui o item (3) de DEC-CARGA-014; a lista direta de `plan.changes` continua existindo como a expansão rápida da linha. |
| **Data / gatilho** | 2026-08-11, S24 — a S22 tinha decidido contra por custo, e a S24 pede o `CompareView` explicitamente. |
| **Alternativas** | (a) manter só a lista de `plan.changes` — barata, mas a revisão de um grid de 567 combinações lida célula a célula numa lista é ilegível, e era justamente a tela que já existia para isso que se estava recusando a usar; (b) exportar `syntheticVersion` de `plan.ts` e montar a `EditorView` à mão no componente — duplicaria a construção de `EditorView`, que tem cabeçalho aninhado, catálogo e estatísticas. |
| **Por quê** | O custo estimado na S22 estava errado, e o erro tinha uma causa identificável: assumiu-se que faltava *tela*, quando o que faltava era só o **par de versões**. `CompareView` já é componente de apresentação puro — nasceu assim para servir também ao diálogo de conflito, onde uma das pontas vem de um documento que nem está aberto (`06-persistencia-e-concorrencia.md` §5). Montar o par é uma função de trinta linhas que reusa `getEditorView` e `diffVersions` sem tocar em nenhuma das duas. E o documento descartável não é um risco novo: ele nunca é despachado, nunca chega ao store, e as funções que o leem são as mesmas funções puras de leitura de sempre. |
| **Custo aceito** | Um documento a mais em memória por diff aberto (`{ ...doc, matrices: [uma] }` — cópia rasa, o custo real é o das células daquela matriz), e um `PlanPreview` que precisa ser mantido em sintonia com `MatrixPlan` se `plan.ts` mudar a forma de `axes`/`changes`. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §6.1.2, `07-ux-e-editor.md` §14, `13-decisoes.md` DEC-CARGA-014 (item 3 superado) |

## DEC-CARGA-016: "revisado" é estado de interface, não campo do documento

| Campo | Conteúdo |
|---|---|
| **Decisão** | A marca "revisado" da fila de revisão vive em `ui-store` (`reviewedVersionIds`), junto com o filtro por `importRunId`. Não é campo de `MatrixVersion`, não entra no `.json` e não sobrevive a recarregar a aplicação. |
| **Data / gatilho** | 2026-08-11, S24, US-07. |
| **Alternativas** | Um `reviewedAt`/`reviewedBy` na `MatrixVersion`, ou um evento `DRAFT_REVIEWED`. |
| **Por quê** | "Revisado" é uma marca de trabalho em andamento de uma pessoa numa sessão — o equivalente a riscar itens de uma lista enquanto se confere. O fato durável que o documento precisa registrar já existe e é outro: a **publicação**, com nota, autor e data. Gravar "revisado" no documento criaria um segundo estado de aprovação que ninguém consulta depois, sujeito a ficar mentindo (revisado por quem, contra qual conteúdo, se o rascunho mudou desde então?) — e I3/§8 não têm lugar para um campo mutável dessa natureza numa versão. Perder a marca ao recarregar é o comportamento certo: o que sobreviveu é o rascunho, e revisar de novo é barato. |
| **Custo aceito** | Quem fecha a aba no meio da revisão de 102 rascunhos remarca o que já tinha conferido. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §6.2, `07-ux-e-editor.md` §14 |

---

## DEC-CARGA-017: a resolução estrutural automatiza a biblioteca e o resnapshot, nunca a célula

| Campo | Conteúdo |
|---|---|
| **Decisão** | `import/applyStructural` (S25) resolve uma matriz `STRUCTURAL` executando, pelos comandos normais (RN-17): `variable/createDraft`+`saveDomains`+`publish` para os domínios que a variável ainda não tem, `compat/createDraft` (ou `compat/create`, se a regra não existir) +`saveMap`+`publish` para o mapa, `version/createDraft` na matriz e `axis/resnapshot` em cada eixo afetado. Tudo-ou-nada (o mesmo mecanismo de `import/apply`, §5.4). A combinação nova nasce **pendente** — sem célula —, exatamente como qualquer combinação nova de `axis/resnapshot` (`05-regras-de-negocio.md` §5.4): quem preenche o conteúdo é a carga normal (ou a edição manual), na passada seguinte. A resolução nunca remove domínio nem tupla, e nunca publica a matriz (RN-10) — ela para em rascunho, pronta para a fila de revisão de US-07. |
| **Data / gatilho** | 2026-08-11, S25. |
| **Como `planStructuralChanges` decide o que falta** | `resolveImport` só deixa passar, para uma coluna de eixo, um valor cujo código já é domínio **publicado** da variável (`IMPORT_UNMAPPED_VALUE` barra o resto e bloqueia o plano inteiro — RN-16). Por isso, na esteira normal do assistente (US-03/US-04 já resolvidos no passo 3), todo código que aparece em `MatrixPlan.unknownTuples` **já existe na biblioteca** quando o plano chega ao passo 5 — o caso comum de `STRUCTURAL` é a matriz **atrasada**: a combinação já existe na variável e no mapa de compatibilidade, só falta o resnapshot desta matriz específica. `deduceAxisChanges` (`structural.ts`) por isso decide "domínio novo" contra a versão **publicada atual** da variável, não contra o snapshot congelado da matriz — comparar contra o snapshot criaria um domínio "novo" que já existe e `variable/saveDomains` rejeitaria o código duplicado. O caminho de domínio genuinamente inédito continua implementado (é o que a sessão pede explicitamente, e cobre o caso de a variável ter evoluído por um caminho que não passou pelo passo 3), só não é o caminho mais frequente. |
| **Lote e biblioteca compartilhada** | Várias matrizes `STRUCTURAL` podem pedir exatamente a mesma mudança de biblioteca (as 6 matrizes de canal de uma partição, por exemplo). `mergeDomainChanges`/`mergeCompatibilityChanges` juntam os pedidos do lote selecionado por variável/par **antes** de aplicar, e `applyStructural` publica a variável e a regra **uma vez** para o lote inteiro — aplicar matriz a matriz chamaria `variable/createDraft` duas vezes para a mesma variável (`DRAFT_ALREADY_EXISTS`) ou tentaria recriar um domínio que a primeira matriz do lote já publicou. |
| **O que o "inverso íntegro" cobre** | O rascunho de cada matriz, o resnapshot e os rascunhos de variável/compatibilidade **enquanto ainda em rascunho** são revertidos pelo inverso normal de cada comando. A publicação da variável e da regra de compatibilidade são **irreversíveis por desenho em todo o PolicyOps** (I3 — `variable/publish` e `compat/publish` devolvem `irreversible(...)`, não um comando que desfaz). `applyStructural` não muda essa garantia: desfazer uma resolução já aplicada derruba o rascunho da matriz e o resnapshot, mas a biblioteca segue evoluída — o mesmo comportamento de qualquer outra publicação no sistema. Um "desfazer" que também rebaixasse a variável quebraria I3 (versão publicada é imutável) e reescreveria histórico que outra pessoa já pode ter lido. |
| **Fora do escopo (mantido)** | Remover domínio ou tupla pela carga; mudar a pilha de níveis de um eixo (`axis/addLevel` continua manual); publicar a matriz (RN-10) — a resolução termina em rascunho, como qualquer outra escrita da carga. Divergência de **subtração** (o arquivo deixou de trazer uma faixa) não é tocada pela resolução estrutural: a faixa continua no eixo e a célula segue `missingRowPolicy` (RN-07) na carga normal. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` RN-06, §5, §7; `05-regras-de-negocio.md` §5.4 |

---

## DEC-CARGA-018: a carga restaura uma matriz arquivada, por confirmação explícita — nunca sozinha

| Campo | Conteúdo |
|---|---|
| **Decisão** | Uma matriz arquivada mantém o código reservado no projeto (docs/05 §1.1) — isso não muda. O que muda é a saída: quando o código de uma matriz do plano bate com uma matriz arquivada, ela entra num estado próprio, `ARCHIVED` (antes era `BLOCKED` com o mesmo motivo de sempre — "restaure-a ou mude o padrão de código" — sem nenhum caminho de fato para restaurar). O passo 5 do assistente ganha um toggle por matriz, "Restaurar e aplicar", que nunca é marcado por seleção em massa. Confirmado — a chave entra em `restoreKeys`, um campo novo de `planImport`/`import/apply` — a matriz volta a ser comparada como qualquer matriz existente (`CHANGED`/`UNCHANGED`/`STRUCTURAL`/`BLOCKED` por outro motivo, na mesma ordem de sempre), e a aplicação desarquiva a matriz (mesmo comando interno que `matrix/archive` desfaz) antes de criar o rascunho — ou, se o conteúdo já bater, sem criar rascunho nenhum (RN-02 continua valendo). |
| **Data / gatilho** | 2026-08-12, usuário relatou que arquivar uma matriz e depois recarregar uma planilha com o mesmo código trava a carga em massa sem saída — a única forma de restaurar hoje é Ctrl+Z logo em seguida de arquivar (`ProjectDetail.tsx`, `MatrixScreen.tsx`), e quem carrega uma tabela meses depois já perdeu essa janela. |
| **Alternativas** | (a) um botão "Desarquivar" avulso na lista de matrizes do projeto — mais direto, mas o usuário pediu explicitamente a opção 2 (restaurar dentro do próprio fluxo de carga, sem tela separada); resolve também o caso mais comum, que é descobrir o problema já dentro do assistente; (b) a carga desarquivar sozinha, sem confirmação, sempre que o código bater — mais rápido, mas reviveria por engano qualquer matriz arquivada de propósito só porque uma planilha antiga com o mesmo código voltou a circular; rejeitada por isso. |
| **Por quê** | O código continuar reservado depois de arquivar é proposital (docs/05 §1.1, evita uma matriz nova nascer por cima do histórico de uma arquivada sem ninguém perceber). O problema não era essa regra — era não existir **nenhuma** saída dela fora do Ctrl+Z imediato. Resolver dentro do assistente, e não com um botão solto na lista de matrizes, mantém a restauração perto de onde a pessoa já está decidindo o que aplicar, com o diff da própria carga como contexto. A confirmação por matriz (nunca em massa) é a salvaguarda contra revivência acidental: `isApplicable` deliberadamente não inclui `ARCHIVED`, e mesmo uma matriz arquivada que virou `UNCHANGED` depois de restaurada exige o toggle marcado — sem ele, aplicar essa chave falha com `IMPORT_TARGET_ARCHIVED`, nunca desarquiva em silêncio. |
| **Custo aceito** | Um estado (`ARCHIVED`) e um campo (`archived`) a mais em `MatrixPlan`, e `restoreKeys` correndo em paralelo com `selectedKeys` em três lugares (`plan.ts`, `apply.ts`, `import-store.ts`) — par de conjuntos que precisa ficar sincronizado em vez de um só. Aceito porque misturar as duas seleções teria feito "marcar para aplicar" e "confirmar restaurar" a mesma caixa, exatamente o acoplamento que a confirmação explícita existe para evitar. Continua sem um jeito de desarquivar uma matriz **fora** de uma carga — quem quer restaurar sem ter uma planilha em mãos ainda depende do Ctrl+Z. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §5.4, §5.5, §5.8, US-05; `08-camada-de-comandos.md` §3 Carga de matrizes |

---

## DEC-CARGA-019: matriz arquivada e restaurada sem versão publicada vira NEW, não BLOCKED

| Campo | Conteúdo |
|---|---|
| **Decisão** | DEC-CARGA-018 devolve a matriz arquivada restaurada ao mesmo caminho de "matriz existente qualquer" — que, sem versão `PUBLISHED`, sempre travava em `BLOCKED` com "a matriz não tem versão publicada para servir de base à comparação" (`IMPORT_NO_BASE_VERSION`). Para uma matriz cujo único rascunho foi descartado **antes** de publicar (`version/discardDraft` queima o número e arquiva a versão, sem nunca ter passado por `PUBLISHED`), essa checagem nunca deixa de bloquear — restaurar não tem para onde ir, porque não existe versão nenhuma para `version/createDraft` derivar (`NO_VERSION_TO_DERIVE`). Agora, quando a matriz está arquivada **e** a chave está em `restoreKeys` **e** não há versão publicada, o plano deixa de checar "existe versão-base" e projeta eixos frescos a partir das versões publicadas atuais das variáveis — o mesmo caminho de `planNewMatrix`/`matrix/create` para uma matriz genuinamente nova —, com status `NEW` em vez de `BLOCKED`. A aplicação usa o comando interno novo `version/_createWithoutBase` (`src/core/versioning/lifecycle.ts`): mesma resolução de níveis e mesmas validações de `matrix/create` (I13, I14, I16), mas anexando a versão numerada `v(n+1)` à matriz **existente** (código já reservado) em vez de criar um `Matrix` novo — `version/createDraft` não serve porque sempre exige uma versão para clonar, mesmo arquivada. |
| **Data / gatilho** | 2026-08-12, mesmo dia de DEC-CARGA-018: o usuário seguiu exatamente o caminho que a decisão anterior abriu — arquivou as 4 matrizes G3 sem versão publicada (rascunho já descartado antes) pela tela de matriz, e recarregou o CSV. O plano mostrou `Arquivada` com "Restaurar e aplicar" (como esperado), mas ao marcar o toggle o status virava `Bloqueada` de novo com o mesmo motivo de sempre — a restauração não tinha nenhuma saída para esse caso, só para o caso (mais comum) de uma matriz que já foi publicada antes de ser arquivada. |
| **Alternativas** | (a) usar a versão `ARCHIVED` mais recente (a do rascunho descartado) como base do diff, via `version/createDraft({ baseVersionId })` — que já aceita derivar de qualquer versão, publicada ou não (é o mesmo mecanismo de "restaurar versão histórica" do §1.2); menor mudança (só `plan.ts`), reaproveita `applyChangedMatrix` sem tocar `lifecycle.ts`, mas herda eixos daquele rascunho tal como estavam no momento do descarte — se as variáveis dos eixos ganharam versão publicada nova depois disso, a matriz restaurada nasceria com eixos desatualizados, sem nenhum aviso. Rejeitada: perguntado ao usuário, a opção escolhida foi tratar como matriz nova de verdade. (b) a escolhida — projetar eixos do zero a partir das versões publicadas **atuais**, igual a uma matriz nova de fato; mais correto quando a biblioteca mudou entre o descarte e a restauração, ao custo de um comando novo em `lifecycle.ts` (`version/_createWithoutBase`) que duplica a resolução de níveis de `matrix/create` em vez de reaproveitar `version/createDraft`. |
| **Por quê** | O código reservado (docs/05 §1.1) nunca teve conteúdo publicado — não há "a versão anterior" para comparar nem para herdar eixos: é, na prática, a mesma pergunta que criar a matriz pela primeira vez, só que o código já existe. Tratar como matriz nova (opção b) mantém uma verdade só sobre "que eixos uma matriz teria hoje" — a mesma que `matrix/create` e `planNewMatrix` já respondem — em vez de deixar essa resposta depender de quando, meses atrás, alguém descartou um rascunho. `version/_createWithoutBase` não é comando de catálogo (mesmo espírito de `restoreArchivedMatrix`, DEC-CARGA-018): só `import/apply` compõe isto, e só para uma matriz `ARCHIVED` restaurada sem publicação alguma. |
| **Custo aceito** | Um comando interno a mais em `lifecycle.ts` que duplica a resolução de níveis/eixos de `matrix/create` (`resolveLevel`, `buildAxis`, as validações I13/I14/I16) em vez de reaproveitá-la — aceito porque `matrix/create` está amarrado a criar um `Matrix` novo (unicidade de código, `MATRIX_CREATED`), e forçar essa amarração a aceitar uma matriz já existente teria acoplado dois conceitos que hoje são independentes. `MatrixPlan.matrixId` definido numa entrada `status: 'NEW'` passa a significar "matriz restaurada sem publicação", não mais exclusivamente "matriz nova"; `apply.ts` decide entre `matrix/create` e `version/_createWithoutBase` checando esse campo. |
| **Páginas afetadas** | `12-carga-de-matrizes.md` §5.5 (tabela de status); `08-camada-de-comandos.md` §3 Carga de matrizes e Versões |

---

## DEC-GOV-001: a política vira árvore de componentes tipados — a matriz não vira "só mais um texto"

| Campo | Conteúdo |
|---|---|
| **Decisão** | O documento ganha `components: PolicyComponent[]` — árvore por projeto com tipos `SECTION`, `RULE`, `MATRIX`, `LIST`, `REASON_CODE`, `POLICY_VARIABLE`, `OTHER`, cada tipo com payload próprio e todos compartilhando o mesmo ciclo de versão/vigência das matrizes. |
| **Data / gatilho** | 2026-08-13, análise da Especificação Funcional da Jornada de Gestão de Alterações + documento real *Filtros e Critérios de Crédito B2C*. |
| **Alternativas** | (a) uma entidade "Regra" plana, sem árvore — não representa o sumário hierárquico real do documento de política (4 níveis) nem permite a fotografia histórica da política inteira; (b) forçar tudo (regras, listas, reason codes) a virar matriz — regra textual não é grid, produziria matrizes 1×1 artificiais e mataria a legibilidade; (c) documento rico único versionado por seção — perde o vínculo componente↔DB↔versão que é o coração da rastreabilidade pedida. |
| **Por quê** | O princípio da spec funcional (§33) é explícito: plataforma comum de governança com representações próprias por tipo. Compartilhar identificação, versão, vigência, histórico e relacionamento com alterações — e nada além — é exatamente o que o `versioning/` existente já sabe fazer; payloads tipados dão a cada componente sua forma sem inventar um segundo mecanismo de versão. |
| **Custo aceito** | Um schema novo grande (S32a) e telas de árvore/CRUD (S33). Tetos definidos para não degradar: profundidade 6, alerta em 300 e teto de 1.000 componentes por projeto. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3; `03-modelo-do-documento.md` (S32a) |

---

## DEC-GOV-002: componente MATRIX é espelho, nunca reversiona a matriz

| Campo | Conteúdo |
|---|---|
| **Decisão** | O nó de árvore `type: MATRIX` referencia `matrixId` e tem `versions: []` (invariante I23). Nome, estado, vigência, diff e timeline vêm da `Matrix` existente. Num DB, o item sobre uma matriz vincula um **rascunho da matriz** — o mecanismo atual, sem duplicação. |
| **Data / gatilho** | 2026-08-13, desenho do épico GOV. |
| **Alternativas** | (a) migrar `Matrix` para dentro de `PolicyComponent` — reescreveria o coração do produto (25 sessões, 6 invariantes I13–I22) para ganhar só um lugar na árvore; risco máximo, ganho mínimo; (b) duplicar a matriz num payload — duas fontes de verdade para a mesma vigência, corrupção histórica garantida no primeiro descompasso. |
| **Por quê** | A matriz já tem o versionamento mais maduro do sistema; a árvore precisa apenas apontá-la. Uma matriz referenciada por no máximo um componente mantém a fotografia histórica sem ambiguidade. |
| **Custo aceito** | A fotografia da política em uma data combina duas fontes (componentes + matrizes); telas de consulta precisam compor as duas — custo de leitura, não de integridade. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3.1, §6 (I23) |

---

## DEC-GOV-003: DB é entidade multi-componente com workflow de 12 estados

| Campo | Conteúdo |
|---|---|
| **Decisão** | `ChangeRequest` com 1..N itens (cada item = componente + tipo de alteração + atual×proposto + rascunho vinculado), status num grafo fixo (`14-governanca-de-alteracoes.md` §5) e trilha própria de eventos. Itens congelam a partir de `APPROVED` (I25). |
| **Data / gatilho** | 2026-08-13; DB-519 real altera regra de quantidade **e** regra de saída da Classe D no mesmo documento — 1 DB : 1 regra é ficção. |
| **Alternativas** | (a) um DB por componente — multiplicaria DBs artificiais para uma mudança de negócio única, contra a spec (§8); (b) workflow reduzido (rascunho→aprovado→publicado) — não representa devolução, desenvolvimento na fábrica e validação, que são os estados onde os DBs reais passam a maior parte da vida. |
| **Por quê** | O grafo espelha o processo real da área (fábrica desenvolve depois da aprovação; publicação é evento separado — RN-GOV-04). Congelar itens após aprovação é o que dá valor à assinatura do gestor: o que foi aprovado é o que será publicado. |
| **Custo aceito** | Máquina de estados com 12 estados exige disciplina de UI (ações visíveis por estado) e testes de transição exaustivos. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3.3, §5, §6 |

---

## DEC-GOV-004: workflow sem servidor central = governança processual, não autenticação

| Campo | Conteúdo |
|---|---|
| **Decisão** | Aprovação, papéis e "quem fez o quê" usam a identificação existente — o login de rede capturado pelo servidor local (ADR-003) quando disponível, ou o nome em `localStorage` nos modos sem servidor —, sem senha, sem criptografia, sem bloqueio técnico por papel além do enforcement organizacional já descrito em `14-plataforma-local.md` §6. A UI declara isso. Notificações viram o painel "Pendências" ao abrir o documento. Publicação direta sem DB continua possível, carimbada como tal (RN-GOV-07). |
| **Data / gatilho** | 2026-08-13; a spec funcional pede permissões e notificações, e a restrição de não existir servidor **central** (`01-visao-e-escopo.md` §3.1) torna autenticação real impossível no sentido forte. |
| **Alternativas** | (a) senha/PIN local por papel — segurança teatral: qualquer um edita o JSON; pior que declarar a limitação; (b) recusar o workflow inteiro até existir servidor central — jogaria fora o valor de padronização e rastro, que não dependem de autenticação real. |
| **Por quê** | O valor pedido (governança, rastreabilidade, padronização) é processual: registro de quem/quando/porquê com trilha imutável de eventos. É o mesmo contrato de confiança do `savedBy`/identidade Windows do épico Plataforma, que a área já aceita. Se um dia houver autenticação real, o modelo de dados já registra tudo que ela precisaria assinar. |
| **Custo aceito** | Uma aprovação pode ser forjada por quem editar o arquivo diretamente na pasta de rede — mitigado pelo histórico de versões/backups (`11-operacao.md` §2) e pela trilha de eventos, e explicitado na interface para ninguém supor segurança que não existe. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §2, §11; `01-visao-e-escopo.md` §2 |

---

## DEC-GOV-005: editor rico de blocos próprio, sem dependência nova

| Campo | Conteúdo |
|---|---|
| **Decisão** | `RichDoc` = lista de blocos tipados próprios (parágrafo, títulos, listas, tabela, imagem-anexo, callout, citação) com marcas inline mínimas, editado por componentes próprios sobre `contentEditable` por bloco. Nenhuma biblioteca de editor entra no bundle. |
| **Data / gatilho** | 2026-08-13; a spec pede editor "tipo Word" e o orçamento do bundle é 1,5 MB com ~todas as folgas já consumidas pelas S19–20. |
| **Alternativas** | (a) TipTap/ProseMirror — o padrão de mercado, mas ~150–300 KB gzip e dependência fora da lista do `02-arquitetura.md` §2; estouraria o orçamento ou forçaria novo aumento; (b) `contentEditable` livre com HTML salvo — HTML arbitrário no documento é indiffável, inseguro (sanitização) e quebra a promessa de `.json` legível; (c) Markdown puro em textarea — barato, mas sem tabela/imagem inline decentes, e a spec pede explicitamente imagens e tabelas. |
| **Por quê** | Blocos JSON tipados dão o que o produto realmente precisa do editor: serialização estável, diff por bloco, validação Zod e zero dependência. O teto de sofisticação (sem colunas, sem merge de células, sem embeds) é aceitável para especificação de política. |
| **Custo aceito** | Esforço de UI relevante (S34, Opus) e um editor menos polido que ProseMirror — colar do Word preserva texto e tabelas, não formatação completa. Imagens: ≤ 300 KB cada, redimensionadas no cliente, com aviso a partir de 3 MB de anexos no documento. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §7 |

---

## DEC-GOV-006: pacote para a fábrica em HTML imprimível + Markdown; .docx fora

| Campo | Conteúdo |
|---|---|
| **Decisão** | O pacote é gerado como HTML de impressão (mesma técnica do export atual) e Markdown baixável, a partir de um template por projeto (`factoryTemplate`) que carrega o boilerplate real dos DBs (checklist Serasa, comunicados). Export `.docx` não entra. |
| **Data / gatilho** | 2026-08-13; os DBs 513/515/519 mostram ~70% de boilerplate idêntico redigitado a cada demanda. |
| **Alternativas** | (a) gerar `.docx` com a lib `docx` — fidelidade ao formato atual, mas dependência nova (~100 KB+) e manutenção de layout Word dentro do bundle; (b) só Markdown — a fábrica recebe hoje Word; um `.md` cru quebraria o hábito sem ganho. |
| **Por quê** | HTML imprimível vira PDF em um clique (hábito corporativo já existente) e preserva imagens/tabelas; Markdown serve automação futura. O documento é sempre **derivado** (RN-GOV-08) — regenerável, nunca editado à parte, o que elimina a deriva entre "o que foi aprovado" e "o que foi enviado". |
| **Custo aceito** | A fábrica deixa de receber `.docx` editável. Se isso for bloqueio real na prática, uma DEC futura reavalia a lib `docx` contra o orçamento. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §8 |

---

## DEC-GOV-007: carga inicial via Markdown estruturado; IA fica fora do runtime

| Campo | Conteúdo |
|---|---|
| **Decisão** | A ferramenta importa **Markdown estruturado** (headings = hierarquia; blocos convencionados = campos do componente), com fluxo Importar→Identificar→Revisar→Confirmar e `origin` obrigatório. A conversão de Word/PDF para esse Markdown acontece fora da ferramenta — manualmente ou com IA (prompt de conversão fornecido na documentação da funcionalidade). |
| **Data / gatilho** | 2026-08-13; a spec pede carga a partir de Word/PDF/imagens, e o runtime é zero-eval e zero-requisição-externa por restrição corporativa. |
| **Alternativas** | (a) parser de `.docx` embutido (unzip + XML no cliente) — tecnicamente viável, mas Word real (o *Filtros e Critérios* tem anexos, tabelas irregulares, sumário) produziria estrutura ruim sem heurística pesada, inflando o bundle para um resultado que ainda exigiria revisão total; (b) esperar "evolução futura com IA" para carregar — adia o valor da árvore por meses. |
| **Por quê** | O gargalo real não é parsear Word — é **decidir** o que é seção, o que é regra e o que é lixo. Essa decisão fica melhor num passo humano/IA fora da ferramenta, barato e auditável; o import dentro dela fica determinístico, testável e pequeno. Mesma filosofia da carga de matrizes: sempre iniciada por uma pessoa, com um arquivo em mãos. |
| **Custo aceito** | Um passo manual a mais na primeira carga. Mitigado pelo prompt de conversão pronto e pelo fato de a carga inicial ser um evento raro por política. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §9 |

---

## DEC-GOV-008: release publica em lote, atômica, reutilizando a publicação existente ✅ implementada na S37

| Campo | Conteúdo |
|---|---|
| **Decisão** | `Release` agrupa DBs; publicar a release valida todos os rascunhos vinculados e publica tudo-ou-nada com a vigência de cada DB (RN-GOV-05), compondo os comandos de publicação existentes — mesma mecânica do `import/apply` da carga. |
| **Data / gatilho** | 2026-08-13; o processo real da área sobe várias demandas juntas numa "subida" datada. |
| **Alternativas** | (a) publicar DB a DB manualmente na data — funciona, mas o estado "o que entrou na subida de setembro" deixaria de existir como fato de primeira classe; (b) release com vigência única forçada para todos os DBs — contraria casos reais de vigências distintas aprovadas juntas. |
| **Por quê** | Atomicidade em lote já tem precedente testado no produto (S24); reusar o padrão custa pouco e dá à área a resposta "o que mudou nessa release" de graça, via diff entre a fotografia anterior e a posterior. |
| **Custo aceito** | Um DB pode ficar `READY_FOR_RELEASE` esperando a release inteira ficar pronta — fila explícita no painel de pendências. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3.4, §6 (RN-GOV-05) |

> ✅ **Implementada na S37** como desenhada: `release/publish` (`src/core/document/release-publish.ts`)
> chama `changeRequest/publish` por DB, dentro do mesmo `Run`/`step` — não uma segunda
> implementação. O diff "o que mudou nessa release" citado em **Por quê** não entrou nesta sessão
> (fica para a S39, comparação release × release, docs/14 §11); o que a S37 entrega é a publicação em
> si e a leitura na timeline (US-GOV-08 parcial).

---

## DEC-GOV-009: schemaVersion 5, migração puramente aditiva

| Campo | Conteúdo |
|---|---|
| **Decisão** | O épico entra com `schemaVersion: 5` (a 4 já está ocupada pelo épico Plataforma — `meta.acl`, ADR-003, S29): coleções novas (`components`, `changeRequests`, `releases`, `attachments`) e kinds novos de catálogo (`MOTIVATOR`, `IMPACT_CATEGORY`), sem alterar a forma de nenhum campo existente. Migração 4→5 preenche as coleções com `[]`. |
| **Data / gatilho** | 2026-08-13, desenho do épico GOV; renumerado de 4 para 5 ao consolidar com o épico Plataforma, priorizado antes na ordem de execução (26–31). |
| **Alternativas** | Espalhar os campos por dentro de `Project`/`Matrix` sem subir o schema — esconderia uma mudança estrutural grande atrás de campos opcionais e quebraria a regra de que forma nova de documento = versão nova de schema. |
| **Por quê** | Mesmo padrão das migrações 2→3 (S23) e 3→4 (S29), que já provaram o caminho: aditiva, testada com documento real da versão anterior e com a cadeia completa desde v1. |
| **Custo aceito** | Documentos salvos por um `PolicyOps.html` novo não abrem em versões antigas do app — já é assim entre versões de schema anteriores; o aviso de versão existente cobre. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §1, §10 (S32a); `14-governanca-de-alteracoes.md` §3.5 |
| **Revisada por** | **DEC-GOV-015** (2026-08-14, implementação da S32a): a migração é aditiva com **uma** exceção — ela escreve `kind: 'EVIDENCE'` nos anexos já gravados, o discriminador que passou a separar evidência de imagem embutida. `attachments` também não é coleção nova: ela já existia desde a S30, e por isso a migração não a cria vazia. O resto (`components`, `changeRequests`, `releases` com `[]`, kinds novos de catálogo) saiu como escrito aqui. |

---

## DEC-GOV-010: a carga da política é antecipada; a S32 vira S32a (componentes) + S32b (DB e workflow)

| Campo | Conteúdo |
|---|---|
| **Decisão** | A carga inicial da política (S40) sai do fim do épico e passa a ser a terceira sessão: a ordem de execução da Governança vira **S32a → S33 → S40 → S34 → S32b → S35 → S36 → 37/38 → 39**. Para isso, a antiga S32 é dividida: a **S32a** entrega `schemaVersion: 5` **inteiro** (uma única migração 4→5, com `ChangeRequest`/`Release`/`Attachment`/`RichDoc` já declarados), as invariantes de árvore (I23, I24 — incluindo unicidade de `PolicyComponent.code`), os comandos `component/*` e `componentVersion/*`; a **S32b** entrega o que só o Diário de Bordo consome (comandos de `ChangeRequest`/`Release`, grafo de 12 estados, aprovações, I25 e I26) e passa a ser pré-requisito da S35, não da S33/S40. O prompt de conversão Word → Markdown, que era entregável da S40, entra como rascunho em `14-governanca-de-alteracoes.md` §9.1 já neste replanejamento, porque não depende de código e é o que permite preparar o conteúdo em paralelo. |
| **Data / gatilho** | 2026-08-14, replanejamento pedido antes de iniciar a S32: avaliar o produto com a política vigente dentro, e não com dados de exemplo, antes de investir no resto do épico. |
| **Alternativas** | (a) Executar 32 → 33 → 40 sem dividir nada, como `09-roadmap-de-entregas.md` já recomendava — mantém tudo mais simples, mas coloca o grafo de 12 estados, aprovações e I25/I26 (a metade mais cara e arriscada da S32) no caminho crítico de uma carga que não usa nada disso; (b) juntar árvore e carga numa sessão só, chegando ao conteúdo em duas sessões — sessão grande demais (UI de árvore + parser + assistente de 3 passos), com risco alto de ser cortada no meio; (c) dividir também o `schemaVersion`, deixando DB/release para uma migração 5→6 — churn de schema por conveniência de sequenciamento, contra DEC-GOV-009. |
| **Por quê** | O valor de olhar para a política real cedo é de avaliação, não de código: a árvore com 4 níveis, centenas de componentes e o texto de verdade responde perguntas de modelagem (profundidade, tipos, granularidade, origem) que nenhuma fixture inventada responde — e responde **antes** do editor rico (S34), do DB (S35) e da fotografia histórica (S39), que são construídos em cima dessas respostas. A divisão respeita o critério de corte que o épico já usa: o que a carga precisa é a árvore; o resto é do Diário de Bordo. |
| **Custo aceito** | Duas sessões numeradas com sufixo (precedente do 17a/17b/17c em `09`) e uma S32b que fica declarada no schema mas sem comandos por três sessões — código morto benigno, coberto pelo teste de migração. A S33 é construída sabendo que a carga vem logo atrás (volume de ~300 componentes, filtro por `reviewStatus`), o que é requisito antecipado, não retrabalho. Se a carga revelar que o modelo de componente precisa mudar, a mudança cai numa base pequena (S32a + S33) em vez de no épico inteiro — parte do motivo de antecipar. |
| **Páginas afetadas** | `09-roadmap-de-entregas.md`; `14-governanca-de-alteracoes.md` (cabeçalho, §3, §6, §9); `docs/prompts/S32a`, `S32b`, `S33`, `S35`, `S40` e o índice de `docs/prompts/README.md` |
| **Revisada por** | **DEC-GOV-012** (2026-08-14): o objetivo — a política real dentro da ferramenta antes do resto do épico — foi mantido, mas o meio mudou. A carga deixou de ser a terceira sessão (a política as-is entra à mão, incrementalmente) e a S33 foi dividida em S33a/S33b. A ordem passa a ser `32a → 33a → 33b → ⟨uso real⟩ → 40 (opcional) → 34 → 32b → 35 → 36 → 37/38 → 39`. A divisão 32a/32b e a migração 4→5 única continuam valendo como escritas aqui. |

---

## DEC-GOV-011: a árvore da política ganha faceta, seção versionável e espelho de variável

| Campo | Conteúdo |
|---|---|
| **Decisão** | Quatro ajustes aditivos ao modelo de `PolicyComponent` da DEC-GOV-001, todos fechados na S32a: (1) `tags?: string[]` no componente, reusando `CatalogItem` de kind `TAG` e os grupos de faceta da DEC-CARGA-003; (2) `versions` **opcional** em `SECTION` — seção sem versões é pasta, seção com versões é bloco de política com vigência e histórico (I27 — renumerada para **I29** na S32a, DEC-GOV-014); (3) `variableId?` em `POLICY_VARIABLE`, tornando-o espelho da Biblioteca de Variáveis como `MATRIX` é espelho de `Matrix`; (4) regra de contenção explícita — `MATRIX` é sempre folha e um nó aponta **uma** matriz; os demais tipos podem ter filhos. |
| **Data / gatilho** | 2026-08-14, revisão conceitual de UX e hierarquia pedida antes de iniciar a S32a, com leitura do documento real *Filtros e Critérios de Crédito B2C* (16 títulos de nível 1, 36 de nível 2, 49 de nível 3, 5 anexos). |
| **Alternativas** | (a) manter só a árvore, sem faceta — o documento real escolhe a tabela de elegibilidade por `grupo × canal × risco de CEP` **ao mesmo tempo**; uma hierarquia única obriga a escolher um aninhamento e erra as demais perguntas, que é exatamente o problema que a DEC-CARGA-003 já tinha resolvido para matrizes; (b) `sectionKind` tipado agora (CMA, Política de Grupo, Cineminha como tipos com ícone e layout) — boa ideia, mas o Anexo E do mesmo documento usa outra convenção inteira (`I) a) b)`), o que recomenda esperar uso real antes de fixar vocabulário: adiado em §3.6; (c) nó de referência/alias para o componente citado em dois lugares ("Grupo Controle" aparece em 4.1 e 4.8) — duplicaria a contagem da fotografia histórica e criaria a pergunta "editei qual?"; vira link no inspector, adiado como nó; (d) preservar a numeração do Word (`4.1`, `4.6`) como identidade — é estruturação do Word, não fato da política, e o próprio documento pula de 4.3 para 4.6; `origin.locator` já cobre procedência. |
| **Por quê** | Os quatro pontos vêm do documento real, não de teoria. A faceta existe porque a política é multidimensional; a seção versionável existe porque cada capítulo tem uma "Visão Geral" que muda e precisa de lastro (e `PolicyComponent` não tinha nem `description`); o espelho de variável existe porque o Anexo A **é** a Biblioteca de Variáveis com `groupingDimensions` (S18/S20) e viraria uma segunda cópia versionada; a contenção existe porque, sem ela, quem implementa a S32a decide sozinho, no código, uma regra de negócio. |
| **Custo aceito** | A fotografia histórica (S39) passa a lidar com seções versionadas, e o inspector de componente ganha um caso por tipo. Ambos pequenos por serem decididos **antes** da S32a: depois dela, custariam uma migração 5→6 contra a DEC-GOV-009. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3.1, §3.5, §3.6, §6 (I23, I24, I27); `07-ux-e-editor.md` §17; `docs/prompts/S32a` |

---

## DEC-GOV-012: a política as-is entra à mão, incrementalmente — a carga vira aceleração opcional

| Campo | Conteúdo |
|---|---|
| **Decisão** | A trilha antecipada da DEC-GOV-010 muda de meio, não de fim: em vez de `32a → 33 → 40` (carga de tudo de uma vez), passa a ser `32a → 33a → 33b → ⟨uso real⟩`, com a primeira versão da política **construída à mão, seção a seção e regra a regra**. A antiga S33 é dividida em **S33a** (árvore e esqueleto, sem payload nem ciclo de vida) e **S33b** (cadastro por tipo, versionamento, ergonomia de entrada em volume). A **S40 deixa de ser da trilha antecipada** e vira opcional. Entram como requisito de produto: entrada em volume por teclado (irmão, duplicar, colar bloco no formato do documento) e a **vigência da fundação** (RN-GOV-09) com publicação em lote. |
| **Data / gatilho** | 2026-08-14, mesma revisão da DEC-GOV-011: o usuário quer construir a política incrementalmente para ajustar rota enquanto o custo é baixo, e não importar tudo para depois descobrir o que precisa mudar. |
| **Alternativas** | (a) manter `32a → 33 → 40` como estava — cumpre o mesmo objetivo, mas entrega a política inteira num único evento, exatamente quando o modelo ainda não foi exercitado por ninguém: a correção de rota chegaria depois de 100 componentes cadastrados de uma vez; (b) construir à mão **sem** dividir a S33 — a sessão ficaria grande (árvore + inspector por tipo + ciclo de vida + ergonomia) e o primeiro ponto de checagem só existiria no fim dela; (c) descartar a S40 — o `.md` convertido continua útil, e recorte por capítulo é barato de construir sobre o mesmo parser; descartar seria fechar uma porta sem necessidade. |
| **Por quê** | O valor da trilha antecipada é a correção de rota barata, e ela fica mais barata ainda quando o esqueleto (33a) pode ser julgado **antes** de existir formulário de regra (33b). Cadastrar à mão é lento, mas é o que produz as perguntas de modelagem certas; e a lentidão tem remédio conhecido (a 40) que pode ser aplicado depois, com informação melhor sobre onde dói. As matrizes já estão no documento desde o épico Carga: a árvore só precisa indicar **onde** cada uma entra, o que dissolve a preocupação de "criar 102 nós em lote" que a revisão havia levantado. |
| **Custo aceito** | Duas sessões numeradas com sufixo a mais (precedente 17a/17b/17c e 32a/32b), e a digitação manual da primeira versão da política. Em troca, dois pontos de checagem (fim da 33a e fim da 33b) em vez de um, e nenhuma linha de código escrita sobre um modelo que ninguém exercitou. |
| **Páginas afetadas** | `09-roadmap-de-entregas.md` (tabela, ordem, lotes, M10); `14-governanca-de-alteracoes.md` (cabeçalho, §4 US-GOV-01/02/09, §6 RN-GOV-09, §9); `07-ux-e-editor.md` §17; `docs/prompts/S33a`, `S33b`, `S40`, `README.md` |

---

## DEC-GOV-013: ordem de execução do motor fica fora do modelo por enquanto

| Campo | Conteúdo |
|---|---|
| **Decisão** | A árvore **não** representa ordem de execução, e nenhum modelo de fluxo (etapas ordenadas no projeto, marcação de seção sequencial, grafo de decisão) entra agora. A ambiguidade é resolvida na interface: a árvore declara que sua ordem é **de leitura**, e a sequência de avaliação vive no texto de cada componente. O `outcome` da regra continua distinguindo "termina aqui" de "continua". Revisitar depois da S33b, com a política real dentro. |
| **Data / gatilho** | 2026-08-14, mesma revisão; a proposta inicial de `Project.stages` ordenadas foi retirada depois da leitura do documento real. |
| **Alternativas** | (a) lista ordenada de etapas no projeto (`CMA → Segmentação → Modelo → Pós-Modelo → Mesa`) com `stageId` por componente — foi a proposta inicial, retirada porque o documento se declara sequencial (*"as decisões são feitas na ordem em que estão descritas"*) e depois se contradiz em quatro pontos concretos: na segmentação *"prevalece a última condição avaliada"* (não a primeira), o cineminha é escolhido por `grupo × canal × risco de CEP` (despacho, não sequência), "Grupo Controle" é avaliado em 4.1 **e** em 4.8, e a Derivação para Mesa vale *"para qualquer decisão automática"*; (b) grafo de decisão condicional — representaria fielmente, e é meio caminho para virar motor de decisão, explicitamente fora de escopo (`01-visao-e-escopo.md` §7); (c) ordem dos irmãos = ordem de execução — o mais barato e o mais perigoso: um leitor concluiria o oposto do que acontece na segmentação. |
| **Por quê** | Um modelo de fluxo errado é pior que nenhum numa ferramenta cuja tese é acabar com a ambiguidade da política. Sem uso real, qualquer escolha aqui é chute; com a política dentro da ferramenta, a pergunta "o que roda antes do quê" passa a ter dados para ser respondida. E o custo de adiar é uma frase na interface, não uma refatoração. |
| **Custo aceito** | A pergunta "em que ordem isso roda?" continua sendo respondida pelo texto, não pela estrutura — como já é hoje no Word. Nada regride; apenas não avança nesta rodada. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3.1, §3.6; `07-ux-e-editor.md` §17.1 |

---

## DEC-PLAT-001: o detalhamento da API v1 fechado na implementação do servidor

| Campo | Conteúdo |
|---|---|
| **Decisão** | Os pontos que `14-plataforma-local.md` §4 deixava em aberto foram fechados na S26 e estão descritos em §4 "Detalhamento fechado na S26": `content` do `PUT` é **texto** (o servidor grava os bytes do front e nunca reserializa); `hash` é SHA-256 hexadecimal, igual ao `hashDocument()` do front; datas em ISO 8601 UTC com `Z`; envelope de erro uniforme `{ code, detail, ... }` com um código por caso; o `.lock.json` ganha o campo aditivo `username` como critério de propriedade; colisão de nome de backup no mesmo segundo avança o carimbo em vez de sobrescrever; estáticos limitados a `GET /` e `GET /PolicyOps.html`. |
| **Data / gatilho** | 2026-08-14, implementação da S26 (servidor local). |
| **Alternativas** | (a) `content` como objeto JSON, deixando o Python serializar — quebraria a igualdade de hash entre front e servidor e mudaria de dono a formatação canônica, contra ADR-002; (b) sufixo ` (2)` no nome do backup em colisão — o formato do nome é compartilhado com o modo `FULL`, cuja rotação não reconheceria o arquivo com sufixo e o deixaria acumular para sempre; (c) comparar dono do lock só pelo `holder` — o rótulo é `displayName`, editável e não único. |
| **Por quê** | Todas as escolhas seguem a mesma regra: o servidor é infraestrutura e o front continua dono do conteúdo (ADR-002), e nada no formato em disco pode impedir usuários em `FULL` e em `SERVER` de se enxergarem (`06` §6, §9). |
| **Custo aceito** | O front precisa mandar o texto já serializado (é o que ele tem em mãos de qualquer forma, para calcular o hash) e um `.lock.json` do modo `SERVER` tem um campo a mais do que o do modo `FULL` — aditivo, ignorado por `parseLock` de `src/storage/lock.ts`. |
| **Páginas afetadas** | `14-plataforma-local.md` §4 |

## DEC-PLAT-002: `force` do `PUT /api/document` só destrava o lock — nunca o `baseHash`

| Campo | Conteúdo |
|---|---|
| **Decisão** | Implementando `server-adapter.ts` (S27) contra o servidor real da S26, ficou explícito um ponto que `14-plataforma-local.md` §4 já dizia mas não destacava: o `force` do `PUT /api/document` só afeta a checagem do **lock** (`423`); a checagem de conflito por `baseHash` (`409`) roda sempre, sem exceção. "Sobrescrever mesmo assim"/"Mesclar" no modo `SERVER` funcionam guardando o `remoteHash` visto no último `409` e mandando-o como `baseHash` do próximo `PUT` (`ServerAdapter.acceptRemoteAsBase()`) — não existe, como no modo `FULL`, um jeito de simplesmente ignorar o que está no disco. Se alguém salvar de novo nesse intervalo, o `PUT` seguinte recebe outro `409`, correto. Também ficou explícito que o `PUT` pode devolver `423` mesmo fora do fluxo de lock (defesa em profundidade do servidor, docs/14 §4): como `SaveResult` não tem variante de bloqueio, `server-adapter.ts` traduz esse `423` em `{ reason: 'PERMISSION' }`, com a mensagem citando quem detém o bloqueio. |
| **Data / gatilho** | 2026-08-14, implementação da S27 (modo `SERVER` no front) contra os testes de contrato do adapter. |
| **Alternativas** | (a) `server-adapter.ts` simular o comportamento do modo `FULL` (aceitar qualquer coisa como base depois de "sobrescrever mesmo assim") — exigiria o servidor reconhecer um `force` que também ignora `baseHash`, ampliando o contrato da API por conveniência da interface, quando o servidor já dá o dado certo (`remoteHash` do próprio `409`) para fazer isso sem ampliar nada; (b) acrescentar `'LOCKED'` a `SaveResult['reason']` — mudaria a interface compartilhada pelos três adapters (`docs/06` §2) por um caso que, na prática, o front já evita chamando `save()` só depois de ter o lock (o `readOnly` de `lockHeldByOther` bloqueia antes). |
| **Por quê** | Optimistic concurrency por hash é mais forte que "forçar": nunca existe uma janela em que o modo `SERVER` grava por cima de um conteúdo que não viu. E não vale mexer no contrato compartilhado dos três adapters por um caminho de defesa em profundidade que a interface já impede de acontecer no caminho normal. |
| **Custo aceito** | O 423 fora do fluxo de lock vira uma mensagem de `PERMISSION` um pouco menos específica do que uma variante dedicada seria — aceitável porque é uma corrida rara (o lock mudou de mãos entre abrir e salvar) e a mensagem já diz quem detém o bloqueio. |
| **Páginas afetadas** | `14-plataforma-local.md` §4 e §8, `06-persistencia-e-concorrencia.md` §5 |

## DEC-PLAT-003: launcher em thread (não subprocesso), HTML resolvido um nível acima do servidor, e versão fixa das três dependências

| Campo | Conteúdo |
|---|---|
| **Decisão** | Três pontos fechados implementando `iniciar.bat`/`instalar.bat` (S28): (1) `server/launcher.py` sobe o `uvicorn` numa **thread do próprio processo Python**, não um subprocesso — `policyops_server.main()` foi dividido em `prepare()` (resolve config/porta/app, reaproveitado pelos dois) e o corpo que sobe o servidor, para o launcher poder controlar o ciclo de vida sem duplicar a validação; fechar a janela do `.bat` ou `Ctrl+C` derruba servidor e thread juntos, sem processo órfão escutando em `127.0.0.1`. (2) `resolve_html_path()` (S26) só procurava o `PolicyOps.html` ao lado do próprio `policyops_server.py` ou em `dist/` — nunca no layout publicado de verdade descrito em `14-plataforma-local.md` §2 (`_app/PolicyOps.html`, um nível **acima** de `_app/server/policyops_server.py`); ganhou um terceiro caminho de busca para esse caso, sem remover os dois anteriores (script achatado num teste, e o fallback de dev). (3) `server/requirements.txt` passou de dependência sem versão para pinada: a versão mais recente de cada uma das três que ainda declara `requires-python >= 3.9` — a versão seguinte de cada uma já exige 3.10, o que quebraria o parque descrito em `02-arquitetura.md` §2 e `14` §3. |
| **Data / gatilho** | 2026-08-14, implementação da S28 (`iniciar.bat`/`instalar.bat`/`dist/plataforma/`) testada de ponta a ponta contra um venv real. |
| **Alternativas** | (1) subprocesso separado para o `uvicorn`, com o `.bat` chamando `python policyops_server.py` direto — mais próximo do CLI de S26, mas o `.bat` sozinho não sabe esperar o `/api/health` nem abrir o navegador só depois, e ficaria sem um lugar natural para essa lógica virar teste automatizado (o pytest do launcher pede justamente isso); (2) deixar `resolve_html_path()` como estava e resolver com um símlink ou cópia extra do `.html` dentro de `_app/server/` — remendo no pacote em vez de corrigir a função que já documentava (mas não implementava) o layout certo; (3) manter as três dependências sem pino, deixando o `pip install`/`pip download` sempre pegar "o que houver" — a wheel baixada hoje deixaria de instalar no parque assim que uma dependência subisse o mínimo de Python, sem aviso. |
| **Por quê** | (1) e (2) mantêm o servidor como uma coisa só (config, validação, ciclo de vida) reaproveitada por CLI e launcher, em vez de duas implementações divergentes; (2) além disso fecha um gap que só apareceria em produção — os testes de S26/S27 nunca exercitaram o layout `_app/PolicyOps.html` + `_app/server/`. (3) torna reproduzível o que `scripts/fetch-wheels.mjs` baixa: mesma versão sempre, e uma catraca explícita (reconferir o `requires-python`) antes de qualquer atualização. |
| **Custo aceito** | Subir a versão de qualquer uma das três dependências agora exige reconferir se ela ainda suporta Python 3.9 antes de editar `requirements.txt` — um passo manual a mais, documentado no próprio arquivo. |
| **Páginas afetadas** | `14-plataforma-local.md` §3, §9 |

## DEC-PLAT-004: `acl/set` tem uma exceção estreita para o modo aberto poder criar o primeiro ADMIN

| Campo | Conteúdo |
|---|---|
| **Decisão** | Implementando a S29, ficou explícito um "ovo e a galinha" que `14-plataforma-local.md` §6 não cobria: se ACL ausente/vazia/sem `ADMIN` é modo aberto (todo mundo `PUBLISHER`) e editar a ACL exige papel `ADMIN`, ninguém jamais poderia criar o primeiro `ADMIN` — o controle nunca ligaria sozinho. `isOpenMode(doc)` (`src/core/document/roles.ts`) nomeia essa condição (as mesmas três: ACL ausente, vazia, ou populada sem nenhum `ADMIN`) e o gate do dispatcher (`docs/08-camada-de-comandos.md` §6) libera especificamente `acl/set` quando `isOpenMode` é verdadeiro, mesmo com o papel efetivo em `PUBLISHER`. A tela de acesso (`07-ux-e-editor.md` §16) segue a mesma regra para decidir se aparece. |
| **Data / gatilho** | 2026-08-14, implementação da S29 (identidade e papéis), ao escrever o teste "sem ACL, ninguém consegue ligar o controle". |
| **Alternativas** | (a) `resolveRole` devolver `ADMIN` em vez de `PUBLISHER` em modo aberto — resolveria o bootstrap de graça, mas contradiria `14-plataforma-local.md` §6 ("ACL ausente ou vazia = modo aberto (todos PUBLISHER)") e faria a barra de status mostrar `ADMIN` para todo mundo, uma leitura enganosa do estado real; (b) um comando `acl/bootstrap` separado, só chamável quando não há ACL nenhuma — um segundo caminho de código para o mesmo efeito de `acl/set`, com o próprio `isOpenMode` como guarda; a exceção dentro do gate existente evita duplicar a lógica de "substituir a ACL inteira, gerar `ACL_CHANGED`, checar `ACL_REQUIRES_ADMIN`". |
| **Por quê** | A exceção fica confinada a **um** `command.type` (`acl/set`) e a **uma** condição (`isOpenMode`), documentada nos dois lugares que precisam saber dela (o gate e a tela) — mais barato e mais legível que inventar um segundo mecanismo de permissão só para o primeiro `ADMIN`. |
| **Custo aceito** | `acl/set` é o único comando cujo gate não é uma comparação direta de papéis — quem ler `minRoleForCommand` sem ler a nota ao lado pode achar que `ADMIN` é sempre exigido; mitigado pelo comentário no próprio código e por este registro. |
| **Páginas afetadas** | `14-plataforma-local.md` §6, `08-camada-de-comandos.md` §6, `07-ux-e-editor.md` §16 |

## DEC-PLAT-005: o documento é o índice do acervo — o servidor de evidências não guarda estado

| Campo | Conteúdo |
|---|---|
| **Decisão** | Implementando a S30, ficou explícito que `14-plataforma-local.md` §4 descrevia `GET`/`DELETE /api/evidences/{id}` sem dizer **como** o servidor resolveria um `id` em caminho e hash. A decisão é a mais alinhada ao ADR-002: ele não resolve — quem sabe é o documento. `relPath` e `sha256` vão do `attachments[]` para o servidor em toda chamada (query string), e o `{id}` da rota fica sendo só o identificador do vínculo. O servidor não ganha índice, banco nem sidecar em `_evidencias/`; ele copia, calcula hash, confere hash e move para a lixeira. Complementos fechados juntos: o caminho da anexação é **construído** a partir dos códigos slugificados (nunca validado a partir de caminho recebido), o `id` é gerado pelo servidor no formato `nanoid(12)`, e a ida para `_lixeira/` é reconciliada pela camada de persistência **depois** de cada salvamento bem-sucedido. |
| **Data / gatilho** | 2026-08-14, implementação da S30 (evidências), ao escrever `DELETE /api/evidences/{id}` e perceber que, no momento em que ele é chamado, o vínculo **já não está** no documento salvo — um servidor que resolvesse `id` lendo `politicas.json` não teria como encontrá-lo. |
| **Alternativas** | (a) o servidor ler `attachments[]` do `politicas.json` para resolver o `id`, como já faz com `meta.acl` — funcionaria no `GET`, mas quebra no `DELETE` pelo motivo acima, e colocaria uma segunda parte do schema dentro do Python (ADR-002 admite `meta.acl` como envelope mínimo justamente porque é o único); (b) um índice próprio do acervo (`_evidencias/index.json`) — duplica o registro que já existe no documento, e cria a pergunta "qual dos dois vale" no primeiro conflito de merge; (c) manter o hash só no servidor e não mandá-lo na chamada — o servidor passaria a ser a fonte da verdade da integridade, que é exatamente o que o documento precisa ser para a auditoria fazer sentido. |
| **Por quê** | Mantém a divisão que o épico inteiro sustenta: regra e registro no `src/core/`, I/O no Python. Um acervo sem estado próprio também é um acervo que sobrevive a qualquer coisa — reconstruir o vínculo é ler o documento, e reconstruir o arquivo é abrir a pasta (ADR-004). |
| **Custo aceito** | Quem chama a API precisa carregar `relPath` e `sha256` consigo, e um `relPath` corrompido no documento vira `404`/`400` em vez de "o servidor sabia onde estava". Em troca, a checagem de caminho fica num lugar só (`resolve_under`, coberta por teste com `..`, caminho absoluto e letra de unidade) e o servidor continua sem nada para migrar quando o schema do documento evoluir. |
| **Páginas afetadas** | `14-plataforma-local.md` §4, §7, `03-modelo-do-documento.md` §9–§10, `11-operacao.md` §1 |

---

## DEC-GOV-014: as invariantes da árvore são I27–I29, não I23/I24/I27

| Campo | Conteúdo |
|---|---|
| **Decisão** | `14-governanca-de-alteracoes.md` §6 numerava as invariantes do épico como I23 (espelho de matriz), I24 (árvore) e I27 (seção versionável), com I25/I26 reservadas para o DB e a release. Esses números já estavam ocupados: I23/I24 são a ACL (S29) e I25/I26 são as evidências (S30), em `03-modelo-do-documento.md` §9. As do épico foram remapeadas para os primeiros números livres — **I27** (espelho de `MATRIX`/`POLICY_VARIABLE`), **I28** (árvore acíclica, `position`, profundidade, `code`, `tags`) e **I29** (versão de componente, inclusive em `SECTION`); a S32b entra com I30 e I31. A tabela de correspondência ficou nos dois documentos. |
| **Data / gatilho** | 2026-08-14, implementação da S32a, ao abrir `src/core/document/validate.ts` para escrever `checkI23` e encontrar uma `checkI23` de ACL já lá, verde e testada. |
| **Alternativas** | (a) renumerar ACL e evidências para liberar I23–I26 — mexeria em `03-modelo-do-documento.md` §9, em `validate.ts`, nas mensagens e nos testes de duas sessões já entregues, para ganhar apenas a coincidência com um rascunho; (b) namespace próprio (`GOV-I23` em `ValidationIssue.invariant`) — dois espaços de numeração convivendo no mesmo campo, e o modo de recuperação passaria a exibir duas convenções lado a lado. |
| **Por quê** | O número de uma invariante é um rótulo estável de leitura, não uma identidade semântica: o que precisa ser único é o significado, e ele está na tabela. Remapear o rascunho custa uma tabela de correspondência; remapear o que já está em produção custa uma varredura e um risco. |
| **Custo aceito** | `14-governanca-de-alteracoes.md` §6 continua citando os números antigos no corpo do texto (o raciocínio de cada invariante está lá), com a tabela de correspondência logo abaixo — quem lê só o docs/14 precisa da tradução. Em compensação, o docs/03 §9, que é a fonte para quem implementa, ficou sequencial e sem buraco. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §9; `14-governanca-de-alteracoes.md` §6; `docs/prompts/S32a`, `S32b` |

---

## DEC-GOV-015: evidência e imagem embutida convivem em `attachments`, discriminadas por `kind`

| Campo | Conteúdo |
|---|---|
| **Decisão** | `14-governanca-de-alteracoes.md` §7 previa `Attachment`/`attachments` para as imagens do editor rico (base64, ≤ 300 KB), nome que a S30 já tinha usado para o vínculo com o acervo `_evidencias/`, e registrava o conflito como ponto a fechar antes da S34. Fechado agora, porque o `schemaVersion: 5` precisa ser uma migração só: **uma coleção, dois tipos**, `Attachment = EvidenceAttachment \| InlineImageAttachment`, discriminados por `kind`. O bloco `image` do `RichDoc` continua com `attachmentId` e aponta um `INLINE_IMAGE`; I25 e I26 só se aplicam a `EVIDENCE`. A migração 4 → 5 carimba `kind: 'EVIDENCE'` nos anexos já gravados. |
| **Data / gatilho** | 2026-08-14, implementação da S32a: declarar `RichDoc` sem decidir isto deixaria o bloco `image` apontando para uma coleção inexistente, e criar a coleção depois seria uma migração 5 → 6 — exatamente o que a sessão existe para evitar. |
| **Alternativas** | (a) coleção nova `images: InlineImage[]`, deixando `attachments` intocada — mais barato de implementar (nenhum campo existente muda) e o que o próprio §7 sugeria primeiro, mas cria duas coleções de "arquivo pendurado no documento" com regras de lixeira, hash e teto diferentes, e a próxima sessão que precisar listar "tudo que este DB anexa" teria de unir as duas na mão; (b) adiar para a S34 — deixaria o épico com duas migrações, contra DEC-GOV-010. |
| **Por quê** | As duas coisas são o mesmo conceito de negócio — um arquivo preso ao documento — com dois lugares de armazenamento. Um discriminador expressa isso; duas coleções escondem. E o custo real é pequeno: o discriminador é o único campo que a migração escreve, e todo código de evidência passou a filtrar por `kind` num lugar só (`listEvidences`). |
| **Custo aceito** | A migração 4 → 5 deixa de ser "puramente aditiva" no sentido estrito: ela **escreve** um campo em registro existente. É um valor único e conhecido (todo anexo de um documento v4 é evidência), testado com fixture. E `Attachment` passou a ser união: quem tinha `attachment.relPath` precisou estreitar o tipo antes — cinco arquivos, todos de evidência. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §8.1, §10, §12.3; `14-governanca-de-alteracoes.md` §7; `14-plataforma-local.md` §7 |

---

## DEC-GOV-016: publicar componente aceita vigência retroativa; publicar matriz continua não aceitando

| Campo | Conteúdo |
|---|---|
| **Decisão** | `componentVersion/publish` aceita `effectiveFrom` no passado; `version/publish` (matriz) continua recusando com `EFFECTIVE_DATE_INVALID` (`05-regras-de-negocio.md` §1.3). Nos dois casos vale a mesma ordem: a vigência nova precisa começar **depois** da vigente. Além disso, publicar componente **exige** `effectiveFrom` (na matriz ele é opcional e cai em "agora") e **não pede nota** de publicação. |
| **Data / gatilho** | 2026-08-14, implementação da S32a, ao escrever o teste do caminho da fundação (RN-GOV-09) e ver que a regra da matriz o tornaria impossível. |
| **Alternativas** | (a) proibir retroativo também no componente, e dar um caminho privilegiado à fundação (um comando `component/foundation` que escrevesse a vigência sem passar pelo `publish`) — um segundo caminho para selar versão é exatamente o tipo de coisa que I3 existe para não ter; (b) liberar retroativo nos dois, uniformizando — mudaria o comportamento de publicação de matriz, que está entregue, testado e em uso, fora do escopo desta sessão e sem demanda. |
| **Por quê** | As duas entidades têm origens diferentes. A matriz **nasce** dentro da ferramenta: a versão anterior está lá, e publicar com data no passado reescreveria uma vigência que a ferramenta afirmou. O componente **chega** com história: a S33b cadastra ~100 regras que já vigoram desde uma data anterior a qualquer uso do PolicyOps, e negar isso obrigaria a mentir a data de vigência da política inteira. A ordem entre versões, que é o que sustenta I29, continua garantida nos dois. |
| **Custo aceito** | Duas regras de vigência no mesmo produto, o que exige a explicação acima em `03-modelo-do-documento.md` §12.1 e em `08-camada-de-comandos.md`. Fecha, para componentes, a pergunta 4 do §12 de `14-governanca-de-alteracoes.md`; para matrizes ela continua aberta na S36. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §12.1; `08-camada-de-comandos.md` §3; `14-governanca-de-alteracoes.md` §6, §12 |

---

## DEC-GOV-017: versão de componente não tem `ARCHIVED` — descartar rascunho é reversível

| Campo | Conteúdo |
|---|---|
| **Decisão** | `ComponentVersion.state` tem exatamente os três estados de `14-governanca-de-alteracoes.md` §3.2 (`DRAFT`, `PUBLISHED`, `SUPERSEDED`). Sem `ARCHIVED`, `componentVersion/discardDraft` **remove** a versão da lista, o número volta a ficar livre, e o comando tem **inverso exato** — ao contrário de `version/discardDraft` (matriz), que marca `ARCHIVED`, queima o número e é irreversível. Publicar continua irreversível nos dois. |
| **Data / gatilho** | 2026-08-14, implementação da S32a, ao espelhar `versioning/lifecycle.ts` e esbarrar no estado que o contrato de docs/14 não tem. |
| **Alternativas** | (a) acrescentar `ARCHIVED` ao contrato para uniformizar com a matriz — divergiria de docs/14 §3.2, que a sessão foi instruída a transcrever, e engordaria a árvore com nós de versão descartada que nenhuma tela vai mostrar; (b) remover a versão **e** manter o comando irreversível — perderia trabalho sem necessidade: o registro inteiro está em mãos no momento do descarte, e devolvê-lo é trivial. |
| **Por quê** | O número queimado da matriz protege uma coisa concreta: a versão descartada pode ter sido comparada, citada em evidência ou vista por alguém, e reaproveitar o número confundiria a linha do tempo. O rascunho de componente antes da primeira publicação não tem esse alcance — ele nunca foi vigente, e o evento `COMPONENT_DRAFT_DISCARDED` continua no histórico append-only registrando que existiu. |
| **Custo aceito** | Duas semânticas de descarte no produto, documentadas lado a lado em `08-camada-de-comandos.md`. Em troca, o desfazer da árvore funciona por inteiro — que é o que a digitação em volume da S33b vai exercitar o tempo todo. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §12.1; `08-camada-de-comandos.md` §3 |

---

## DEC-GOV-018: a árvore de política ganha tipos de evento próprios no catálogo fechado

| Campo | Conteúdo |
|---|---|
| **Decisão** | `DocEventType` (`03-modelo-do-documento.md` §8) recebeu oito tipos novos — `COMPONENT_CREATED`, `COMPONENT_UPDATED`, `COMPONENT_MOVED`, `COMPONENT_ARCHIVED`, `COMPONENT_DRAFT_CREATED`, `COMPONENT_DRAFT_DISCARDED`, `COMPONENT_VERSION_PUBLISHED` e `COMPONENT_VERSION_SUPERSEDED` — e `DocEvent.scope` ganhou `componentId?` e `componentVersionId?`. Editar rascunho de componente **não** gera evento, como `version/applyCellPatch` também não gera. |
| **Data / gatilho** | 2026-08-14, implementação da S32a: `src/core/command.ts` registra que projeto e metadados de matriz gravam `events: []` justamente por não terem tipo no catálogo fechado, e a pergunta era se componente seguiria o mesmo caminho. |
| **Alternativas** | (a) `events: []` em tudo, como projeto e metadados de matriz — a timeline da regra (US-GOV-02) e a distinção "veio de um DB × publicação direta" (RN-GOV-07) ficariam sem lastro nenhum até a S33b, e o merge perderia a prova de auditoria que decide quem alterou o quê; (b) só os do ciclo de versão, sem os da árvore — mover um nó é a operação que mais confunde numa árvore grande, e é a que mais precisa de rastro. |
| **Por quê** | A analogia certa não é "projeto" (que não tem história própria) e sim "matriz/versão" (que tem, e por isso já tinha eventos). Um componente publicado é uma peça de política vigente: quem mudou, quando e a partir de qual DB é o produto, não um detalhe. O `scope` novo também é o que faz o merge conseguir provar qual lado mexeu num componente — sem ele, toda divergência de árvore viraria conflito manual. |
| **Custo aceito** | O catálogo de eventos cresceu de 23 para 31 tipos, e todo mapa total por `DocEventType` (hoje só o de ícones do histórico) precisou de oito linhas. O `payload` de `COMPONENT_VERSION_PUBLISHED` carrega `changeRequestId: null` explícito para publicação direta — `null` aqui é informação (RN-GOV-07), não ausência de dado. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §8, §12; `08-camada-de-comandos.md` §3 |

---

## DEC-GOV-019: a trilha do DB vive dentro do DB, e o catálogo de eventos cresce mais oito tipos

| Campo | Conteúdo |
|---|---|
| **Decisão** | `DocEventType` recebeu mais oito tipos na S32b — `CR_CREATED`, `CR_UPDATED`, `CR_ITEM_CHANGED`, `CR_TRANSITIONED`, `CR_DECIDED`, `RELEASE_CREATED`, `RELEASE_UPDATED` e `RELEASE_CANCELLED` — e `DocEvent.scope` ganhou `changeRequestId?` e `releaseId?`. Os cinco `CR_*` são gravados **só** em `ChangeRequest.events` (a "trilha própria" de `03-modelo-do-documento.md` §13), nunca em `doc.events`; os três de release vão para `doc.events`, porque `Release` não tem trilha própria no schema. A trilha é append-only como a auditoria: o inverso de uma transição devolve o `status` e **não** apaga o evento — e, como os inversos internos não gravam nada, refazer também não duplica. |
| **Data / gatilho** | 2026-08-15, implementação da S32b: RN-GOV-01 exige que "toda transição grave evento com autor e data", e `makeEvent` só produz `DocEvent`, cujo `type` vem de um catálogo fechado. |
| **Alternativas** | (a) gravar o evento nos dois lugares (trilha do DB **e** `doc.events`) — dobra o texto de cada evento no `.json` (o alvo de 10 MB é do arquivo inteiro) e cria a pergunta "qual das duas cópias vale?" no merge; (b) mandar tudo para `doc.events` e deixar `ChangeRequest.events` vazio — contraria o §13, e a fila do gestor (US-GOV-04) passaria a ler o log inteiro do documento filtrando por escopo para montar a história de um DB; (c) `events: []` nos comandos de DB, como projeto e metadados de matriz — impossível: o DB **é** o registro do processo, e um workflow sem trilha não responde "quem aprovou e quando", que é o problema do §1. |
| **Por quê** | Cada trilha fica junto do que ela conta. A do DB é lida sempre no contexto de um DB (a tela da S35, o Pacote para a Fábrica da S38), e a de release não existe como conceito — o que a release tem é status, e status muda pouco. A assimetria é do schema fechado na S32a, não uma escolha nova desta sessão. |
| **Custo aceito** | O catálogo de eventos cresceu de 31 para 39 tipos, e o mapa de ícones do histórico ganhou oito linhas para continuar total. Quem quiser "tudo que aconteceu no documento" precisa unir `doc.events` com as trilhas dos DBs — o que só será necessário quando existir uma timeline global do Diário de Bordo (S37), e lá a união é uma linha. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §8, §13; `08-camada-de-comandos.md` §3 |

---

## DEC-GOV-020: o grafo do §5 vence o texto — de `APPROVED` não se volta para `CHANGES_REQUESTED`

| Campo | Conteúdo |
|---|---|
| **Decisão** | `changeRequest/transition` implementa **literalmente** o grafo de `14-governanca-de-alteracoes.md` §5. Onde o texto em volta do grafo sugere uma aresta que o grafo não tem — "a partir de `APPROVED`, mudar o escopo exige voltar a `DRAFT` via `CHANGES_REQUESTED`" —, vale o grafo: de `APPROVED` só se vai para `IN_DEVELOPMENT` ou `CANCELLED`, e mudar escopo depois de aprovado significa **criar um DB novo**. A devolução por `CHANGES_REQUESTED` continua existindo a partir de `IN_REVIEW`, reabrindo a edição e preservando `approvals` — que é exatamente o que o CT-GOV-04 verifica. |
| **Data / gatilho** | 2026-08-15, implementação da S32b: o prompt da sessão manda validar "exclusivamente o grafo do §5", e o terceiro bullet logo abaixo do grafo descreve um caminho que o grafo não desenha. |
| **Alternativas** | (a) acrescentar a aresta `APPROVED → CHANGES_REQUESTED` — resolveria o texto, mas cria uma porta de saída do congelamento de I30 justamente onde ele começa a valer, e transformaria "aprovado" num estado sem consequência; (b) implementar as duas e deixar a interface escolher — a ambiguidade viraria comportamento, e a S35 herdaria a decisão sem contexto para tomá-la. |
| **Por quê** | O congelamento pós-aprovação é a única coisa que faz a aprovação significar alguma coisa num produto sem autenticação (DEC-GOV-004): o que foi aprovado é o que vai para a fábrica. Reabrir o escopo de um DB aprovado apagaria a diferença entre "aprovado" e "em rascunho", e o próprio §5 já oferece a saída correta na segunda metade da frase — criar outro DB, que nasce com trilha, motivador e aprovação próprios. |
| **Custo aceito** | Um DB aprovado com erro de escopo precisa ser cancelado e refeito, em vez de devolvido. É mais caro no caso raro, e é o caso em que se **quer** que seja caro. Se o uso real mostrar o contrário, o conserto é uma linha no §5 e uma em `CR_TRANSITIONS` — a decisão está isolada num módulo só (`src/core/document/cr-workflow.ts`). |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §5.1; `08-camada-de-comandos.md` §3 |

---

## DEC-GOV-021: a árvore vive dentro de `ProjectDetail`; a lista de matrizes com facetas continua sendo o conteúdo padrão

| Campo | Conteúdo |
|---|---|
| **Decisão** | O painel da árvore (`PolicyTree`, 360px) entra **dentro** da tela existente do projeto (`ProjectDetail`), como uma coluna nova ao lado do conteúdo — não como rota própria nem substituindo a lista de matrizes com facetas do §15. Sem nó selecionado na árvore, a coluna de conteúdo mostra exatamente a mesma lista de matrizes de sempre; selecionar um componente troca o conteúdo para o breadcrumb + resumo dele (`ComponentContentPanel`); selecionar um nó `MATRIX` navega direto para o grid. O inspector à direita (`ComponentInspector`) entra na mesma prioridade do `Inspector` do shell, acima da versão de matriz que possa ter ficado aberta atrás. |
| **Data / gatilho** | 2026-08-15, implementação da S33a: `07-ux-e-editor.md` §17.1 já dizia "a árvore é a tela do projeto, não um item da sidebar" e §17.2 já dizia "a lista com facetas continua existindo e não é substituída", mas não fechava **onde** as duas ficam uma em relação à outra — e o E2E existente (`matriz-e-grid.spec.ts`) depende de clicar num projeto e achar a matriz na mesma tela, sem navegação extra. |
| **Alternativas** | (a) rota própria (`#/tree`), com a lista de matrizes virando um item novo da sidebar ("Matrizes") — realiza o mockup de 4 colunas ao pé da letra, mas move a "porta" que os testes e os usuários atuais já conhecem, quebrando `matriz-e-grid.spec.ts` e todo fluxo que abre um projeto esperando ver as matrizes ali; (b) árvore só dentro do inspector, sem painel próprio — não cabe uma árvore de várias centenas de nós num painel de 340px pensado para propriedades. |
| **Por quê** | As duas telas continuam existindo, do jeito que §17.2 já prometia, e nenhuma delas muda de endereço: quem sempre abriu um projeto para ver as matrizes continua vendo as matrizes primeiro; quem quer navegar pela estrutura agora tem o painel ao lado, sem sair da tela. "Duas portas para a mesma matriz" vira literalmente duas colunas da mesma tela, não duas rotas — o que é mais barato de manter em sincronia (filtro, seleção, undo) e não exige ensinar de novo onde as coisas ficam. |
| **Custo aceito** | `ProjectDetail.tsx` deixou de ser uma coluna central única e virou um layout de duas colunas internas — o componente cresceu, e quem mexer nele de novo precisa lembrar que a coluna de conteúdo tem dois modos (lista de matrizes × componente selecionado), não um. As âncoras de 2 níveis na sidebar (§17.1) compensam parcialmente a ausência de uma rota própria: dão um atalho direto sem abrir o painel de 360px. |
| **Páginas afetadas** | `07-ux-e-editor.md` §17.1; `src/components/projects/ProjectDetail.tsx`, `src/components/tree/`, `src/components/shell/Sidebar.tsx`, `src/components/shell/Inspector.tsx` |

---

## DEC-GOV-022: publicação de componente não tem campo de notas — o diálogo reaproveita o padrão visual, não o schema

| Campo | Conteúdo |
|---|---|
| **Decisão** | `PublishComponentDialog` (S33b) segue o mesmo padrão visual do diálogo de publicação de matriz (`PublishVersionDialog`, S13) — vigência obrigatória, alerta de irreversibilidade —, mas **sem** o campo de notas. `ComponentVersion` (fechado na S32a, `03-modelo-do-documento.md` §12.1) não tem campo `notes`; só `RulePayload.notes` existe, e é conteúdo de negócio, não nota de publicação. Em vez de adicionar um campo ao schema fechado, o diálogo simplesmente não pede nota nenhuma, e mostra em vez disso o aviso da RN-GOV-07 (publicação direta) como texto fixo — sempre visível nesta sessão, já que nenhum componente publicado aqui vem de DB. |
| **Data / gatilho** | 2026-08-15, implementação da S33b: o prompt da sessão pede "mesmo diálogo-padrão das matrizes, `effectiveFrom` obrigatório e nota", e o schema de `ComponentVersion` não tem onde gravar essa nota. |
| **Alternativas** | (a) acrescentar `notes?: string` a `ComponentVersion` — reabriria um contrato que a S32a fechou deliberadamente sem esse campo (docs/14 §3.2 lista os campos, e nota de publicação não está entre eles), e exigiria migração de schema fora do escopo desta sessão; (b) gravar a "nota" dentro de `RulePayload.notes` — colide com o campo que já existe para conteúdo de negócio ("Notas" da regra), e não existe em `ListPayload`/`ReasonCodePayload`/`PolicyVariablePayload`/`OtherPayload` com o mesmo papel. |
| **Por quê** | O contrato de `03-modelo-do-documento.md` §12 é normativo e já fechado; "quando os dois divergirem, vale o docs/03" é a régua explícita do próprio `14-governanca-de-alteracoes.md` §3. A palavra "nota" do prompt da sessão descreve a *sensação* do diálogo (o mesmo cuidado da publicação de matriz), não um campo específico — e o aviso da RN-GOV-07 cumpre o mesmo papel de "dizer o que está acontecendo" sem inventar dado novo. |
| **Custo aceito** | O histórico de um componente não guarda "o que mudou nesta publicação" em texto livre, ao contrário da matriz. Quando existir DB (S35+), `changeRequestId` na versão já aponta a especificação completa — o caso que mais precisaria de nota já tem lastro melhor que um campo de texto solto. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §12.1 (sem mudança — confirma o contrato); `src/components/dialogs/PublishComponentDialog.tsx` |

---

## DEC-GOV-023: "Publicar pendentes" é um comando puro só, não N publicações em sequência

| Campo | Conteúdo |
|---|---|
| **Decisão** | `componentVersion/publishPending` (S33b) é **um** comando (`src/core/versioning/component-lifecycle.ts`) que recebe uma lista de `versionId` e uma vigência, valida **todos** os itens contra o documento original, e só então aplica a mutação de todos numa `applyToDocument` só — em vez de a interface disparar `componentVersion/publish` uma vez por item. |
| **Data / gatilho** | 2026-08-15, implementação da S33b, RN-GOV-05 ("publicação... é atômica: valida todos os rascunhos vinculados... publica tudo ou nada"). |
| **Alternativas** | (a) a UI chama `dispatch(publishComponentVersion(...))` em loop, um item de cada vez — mais simples de escrever, mas cada `dispatch` já commita no `document-store` antes do próximo rodar (`src/store/document-store.ts`), então um erro no item 8 de 10 deixaria os 7 anteriores publicados: o "tudo ou nada" viraria responsabilidade da UI desfazer manualmente, contra um comando (`publish`) que é deliberadamente irreversível (I3) — não haveria como desfazer os 7 já aplicados. |
| **Por quê** | O padrão de comando puro (`docs/08-camada-de-comandos.md` §1, regra 4: "valida antes de tocar... em caso de erro nada é escrito") já resolve exatamente este problema quando a validação inteira e a escrita inteira vivem dentro do mesmo `execute`. Reaproveitar esse mesmo mecanismo para o lote é mais barato e mais seguro do que construir uma camada de rollback só para este caso. |
| **Custo aceito** | O comando de lote duplica (não reaproveita por chamada direta) a lógica de validação e de mutação de `componentVersion/publish` — as duas funções evoluem juntas manualmente se a regra de publicação mudar. Aceito porque as duas são pequenas e cobertas por teste espelhado (`tests/unit/core/versioning/component-lifecycle.test.ts`). |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §6 (RN-GOV-05); `src/core/versioning/component-lifecycle.ts`, `src/components/dialogs/PublishPendingComponentsDialog.tsx` |

---

## DEC-GOV-024: entrada em volume usa texto separado por vírgula e reconhece só dois prefixos — não o vocabulário inteiro do §9.1

| Campo | Conteúdo |
|---|---|
| **Decisão** | Duas simplificações deliberadas na "entrada em volume" da S33b: (1) os campos de lista do payload (`inputs`, `reasonCodes`, `dependencies` em `RulePayload`; `fields` em `ListPayload`) são um único `<input>` de texto separado por vírgula na tela, não um editor chave-valor; (2) o reconhecimento de bloco colado (`recognizeRulePaste`, `src/core/versioning/rule-paste.ts`) só reconhece dois prefixos de linha — `Definição técnica:` e `Observação:` (distribuída em `reasonCodes`/`outcome`/`notes`) —, não o vocabulário inteiro de marcadores do §9.1 (`Entradas:`, `Condições:`, `Resultado:`, `Reason code:`, `Fonte:`, `Notas:`), que é o vocabulário da carga por Markdown estruturado (S40, opcional). |
| **Data / gatilho** | 2026-08-15, implementação da S33b. O prompt da sessão já distingue os dois formatos: "colar bloco de texto no inspector reconhecendo prefixo de linha (`Definição técnica:`, `Observação:` etc.)" é o texto **cru** do documento Word, enquanto o §9.1 descreve o Markdown **já convertido** por IA para a carga por recorte — dois formatos de entrada diferentes, para dois momentos diferentes do fluxo (digitar agora × acelerar depois, DEC-GOV-012). |
| **Alternativas** | (a) um editor chave-valor completo para cada campo de lista — mais estruturado, mas o volume desta sessão (15 regras do capítulo 4.2 num único período de trabalho) pesa mais a velocidade de digitação do que a validação por item; um reason code digitado errado se corrige depois, sem custo; (b) reconhecer o vocabulário inteiro do §9.1 já nesta sessão — replicaria a lógica da carga por recorte (S40) antes de ela ser decidida como necessária (DEC-GOV-012), e o texto colado direto do Word não traz `> Entradas:`/`> Condições:` no formato de marcador do Markdown convertido. |
| **Por quê** | "Cadastrar em volume é o caso de uso, não o caso de borda" (docs/prompts/S33b): o texto separado por vírgula e o reconhecimento de dois prefixos cobrem exatamente o padrão observado no documento real (`14-governanca-de-alteracoes.md` §9.1, coluna "No Word") sem esperar a conversão para Markdown, que é um passo manual fora da ferramenta. |
| **Custo aceito** | Um `code` de reason code ou de dependência com vírgula literal no texto não é representável (caso não observado no documento real). O reconhecimento de colagem não cobre `Entradas:`/`Condições:`/`Resultado:` isolados — quem colar esses marcadores vê o texto cair em `businessDescription` sem separação, e edita à mão. Se o uso real mostrar que vale a pena, o parser de `rule-paste.ts` cresce por prefixo novo, sem mudar o contrato do payload. |
| **Páginas afetadas** | `07-ux-e-editor.md` §17.3, §17.5; `src/components/inspector/ComponentPayloadFields.tsx`, `src/core/versioning/rule-paste.ts` |

---

## DEC-GOV-025: o parser de Markdown nunca descarta conteúdo — o que não tem campo dobra em `notas`, rotulado

| Campo | Conteúdo |
|---|---|
| **Decisão** | `parseMarkdownPolicy` (`src/core/import/markdown-policy.ts`, S40) nunca joga texto fora em silêncio. Duas situações concretas: (1) um bloco de citação (`>`) que não casa nenhum dos dez marcadores do §9.1 entra em `notas`, concatenado ao que já havia, com um aviso `MARKDOWN_MARKER_IGNORED` no nó; (2) um componente cujo tipo final não é `RULE` (`> Tipo: LIST`/`REASON_CODE`/`POLICY_VARIABLE`/`OTHER`, ou trocado na revisão) não tem campo para `> Definição técnica:`/`Entradas:`/`Condições:`/`Resultado:`/`Reason code:`/`Dependências:` (só `RulePayload` os tem, docs/03-modelo-do-documento.md §12) — esses marcadores capturados dobram em `notas`, rotulados (`"Reason code: GD01"`), em vez de somem. |
| **Data / gatilho** | 2026-08-15, implementação da S40. |
| **Alternativas** | (a) descartar o que não casa um campo do payload — mais simples, mas contradiz o "nunca invente conteúdo" do prompt de conversão (§9.1) pelo lado oposto: perder conteúdo real é tão ruim quanto inventar; (b) bloquear a linha com erro até o usuário resolver — pune justamente o caso comum (marcador de RULE sob um nó que a heurística ou a revisão reclassificou), quando "guardar em notas e avisar" já basta para o revisor decidir. |
| **Por quê** | O parser não sabe, sozinho, se um `> Reason code:` embaixo de um nó agora `LIST` é erro de digitação ou uso legítimo (uma lista pode ter reason codes associados). Preservar em `notas` com aviso mantém a decisão em quem revisa (passo 2 do assistente), sem bloquear o fluxo nem inventar estrutura que o documento não pediu. |
| **Custo aceito** | O texto em `notas` de um componente não-`RULE` pode ficar longo e menos estruturado do que os campos originais — aceitável porque `notas` já é texto livre em todo payload (docs/03 §12), e o comportamento é o mesmo "sem edição manual pós-carga" que os critérios de aceite pedem: nada se perde, só migra de campo. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §9.1; `src/core/import/markdown-policy.ts`, `tests/unit/core/import/markdown-policy.test.ts` |

---

## DEC-GOV-026: desfazer a carga por recorte é um comando dedicado, não a composição dos inversos dos subcomandos

| Campo | Conteúdo |
|---|---|
| **Decisão** | `component/importMarkdown` (`src/core/import/markdown-apply.ts`, S40) publica cada componente direto (`component/create` + `componentVersion/createDraft` + `componentVersion/publish`, docs/14 §9 passo 4). Ao contrário de `import/apply` (que nunca publica, RN-10, e por isso compõe os inversos reais dos subcomandos numa pilha — `src/core/import/apply.ts`), o desfazer aqui **não pode** reusar essa composição: `componentVersion/publish` devolve `irreversible(...)` (I3 — publicar é definitivo), e compor um inverso irreversível quebraria o desfazer do lote inteiro. O desfazer é, em vez disso, um comando próprio (`component/_removeMarkdownImport`) que guarda uma cópia integral de cada componente criado (já publicado) e sua posição original, e devolve exatamente isso — "esvaziar de novo o que só esta carga criou", não desfazer a publicação em si. Duas guardas o protegem: recusa se algum componente da carga ganhou filho ou versão nova por fora dela (mesmo espírito de `removeCreatedComponent`, docs/03 §12), e recusa se o próprio componente já não existe. |
| **Data / gatilho** | 2026-08-15, implementação da S40, CT-GOV-05 ("desfazer remove a carga inteira"). |
| **Alternativas** | (a) a carga não publicar, como a de matrizes (RN-10), deixando tudo em rascunho para revisão — rejeitada porque o §9 passo 4 é explícito: a primeira versão nasce `PUBLISHED`, porque a política **já vigia** antes da carga (mesma lógica da RN-GOV-09); manter 100 rascunhos abertos não reflete esse fato; (b) não oferecer desfazer nenhum para este comando (como `componentVersion/publish` sozinho) — rejeitada porque o critério de aceite exige undo total, e um lote de dezenas de componentes sem desfazer é caro demais de corrigir manualmente se o destino ou o texto colado estiverem errados. |
| **Por quê** | A carga sabe, no momento em que termina, exatamente quais componentes ela criou e o estado final de cada um — não precisa da cadeia genérica de inversos para reconstruir isso, só precisa lembrar. Um comando dedicado é mais simples de raciocinar sobre corretude do que ensinar `componentVersion/publish` a ter um inverso condicional. |
| **Custo aceito** | O desfazer desta carga não é "o inverso de publicar" no sentido geral — é específico a este comando. Se algo externo tocar um componente da carga entre a aplicação e o desfazer, a operação recusa (em vez de silenciosamente arrastar ou perder esse trabalho), e a pessoa precisa remover manualmente. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §9, §10 (CT-GOV-05); `src/core/import/markdown-apply.ts`, `tests/unit/core/import/markdown-apply.test.ts` |

---

## DEC-GOV-027: o assistente de carga por recorte é um diálogo lançado da árvore, não uma tela própria

| Campo | Conteúdo |
|---|---|
| **Decisão** | `MarkdownImportDialog` (`src/components/import/markdown/`, S40) é um `Dialog` aberto a partir da barra da árvore ("Carregar Markdown") ou do menu de um nó ("Carregar Markdown aqui…"), não uma rota/`View` própria como o assistente de carga de matrizes (`ImportWizard`, `view: 'import'`, docs/12 §6). |
| **Data / gatilho** | 2026-08-15, implementação da S40. |
| **Alternativas** | Uma `View` própria, no padrão do assistente de matrizes — rejeitada porque o destino desta carga (docs/14 §9 passo 2, o que a S40 acrescenta ao desenho original) **é** um nó da árvore que já está aberta na tela do projeto (docs/07 §17.1); navegar para uma rota separada obrigaria escolher o destino de novo por busca, em vez de aproveitar o contexto de onde o usuário já estava (clicar "aqui" no menu de um nó pré-seleciona o destino). O assistente de matrizes precisa de tela própria porque os passos 2–4 dele (colunas, biblioteca, conteúdo) não têm equivalente aqui — a carga por recorte é sempre três passos pequenos. |
| **Por quê** | Menos navegação para o caso de uso central (`docs/14` §9: "repetindo isso capítulo a capítulo, no ritmo dele") — abrir o diálogo, colar, revisar, confirmar, fechar, sem sair da árvore entre uma carga e a próxima. |
| **Custo aceito** | Nenhuma URL/hash própria para o assistente (diferente de `#/import`) — não é possível linkar diretamente para "no meio de uma carga"; aceitável porque o estado da carga é efêmero e não faz sentido persistir entre sessões. |
| **Páginas afetadas** | `07-ux-e-editor.md` §14, §17; `src/components/import/markdown/MarkdownImportDialog.tsx`, `src/components/tree/PolicyTree.tsx` |

---

## DEC-GOV-028: coalescência de digitação é da pilha de comandos (`coalesceKey`), não do editor

| Campo | Conteúdo |
|---|---|
| **Decisão** | O editor rico (S34) despacha **um comando por tecla** (`richdoc/apply`), e quem funde a sequência é o store: `Command` ganhou o campo opcional `coalesceKey` (`src/core/command.ts`) e `dispatch` (`src/store/document-store.ts`) substitui a entrada do topo da pilha quando a chave do comando novo é igual à do anterior, **preservando o `inverse` do primeiro da sequência**. Chave da digitação: `richdoc:<alvo>:<bloco>:<célula>` (`typingCoalesceKey`). Qualquer comando sem chave — ou com chave diferente —, desfazer, refazer, trocar de documento e a ação explícita `breakCoalescing()` fecham a sequência. |
| **Data / gatilho** | 2026-08-15, implementação da S34, critério de aceite "um Ctrl+Z desfaz a digitação inteira, não letra a letra". |
| **Alternativas** | (a) o editor segurar o texto em `useState` e despachar um comando só no `blur`/debounce — é o desenho clássico, e é justamente o que perde trabalho: o que está no `useState` não está no documento, então fechar a aba, salvar por Ctrl+S ou uma exceção de render levam o parágrafo junto (o modo de falha central desta sessão); (b) coalescer dentro do comando, comparando `type` e `input` no `dispatch` — daria fusão acidental entre comandos diferentes que por acaso tocam o mesmo alvo (uma troca de tipo de bloco seguida de digitação viraria uma entrada só); a chave explícita diz **o que** está sendo digitado e nunca funde gestos distintos. |
| **Por quê** | O documento continua sendo a única fonte de verdade a cada tecla (nada pendente em estado local), e a pilha de undo continua legível para quem edita: uma entrada por gesto, não uma por caractere. O mecanismo é genérico — a S35 reusa a mesma chave para os campos de texto do DB, sem inventar outro. |
| **Custo aceito** | A fusão é por **sequência**, não por tempo: sair do bloco e voltar cria duas entradas, e uma pausa longa digitando no mesmo bloco continua sendo uma entrada só. Um limite temporal (estilo "5 s sem tecla fecha o grupo") exigiria relógio dentro do store — impureza nova para um ganho que ninguém pediu. |
| **Páginas afetadas** | `08-camada-de-comandos.md` §1, §2; `07-ux-e-editor.md` §18; `src/core/command.ts`, `src/store/document-store.ts`, `src/core/richdoc/commands.ts` |

---

## DEC-GOV-029: o diff de `RichDoc` detecta movimento — mover não é remover + adicionar

| Campo | Conteúdo |
|---|---|
| **Decisão** | `diffRichDoc` (`src/core/richdoc/diff.ts`) classifica cada bloco em `ADDED`, `REMOVED`, `CHANGED`, `MOVED` ou `UNCHANGED`, casando pelos **ids** dos dois lados: mesmo id e mesmo conteúdo em ordem relativa diferente é `MOVED`; conteúdo **e** ordem mudando é `CHANGED` com `moved: true`. "Ordem" é a posição **entre os blocos que existem dos dois lados** — apagar o primeiro parágrafo não faz os seguintes contarem como movidos. Bloco cujo id não existe do outro lado é `ADDED`/`REMOVED`, mesmo que o texto seja idêntico ao de outro bloco. |
| **Data / gatilho** | 2026-08-15, implementação da S34 (o prompt deixa a escolha explícita: "incluindo mover ≠ remover+adicionar, se você optar por detectar movimento — decida e documente"). |
| **Alternativas** | (a) não detectar movimento (só added/removed/changed) — mais simples, e o resultado prático é um diff que obriga a reler texto que não mudou: reordenar dois parágrafos apareceria como dois blocos apagados e dois criados; (b) casar blocos por semelhança de texto quando o id não bate — resolveria o caso de "recriei o parágrafo do zero", ao custo de adivinhação: num diff de política, uma linha a mais é melhor do que um pareamento inventado. |
| **Por quê** | O `id` do bloco é estável por contrato (`03-modelo-do-documento.md` §12.3) — a informação de identidade já está lá, de graça. Jogá-la fora produziria exatamente o diff ruidoso que a S36/S39 precisam evitar quando mostrarem "hoje × proposto" de uma especificação inteira. |
| **Custo aceito** | Reescrever um bloco do zero (apagar e digitar de novo) aparece como remoção + adição, porque o id novo é outro. É o preço de não adivinhar, e o texto continua visível dos dois lados. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §7; `src/core/richdoc/diff.ts`, `src/components/richdoc/RichDocDiffView.tsx` |

---

## DEC-GOV-030: colar preserva estrutura e descarta formatação, com parser de HTML próprio

| Campo | Conteúdo |
|---|---|
| **Decisão** | A sanitização do colar (`src/core/richdoc/paste.ts`) preserva **estrutura** — parágrafo, item de lista, célula de tabela — e descarta **toda** formatação: negrito, cor, fonte e `class=Mso*` do Word não sobrevivem. O parser é próprio e regex-based, sem `DOMParser`: `src/core/` é TypeScript puro (regra 4) e DEC-GOV-005 proíbe dependência nova. Duas heurísticas complementam o contrato do §7: parágrafo do Word que **começa** com marcador (`·`, `•`, `-`, `1.`) vira item de lista, e TSV com mais de uma coluna em todas as linhas vira tabela (é o Excel quando só há `text/plain`). |
| **Data / gatilho** | 2026-08-15, implementação da S34, critério de aceite "colar texto do Word não traz lixo de formatação". |
| **Alternativas** | (a) preservar negrito/itálico do HTML colado, mapeando `<b>`/`<i>` para as marcas do modelo — tentador, e é o caminho mais rápido para trazer o entulho junto: o Word emite formatação em `<span style>` com fonte, tamanho e cor por trecho, e o que se preserva de fato é a bagunça, não a intenção; (b) rodar a sanitização no componente, com `DOMParser` — quebraria a regra 4 e deixaria a parte mais delicada do colar sem teste puro. |
| **Por quê** | Quem cola do Word quer o texto, não o tema visual do Word; e a estrutura (lista, tabela) é o que custaria caro redigitar. O parser próprio não precisa ser completo — precisa achar tabela, lista e fronteira de parágrafo, e jogar o resto fora. |
| **Custo aceito** | Negrito legítimo do documento de origem se perde e precisa ser reaplicado com Ctrl+B. Um parágrafo que comece com hífen legítimo (`- veja a nota`) vira item de lista. Colar imagem continua fora (docs/14 §7): anexar é explícito. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §7; `07-ux-e-editor.md` §18; `src/core/richdoc/paste.ts`, `tests/fixtures/paste-word.html`, `tests/fixtures/paste-excel.html` |

---

## DEC-GOV-031: remover o bloco de imagem apaga o anexo órfão na mesma transação

| Campo | Conteúdo |
|---|---|
| **Decisão** | `richdoc/removeBlock` (`src/core/richdoc/commands.ts`) verifica, ao remover um bloco `image`, se ele era a **última** referência àquele `INLINE_IMAGE` em todo o documento (`countInlineImageReferences`, varrendo especificações de componente, `motivationText`/`spec` de DB e o boilerplate do projeto). Se era, o anexo sai de `attachments` junto, na mesma transação; o inverso devolve bloco e anexo, este último no índice exato em que estava. |
| **Data / gatilho** | 2026-08-15, implementação da S34. |
| **Alternativas** | (a) nunca apagar o anexo, deixando a limpeza para uma varredura futura — cada imagem errada anexada e removida deixaria até 300 KB mortos no `.json`, invisíveis para quem edita (não há tela de anexos embutidos) e contando para o aviso de 3 MB; (b) apagar sempre, sem contar referências — perderia a imagem de outro bloco/DB que aponta o mesmo anexo. |
| **Por quê** | O byte da imagem embutida mora no próprio `.json` (`03-modelo-do-documento.md` §8.1) e o alvo do arquivo é 10 MB: anexo sem bloco é peso morto que ninguém consegue ver para apagar. Contagem de referências é barata e mantém o inverso exato, que é o que o undo exige. |
| **Custo aceito** | A regra vale para a remoção **explícita** de bloco (botão do bloco). Fundir/colar por cima nunca remove bloco de imagem, então não há caminho silencioso de perda; e evidências do acervo (`EVIDENCE`, ADR-004) seguem intocadas — a lixeira delas é outra história (`14-plataforma-local.md` §7). |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §7; `03-modelo-do-documento.md` §8.1; `src/core/richdoc/commands.ts`, `src/core/richdoc/attachments.ts` |

---

## DEC-GOV-032: a tela do DB (S35) não pede migração — estende `RichDocTarget` e deriva projeto dos itens

| Campo | Conteúdo |
|---|---|
| **Decisão** | Duas escolhas de encaixe, nenhuma delas schema novo: (1) `RichDocTarget` (`src/core/richdoc/commands.ts`) ganha `{ kind: 'CR_MOTIVATION' \| 'CR_SPEC'; changeRequestId }` ao lado de `COMPONENT_VERSION_SPEC` — `locateTarget`/`readRichDoc`/`writeRichDoc` viram um `switch` sobre `target.kind`, e o alvo de DB usa `assertChangeRequestOpen` (fecha só quando o DB fecha, `PUBLISHED`/`REJECTED`/`CANCELLED`) em vez de `assertComponentVersionEditable` — `motivationText`/`spec` continuam editáveis depois de `APPROVED`, porque são metadado do DB (como `title`/`owner`), não escopo (I30); (2) a tela de lista (`ChangeRequestsScreen`) e o painel de pendências filtram/derivam "o projeto de um DB" a partir do `projectId` dos componentes dos seus itens (`changeRequestProjectIds`, `src/core/document/change-requests.ts`), sem acrescentar `ChangeRequest.projectId` ao schema. |
| **Data / gatilho** | 2026-08-17, implementação da S35. A extensão de `RichDocTarget` já estava prevista no comentário deixado pela S34: "a S35 acrescenta os campos do DB sem tocar em nada aqui além desta união" — literalmente seguido à risca. A ausência de `projectId` em `ChangeRequest` (docs/03 §13, decidida na S32a) obrigou a segunda escolha. |
| **Alternativas** | Para (1): duplicar `RichDocEditor`/`richdoc/apply` para um alvo de DB — rejeitado, é exatamente o "editor rico" de novo, com toda a mecânica de coalescência e colagem reimplementada por engano. Para (2): migração 5→6 acrescentando `ChangeRequest.projectId` — rejeitado porque um DB **pode** tocar componentes de mais de um projeto (nada no modelo impede, e o caso não é hipotético: `RN-GOV-02` só proíbe repetir o mesmo componente, não limita a um projeto), então o campo seria uma mentira estrutural na primeira vez que alguém precisasse dele; e uma migração só para um campo derivável não paga o custo de mexer em `03-modelo-do-documento.md` §10 de novo tão cedo depois da S32a (DEC-GOV-009, migração puramente aditiva já fechada). |
| **Por quê** | As duas decisões mantêm a S35 uma sessão **só de tela** sobre o núcleo que a S32a/S32b já fecharam — nenhum comando novo, nenhuma migração, nenhuma invariante nova. É o mesmo espírito de DEC-GOV-010 (uma migração só) aplicado à sessão seguinte. |
| **Custo aceito** | Um DB sem item nenhum (`DRAFT` recém-criado) não pertence a projeto algum ainda — a UI escopa a busca de item por um `Select` de projeto local (não persistido) até o primeiro item entrar; a partir daí, o projeto trava no do primeiro item. Se um DB real vier a tocar dois projetos, a lista "por projeto" o mostra nos dois — comportamento correto, não um bug a esconder. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3.3, §7; `07-ux-e-editor.md` §19; `src/core/richdoc/commands.ts`, `src/core/document/change-requests.ts` |

---

## DEC-GOV-033: numeração de DB e papéis (perguntas 1–2 de §12) fecham como a proposta original, sem cadastro de pessoas

| Campo | Conteúdo |
|---|---|
| **Decisão** | As duas perguntas do §12 fecham exatamente como a proposta original antevia, sem ajuste: (1) numeração é campo livre (`code`), com sugestão sequencial a partir do maior `DB_<n>` do documento (`suggestNextChangeRequestCode`), sempre editável — reinicia, segue a sequência do Word ou aceita colisão sem drama, porque quem garante unicidade é I31, não a sugestão; (2) papel de aprovador não ganhou cadastro nem um valor novo em `Role` (`src/core/document/roles.ts`) — a resposta já estava implementada desde a S32b (`minRoleForCommand` deixa todo `changeRequest/*` no piso `EDITOR`, docs/08 §6) sem que este documento tivesse sido atualizado para registrar a decisão. A S35 só declara isso na tela (`ChangeRequestPendingPanel`) para ninguém supor controle de acesso que não existe. |
| **Data / gatilho** | 2026-08-17, implementação da S35 — as perguntas estavam marcadas "(S35)" desde a revisão de UX de 2026-08-14. |
| **Alternativas** | Para papéis: um papel `APPROVER` dedicado em `Role` — rejeitado porque criaria uma segunda noção de "quem pode aprovar" different da ACL existente (`meta.acl`, ADR-003/DEC-GOV-004), e o produto já decidiu que governança de DB é processual, não controle de acesso real; adicionar o papel só para depois descobrir que ele não trava nada de verdade (qualquer `EDITOR` já edita o `.json` na mão) seria segurança teatral, o mesmo argumento que fechou DEC-GOV-004. |
| **Por quê** | Nenhuma das duas perguntas escondia uma decisão de schema ou de comando pendente — eram, na prática, "confirma que o caminho mais simples já é suficiente?". Confirmado pelos dois: campo livre com sugestão resolve numeração sem inventar reserva de sequência; identidade existente (nome digitado/login capturado) resolve "quem decidiu o quê" sem inventar autenticação. |
| **Custo aceito** | Sem cadastro de pessoas, a fila do gestor (US-GOV-04) não sabe filtrar "os DBs atribuídos a mim" além do texto livre de `owner`/`requestedBy`/autor de decisão batendo com o nome digitado (`useActor`) — aceito, porque um cadastro real exigiria o mesmo tipo de infraestrutura de identidade que DEC-GOV-004 já recusou. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §12; `08-camada-de-comandos.md` §6 (já refletia a decisão, sem cross-reference); `07-ux-e-editor.md` §19.1/§19.4 |

---

## DEC-GOV-034: congelamento (I25) barra edição do rascunho vinculado, não a publicação dele

| Campo | Conteúdo |
|---|---|
| **Decisão** | A partir de `APPROVED`, o rascunho que um item do DB aponta fica somente leitura: `componentVersion/update`, `componentVersion/discardDraft`, `richdoc/apply` sobre a especificação da versão, `version/applyCellPatch(es)`, os comandos de `axis/*` e `version/discardDraft` chamam `assertLinkedDraftEditable` (`src/core/document/cr-freeze.ts`) e recusam com `CR_TRANSITION_INVALID` (`E-GOV-01`). **Publicar aquele rascunho por fora do DB continua permitido** — é publicação direta (RN-GOV-07) —, e a inconsistência resultante aparece na hora certa: o item passa a apontar uma versão que não é mais rascunho, `assessChangeRequestReadiness` a reporta como `ITEM_DRAFT_NOT_DRAFT`, e `changeRequest/publish` recusa o DB inteiro com `E-GOV-04` em vez de escrever por cima. |
| **Data / gatilho** | 2026-08-17, implementação da S36. O enunciado da sessão pede "itens e rascunhos vinculados somente leitura a partir de `APPROVED`", e a primeira leitura literal incluiria publicar. |
| **Alternativas** | (a) barrar também a publicação do rascunho vinculado — exigiria uma exceção para o próprio `changeRequest/publish`, que publica exatamente esses rascunhos a partir de `READY_FOR_RELEASE`, um estado **já congelado** pela ordem de `CR_STATUSES`; a guarda teria de saber "quem está chamando", o que a camada de comandos não tem (e não deveria ter, `08-camada-de-comandos.md` §1); (b) congelar por um flag no documento — inventaria estado paralelo ao status do DB, que já é a fonte da verdade. |
| **Por quê** | O congelamento existe para que **o que foi aprovado seja o que será publicado**. Editar o conteúdo depois da aprovação quebra isso em silêncio; publicá-lo por fora não quebra — muda o *como*, não o *quê*, e deixa rastro em dois lugares (a timeline marca "publicação direta", e o DB passa a acusar pendência). Barrar o caminho que não corrompe custaria uma exceção no núcleo; deixá-lo aberto custa uma frase de documentação. |
| **Custo aceito** | Um usuário `PUBLISHER` pode publicar direto o rascunho de um DB aprovado e, com isso, travar a publicação daquele DB até alguém vincular outro rascunho. É recuperável (desvincular e vincular de novo, ou criar DB novo) e visível (a pendência é tipada e aparece no diálogo antes do clique) — ao contrário do que aconteceria se a publicação sobrescrevesse. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §5, §6 (I25); `08-camada-de-comandos.md` §3; `src/core/document/cr-freeze.ts`, `src/core/versioning/*`, `src/core/richdoc/commands.ts` |

---

## DEC-GOV-035: vigência retroativa na publicação do DB — cada entidade mantém a sua regra

| Campo | Conteúdo |
|---|---|
| **Decisão** | Fecha a pergunta 4 de `14-governanca-de-alteracoes.md` §12. Publicar um DB com `proposedEffectiveDate` no passado é **permitido** quando todos os itens são de componente (é o que a RN-GOV-09 exige — a fundação cadastra regras que já vigoram) e **recusado** quando há item de espelho `MATRIX` no escopo, porque `version/publish` proíbe retroativa desde a sessão 5 (`05-regras-de-negocio.md` §1.3). A recusa acontece na validação prévia, como pendência tipada (`ITEM_EFFECTIVE_DATE_RETROACTIVE`) dentro de `E-GOV-04`, com a saída explícita: ajustar a vigência ou tirar a matriz do escopo. A ordem entre versões continua valendo para os dois tipos (`ITEM_EFFECTIVE_DATE_ORDER`). |
| **Data / gatilho** | 2026-08-17, implementação da S36 — a pergunta estava marcada "(S36)" desde a revisão de UX de 2026-08-14, e o §6 já a tinha fechado **para componentes** na S33b sem tratar o caso misto. |
| **Alternativas** | (a) o caminho do DB relaxar a regra da matriz e aceitar retroativa em tudo — mudaria uma norma de matriz (docs/05 §1.3) que existe desde a S05 e vale para 100+ matrizes reais, para atender um caso que a fundação já resolve por outro caminho; (b) proibir retroativa em qualquer DB, componente incluído — contraria a RN-GOV-09 e tornaria impossível registrar por DB uma mudança que já entrou em vigor, que é exatamente o histórico que a área quer parar de reconstruir de memória. |
| **Por quê** | A assimetria não é acidente de implementação, é o modelo: matriz é decisão operacional que o motor consome e cuja vigência retroativa reescreveria o passado de decisões já tomadas; componente é documentação versionada da política, e a fundação **precisa** declarar que a regra vale desde antes de a ferramenta existir. Uniformizar por baixo perderia a fundação; uniformizar por cima perderia a garantia da matriz. Mantendo cada regra, o único caso ambíguo — o DB misto — vira uma pergunta clara na tela, antes de qualquer escrita. |
| **Custo aceito** | Um DB que mistura regra e matriz não consegue registrar vigência passada; o usuário separa em dois DBs ou usa a data de hoje. É o preço de não afrouxar a garantia da matriz, e o diálogo de publicação diz isso na revisão, não no meio do lote. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §6, §12; `05-regras-de-negocio.md` §1.3, §9.1; `src/core/document/releases.ts`, `src/core/document/cr-publish.ts` |

---

## DEC-GOV-036: o `draftVersionId` do item sobrevive à publicação — e I30 se inverte ali

| Campo | Conteúdo |
|---|---|
| **Decisão** | Publicar o DB **não** limpa `ChangeRequestItem.draftVersionId`: o item continua apontando a mesma versão, que passou de `DRAFT` a `PUBLISHED`. A invariante I30 (`03-modelo-do-documento.md` §9) passa a ler o campo conforme o status do DB — enquanto ele não publicou, a versão apontada precisa estar em `DRAFT`; num DB `PUBLISHED`, precisa **não** estar. Na mesma linha, `changeRequest/createComponentItem` compõe `component/create` + `addItem` + `linkDraft` numa transação com um desfazer só. |
| **Data / gatilho** | 2026-08-17, implementação da S36: com o campo limpo na publicação, o documento perderia o vínculo entre o que foi aprovado e o que entrou em vigor; sem a inversão de I30, o documento publicado ficaria inválido em `validateDocument` (ERROR), o que bloquearia `prepareSave` (`06-persistencia-e-concorrencia.md` §4). |
| **Alternativas** | (a) limpar o campo ao publicar — o DB publicado viraria uma lista de textos sem lastro, e a pergunta "qual versão exatamente este DB colocou em vigor?" voltaria a ser arqueologia, que é o problema que o épico existe para resolver (§1); (b) acrescentar um `publishedVersionId` ao lado — campo novo no schema para guardar o mesmo id que já está lá, mais uma migração, e duas fontes para o mesmo fato; (c) criar o componente do item `CREATE` em três comandos separados na interface — desfazer o primeiro deixaria um item apontando componente inexistente, quebrando I30 pelo lado das referências. |
| **Por quê** | O item é o registro do que foi aprovado; a versão publicada é o que valeu. Quando são o mesmo objeto, o lastro é estrutural em vez de textual — e é o que a S37 (release), a S38 (pacote) e a S39 (fotografia) vão ler para dizer "esta versão veio deste DB". A leitura de I30 dependente do status é honesta: o campo não mudou de significado, mudou o momento do ciclo de vida em que ele é lido. |
| **Custo aceito** | O nome `draftVersionId` fica impreciso depois da publicação — trocá-lo exigiria migração de schema para um ganho puramente cosmético, então fica o nome e fica a nota, aqui e em I30. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3.3; `03-modelo-do-documento.md` §9 (I30); `src/core/document/{cr-drafts,cr-publish,validate}.ts` |

---

## DEC-GOV-037: entrar numa release exige DB ≥ APPROVED; sair continua livre até o DB fechar

| Campo | Conteúdo |
|---|---|
| **Decisão** | `changeRequest/setRelease` passa a recusar o vínculo (`releaseId` não nulo) quando o DB ainda não chegou em `APPROVED` — `CR_TRANSITION_INVALID`, mesma família de erro do resto do grafo. **Sair** (`releaseId: null`) continua sem essa exigência: só pede o DB estar aberto, valendo até ele fechar (`PUBLISHED`/`REJECTED`/`CANCELLED`), não até a release publicar. A tela (`AddChangeRequestToReleaseDialog`, docs/07 §19.6) filtra a lista de candidatos por `isChangeRequestFrozen` para não oferecer um clique que o comando recusaria, mas quem garante a regra é o núcleo. |
| **Data / gatilho** | 2026-08-18, implementação da S37: o comando já existia desde a S32b (`setChangeRequestRelease`, sem tela), escrito antes de a tela de release existir e sem essa checagem — dois testes de `releases.test.ts` (S32b) vinculavam DB em `DRAFT` a uma release só para exercitar a composição estática, e precisaram avançar o DB até `APPROVED` para continuar válidos sob a regra nova. |
| **Alternativas** | (a) deixar qualquer status entrar, como estava, e a composição (`assessReleaseComposition`) sinalizar `CR_NOT_READY` — funciona para "pronto para publicar", mas permite montar uma release cheia de DBs em `DRAFT` que ninguém decidiu ainda, o que não é "o que entra na subida", é uma lista de candidatos; (b) exigir `READY_FOR_RELEASE`/`SCHEDULED` (os dois estados de `RELEASE_READY_STATUSES`) para entrar — trocaria "montar a release" por "só adicionar DB que já terminou o desenvolvimento", contrariando o processo real (a área monta a release com DBs aprovados e acompanha o desenvolvimento deles **dentro** dela). |
| **Por quê** | `APPROVED` é o ponto do grafo em que a decisão foi tomada (RN-GOV-01) — antes disso, "juntar numa subida" não faz sentido de negócio, é só um agrupamento de rascunhos. Depois de aprovado, o DB pode evoluir (`IN_DEVELOPMENT` → `IN_VALIDATION` → `READY_FOR_RELEASE`) **dentro** da release, que é o caso real: a área monta a lista da subida de setembro assim que os DBs são aprovados, não espera todos ficarem prontos para só então montar a lista. |
| **Custo aceito** | Um DB `SUBMITTED`/`IN_REVIEW` não pode ser pré-reservado numa release — se a área quiser sinalizar intenção antes da aprovação, o jeito é um campo de texto/observação na release, não o vínculo estrutural. Não é uma perda: o vínculo estrutural existir cedo demais é o que a decisão evita. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3.4; `08-camada-de-comandos.md` §3 (Releases); `src/core/document/change-requests.ts` (`setChangeRequestRelease`) |

---

## DEC-GOV-038: `factoryTemplate` é campo simples, não versionado

| Campo | Conteúdo |
|---|---|
| **Decisão** | Fecha a pergunta 3 de `14-governanca-de-alteracoes.md` §12. `Project.factoryTemplate` (boilerplate `RichDoc` + contatos) permanece um **campo simples** por projeto, sem ciclo de versões próprio — a proposta original do §8, confirmada com o usuário antes de implementar a S38 (a pergunta estava aberta, e o prompt da sessão exigia parar e perguntar nesse caso). |
| **Data / gatilho** | 2026-08-18, implementação da S38. |
| **Alternativas** | Versionar `factoryTemplate` como `ComponentVersion`/`MatrixVersion` (histórico, `effectiveFrom`/`effectiveTo`, ciclo rascunho/publicar) — daria para responder "qual boilerplate valia quando o pacote X foi gerado", ao custo de schema novo, comandos novos e tela de histórico. |
| **Por quê** | O pacote gerado nunca é uma cópia gravada no documento (RN-GOV-08 — sempre derivado, regenerado a cada clique a partir do `factoryTemplate` **atual**). Sem pacote histórico armazenado, não existe "qual boilerplate valia naquele pacote" para responder — a pergunta que motivaria versionar não tem sujeito. Um campo simples resolve o caso real (o checklist muda pouco, e quando muda, o próximo pacote gerado já reflete a mudança) sem inventar escopo que nenhum ADR/DEC previa. |
| **Custo aceito** | Um pacote gerado hoje e um gerado amanhã, depois de alguém editar o boilerplate, mostram textos diferentes — não há como reabrir o pacote de ontem com o boilerplate de ontem, porque o pacote de ontem nunca foi salvo (é o comportamento esperado de RN-GOV-08, não uma lacuna nova). Se o checklist Serasa passar a mudar com frequência **e** existir necessidade real de auditar qual boilerplate valia num pacote passado, isso volta à mesa como sessão própria, com uso real para decidir a forma. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §8, §12 pergunta 3; `03-modelo-do-documento.md` §5 (`FactoryTemplate`); `src/core/document/schema.ts` |

---

## DEC-GOV-039: matriz sem componente espelho entra na fotografia como nó de raiz

| Campo | Conteúdo |
|---|---|
| **Decisão** | `getPolicyAt` (`src/core/timeline/policy-at.ts`) inclui **toda** matriz ativa do projeto. A que tem nó `MATRIX` na árvore entra na posição dele; a que não tem entra ao final, como nó de raiz (`depth: 1`) sem componente, com chave própria `matrix:<matrixId>` (`orphanMatrixKey`). Um espelho arquivado devolve a matriz a essa condição, em vez de fazê-la sumir junto. Na comparação de política, esse nó aparece com a mesma chave, agrupado na raiz do projeto. |
| **Data / gatilho** | 2026-08-18, implementação da S39 — a fixture do épico tem matriz espelhada, mas o produto tem 25 sessões de projetos que são **só** matrizes. |
| **Alternativas** | (a) mostrar só o que está na árvore — a fotografia de um projeto sem árvore montada viria vazia, e a resposta de auditoria ("o que valia em 15/05?") sairia errada por omissão, que é o pior erro que essa tela pode cometer; (b) criar o nó espelho automaticamente ao gerar a fotografia — escreveria no documento a partir de uma consulta de leitura, contra a regra de que consulta não altera nada (docs/08 §4); (c) listar as matrizes órfãs num bloco separado, fora da fotografia — duas listas para responder uma pergunta só, e o contador "componentes vigentes" teria de escolher um dos dois lados. |
| **Por quê** | A árvore de componentes é **opcional e incremental** (DEC-GOV-012: a política é construída à mão, seção a seção); a fotografia da política não pode depender de ela estar pronta. Como a matriz já é a segunda fonte da vigência (DEC-GOV-002), incluí-la sem espelho não acrescenta fonte nenhuma — só deixa de perder uma. |
| **Custo aceito** | A ordem da fotografia mistura duas origens: a leitura da árvore e, no fim, um apêndice de matrizes sem lugar definido. É visível na tela e é honesto — é exatamente o que "esta matriz ainda não foi pendurada na árvore" significa. Pendurar o espelho move a matriz para o lugar certo e a chave muda de `matrix:<id>` para o id do componente: uma comparação que cruze esse momento mostra o nó como removido de um lado e adicionado do outro. |
| **Páginas afetadas** | `05-regras-de-negocio.md` §6.2; `14-governanca-de-alteracoes.md` §4 (US-GOV-07); `src/core/timeline/policy-at.ts`, `src/core/diff/policy-diff.ts` |

---

## DEC-GOV-040: a janela de comparação de uma release é a vigência dos DBs, não o clique de publicar

| Campo | Conteúdo |
|---|---|
| **Decisão** | `getReleaseSnapshotWindow` monta as duas pontas de uma comparação por release a partir das **vigências** (`proposedEffectiveDate`) dos DBs publicados dela: `before` = 1 ms antes da primeira, `after` = a última. `release.publishedAt` não entra na conta. Na tela (docs/07 §20), os dois seletores do modo release usam a mesma release por padrão — a base entra pelo `before` dela, a comparada pelo `after` da sua. |
| **Data / gatilho** | 2026-08-18, implementação da S39. |
| **Alternativas** | (a) comparar em torno de `release.publishedAt` — uma release publicada hoje com DBs que só entram em vigor no dia 1º mostraria "nada mudou", que é falso e silencioso; (b) usar a vigência de cada DB e devolver N comparações, uma por DB — responde "o que o DB mudou", que a timeline do DB (S37) já responde, e não "o que a release mudou", que é a pergunta desta tela. |
| **Por quê** | DEC-GOV-035 já decidiu que cada DB da release mantém a sua própria vigência; a release é o lote de publicação, não a data em que a política muda. Com o intervalo semiaberto `[effectiveFrom, effectiveTo)`, a janela `[primeira − 1 ms, última]` é exatamente "a política sem esta release" × "a política com ela inteira". |
| **Custo aceito** | Numa release com vigências espalhadas no tempo, a janela engloba tudo que aconteceu no meio — inclusive alterações de **outros** DBs publicados nesse intervalo. É a leitura honesta ("o que a política tinha antes de a release começar a valer × o que tem depois de ela terminar de valer"); quem quiser isolar um DB usa a timeline do DB. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §4 (US-GOV-08); `07-ux-e-editor.md` §20; `src/core/timeline/policy-at.ts` |
