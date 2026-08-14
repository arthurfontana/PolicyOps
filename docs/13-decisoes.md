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
| **Custo aceito** | Um schema novo grande (S32) e telas de árvore/CRUD (S33). Tetos definidos para não degradar: profundidade 6, alerta em 300 e teto de 1.000 componentes por projeto. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3; `03-modelo-do-documento.md` (S32) |

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

## DEC-GOV-008: release publica em lote, atômica, reutilizando a publicação existente

| Campo | Conteúdo |
|---|---|
| **Decisão** | `Release` agrupa DBs; publicar a release valida todos os rascunhos vinculados e publica tudo-ou-nada com a vigência de cada DB (RN-GOV-05), compondo os comandos de publicação existentes — mesma mecânica do `import/apply` da carga. |
| **Data / gatilho** | 2026-08-13; o processo real da área sobe várias demandas juntas numa "subida" datada. |
| **Alternativas** | (a) publicar DB a DB manualmente na data — funciona, mas o estado "o que entrou na subida de setembro" deixaria de existir como fato de primeira classe; (b) release com vigência única forçada para todos os DBs — contraria casos reais de vigências distintas aprovadas juntas. |
| **Por quê** | Atomicidade em lote já tem precedente testado no produto (S24); reusar o padrão custa pouco e dá à área a resposta "o que mudou nessa release" de graça, via diff entre a fotografia anterior e a posterior. |
| **Custo aceito** | Um DB pode ficar `READY_FOR_RELEASE` esperando a release inteira ficar pronta — fila explícita no painel de pendências. |
| **Páginas afetadas** | `14-governanca-de-alteracoes.md` §3.4, §6 (RN-GOV-05) |

---

## DEC-GOV-009: schemaVersion 5, migração puramente aditiva

| Campo | Conteúdo |
|---|---|
| **Decisão** | O épico entra com `schemaVersion: 5` (a 4 já está ocupada pelo épico Plataforma — `meta.acl`, ADR-003, S29): coleções novas (`components`, `changeRequests`, `releases`, `attachments`) e kinds novos de catálogo (`MOTIVATOR`, `IMPACT_CATEGORY`), sem alterar a forma de nenhum campo existente. Migração 4→5 preenche as coleções com `[]`. |
| **Data / gatilho** | 2026-08-13, desenho do épico GOV; renumerado de 4 para 5 ao consolidar com o épico Plataforma, priorizado antes na ordem de execução (26–31). |
| **Alternativas** | Espalhar os campos por dentro de `Project`/`Matrix` sem subir o schema — esconderia uma mudança estrutural grande atrás de campos opcionais e quebraria a regra de que forma nova de documento = versão nova de schema. |
| **Por quê** | Mesmo padrão das migrações 2→3 (S23) e 3→4 (S29), que já provaram o caminho: aditiva, testada com documento real da versão anterior e com a cadeia completa desde v1. |
| **Custo aceito** | Documentos salvos por um `PolicyOps.html` novo não abrem em versões antigas do app — já é assim entre versões de schema anteriores; o aviso de versão existente cobre. |
| **Páginas afetadas** | `03-modelo-do-documento.md` §1, §10 (S32); `14-governanca-de-alteracoes.md` §3.5 |

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
