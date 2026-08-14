# Sessão 37 — Release de política e timeline do Diário de Bordo

**Modelo:** `Sonnet` · **Depende de:** S36 · **Épico/Marco:** Governança (M12)

> **Por que Sonnet:** a publicação atômica (a parte perigosa) veio pronta da S36; release é CRUD +
> composição sobre ela, e a timeline é leitura. Contratos fechados em `docs/14` §3.4 e RN-GOV-05.

## Prompt

> Você está implementando a Sessão 37 do PolicyOps — releases de política e a visão cronológica
> do Diário de Bordo.
>
> **Leia antes de começar:** `docs/14-governanca-de-alteracoes.md` §3.4, §4 (US-GOV-05), §6
> (RN-GOV-05), §10 (CT-GOV-03); DEC-GOV-008.
>
> ### Estado atual
> S36 entregou `changeRequest/publish` atômico e o vínculo item↔rascunho. `Release` existe no
> schema (S32) sem tela. A timeline de matriz (S15) é o padrão visual de referência.
>
> ### Objetivo
> DBs aprovados agrupam-se numa release datada, publicam juntos, e a evolução da política vira uma
> linha do tempo legível.
>
> ### Escopo
> 1. **CRUD de release** e vínculo DB↔release (só DBs ≥ APPROVED entram; sair de uma release é
>    permitido até a publicação). Status conjunto derivado dos DBs.
> 2. **Publicar release**: compõe `changeRequest/publish` para todos os DBs prontos, numa operação
>    atômica sobre o documento inteiro (CT-GOV-03); cada DB mantém sua própria vigência.
> 3. **Timeline do Diário de Bordo** (US-GOV-08 parcial): DBs publicados em ordem de vigência, com
>    componentes afetados e link para o DB e a release; filtro por período/projeto.
> 4. **Tela da release**: conteúdo ("o que entrou na subida"), status por DB, data planejada ×
>    publicada.
>
> ### Testes
> CT-GOV-03 exato (falha lista pendência, nada publica). Publicação de release com 2 DBs de
> vigências distintas → cada versão com a sua. Unit da derivação de status conjunto. E2E: release
> com os DBs do épico publicada e visível na timeline.
>
> ### Critérios de aceite
> - "Release 2026.09.01 — DB-515, DB-519" criável, publicável e legível na timeline como no §25 da
>   especificação de origem.
> - `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` verdes; 1,5 MB ok;
>   `dist/PolicyOps.html` no commit.
>
> ### Fora do escopo
> Comparação release × release (S39), pacote (S38), notificações além do painel de pendências.
>
> ### Atualização da documentação (obrigatório)
> No mesmo PR: `docs/14-governanca-de-alteracoes.md` (US-GOV-05 ✅), `docs/07-ux-e-editor.md`
> (release e timeline), `docs/13-decisoes.md`, linha da S37 em `docs/09`.
>
> ### Regras transversais
> As 8 regras de `docs/prompts/README.md`. Decisão de arquitetura não coberta → pare e pergunte.
>
> ### Encerramento
> Commit descritivo na branch de trabalho e push, com `dist/PolicyOps.html` atualizado.
