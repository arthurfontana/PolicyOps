# Operação

> Para quem cuida da pasta compartilhada e responde quando algo dá errado — TI, dono do processo, ou quem o time apontar. Complementa o [Guia do Usuário](10-guia-do-usuario.md), que é sobre usar a ferramenta, não sobre mantê-la.

## 1. Onde colocar os arquivos

```
\\SharePoint\Politicas\
   ├── PolicyOps.html          ← a aplicação, publicada uma vez
   ├── politicas.json          ← todos os dados
   └── _backups\
        ├── politicas.2026-08-05T14-32.json
        └── ...
```

- **`PolicyOps.html`** é a aplicação inteira. Não muda sozinha — só quando o time de desenvolvimento publica uma versão nova (§4).
- **`politicas.json`** é onde vive tudo: bibliotecas, matrizes, versões, histórico. É o único arquivo que muda no dia a dia, e é ele que precisa de backup de verdade.
- **`_backups\`** é gerada automaticamente pela própria aplicação a cada salvamento (mantém as 20 cópias mais recentes) — é um cinto de segurança além do controle de versão do SharePoint, não o backup principal.

Os dois arquivos (`.html` e `.json`) devem estar na **mesma biblioteca de documentos**, para que o time abra o `.html` pelo endereço do SharePoint (não por duplo clique) — é isso que garante o modo completo, com salvamento direto e detecção de conflito. Duplo clique local funciona, mas cai num modo mais limitado (o Guia do Usuário explica a diferença).

## 2. Como fazer backup

Três camadas, cada uma cobrindo um risco diferente:

1. **Histórico de versões do SharePoint** (automático, já vem com a plataforma) — é o backup principal. Cobre "alguém salvou algo errado" e "preciso do arquivo de terça-feira passada". Ative o histórico de versões na biblioteca de documentos, se ainda não estiver ativo.
2. **`_backups\` local**, gerada pela própria aplicação antes de cada salvamento — cobre o caso de o histórico do SharePoint estar temporariamente indisponível ou mal configurado. Não precisa de ação manual; só verifique de vez em quando que a pasta está sendo escrita.
3. **Cópia externa periódica** (recomendado, mensal ou antes de mudanças grandes) — baixe `politicas.json` para um local fora do SharePoint (outro storage, e-mail para o responsável, o que fizer sentido na sua organização). Cobre o cenário raro de perda da biblioteca inteira.

Não é preciso fazer backup do `PolicyOps.html` com a mesma frequência — ele só muda quando uma nova versão é publicada pelo time de desenvolvimento (§4), e o próprio repositório de código guarda todo esse histórico.

## 3. O que fazer em caso de conflito

Um conflito acontece quando duas pessoas têm o arquivo aberto ao mesmo tempo e as duas tentam salvar. A aplicação **nunca sobrescreve silenciosamente** — quem salva por último vê um aviso com três opções:

| Opção | Quando usar |
|---|---|
| **Ver o que mudou** | Para entender a diferença antes de decidir — mostra o mesmo comparador visual usado para comparar versões de matriz. |
| **Mesclar** | O caminho recomendado na maioria dos casos: a aplicação junta automaticamente tudo que não colide (versões publicadas de matrizes diferentes, itens novos de biblioteca, etc.) e só pergunta nos pontos que realmente colidiram. Nada é gravado sem revisão. |
| **Salvar como cópia** | Quando não dá para decidir na hora — grava um arquivo `…-conflito-{nome}-{hora}.json` ao lado, sem tocar no original, para revisar com calma depois. |

Se conflitos estiverem acontecendo com frequência, o problema não é técnico — é de combinação de horário entre o time. Duas saídas práticas:

- Combine quem edita quando (o **bloqueio consultivo** da aplicação já avisa "Fulano está editando este arquivo desde 09:00", mas não impede a edição — é um aviso, não uma trava).
- Salve com mais frequência: `Ctrl+S` custa pouco e reduz a janela de tempo em que um conflito pode acontecer.

## 4. Como atualizar o `PolicyOps.html` sem perder dados

A separação entre aplicação (`.html`) e dados (`.json`) existe exatamente para isto: atualizar a aplicação **nunca** toca nos dados.

1. Baixe a versão nova de `PolicyOps.html` (do repositório do projeto — "Download raw file" no GitHub, ou peça ao time de desenvolvimento).
2. Substitua o arquivo antigo na mesma pasta do SharePoint, com o mesmo nome. Não precisa (e não deve) tocar em `politicas.json` nem em `_backups\`.
3. Avise o time para recarregar a página da próxima vez que abrirem — abas já abertas continuam rodando a versão antiga até serem recarregadas.
4. Se a aplicação nova usa uma versão mais nova do formato de dados (`schemaVersion`), ela migra o arquivo automaticamente na primeira abertura, de forma compatível com versões anteriores — nenhuma ação manual é necessária. O caminho inverso (abrir um arquivo novo numa aplicação antiga) é bloqueado com uma mensagem clara, para não arriscar interpretar dados novos com regras velhas.

Nunca é preciso recriar bibliotecas, matrizes ou histórico por causa de uma atualização da aplicação.

## 5. Quando alguém pedir uma alteração retroativa

Isso vai acontecer: alguém vai pedir para "corrigir" a política que valeu em março, porque um erro foi descoberto depois. A resposta é sempre a mesma, e vale alinhar com o time de política antes que o pedido apareça:

> **Não se altera o passado. Cria-se uma versão nova.**

O motivo não é burocracia — é que o **motor de crédito já decidiu com base na política de março**. Reescrever a v12 mudaria silenciosamente o que uma auditoria veria ao consultar aquele período, e divergiria do que o motor realmente aplicou. Isso é exatamente o problema que esta ferramenta existe para evitar.

O caminho correto:

1. Abra a matriz, crie um rascunho a partir da versão vigente.
2. Corrija o que precisa ser corrigido.
3. Publique como uma versão nova, com uma nota explicando o motivo — inclusive que se trata de uma correção de algo identificado em março.
4. Se a correção precisa valer **a partir de uma data específica no passado próximo** (por exemplo, hoje é dia 10 e a correção deveria valer desde o dia 5), a publicação aceita uma data de vigência — mas isso não é o mesmo que reescrever o histórico: a versão antiga continua existindo e continua sendo o que estava vigente até aquele ponto; só a partir da nova data de vigência é que a versão corrigida passa a valer. A janela entre o erro e a correção fica registrada, não apagada.

Se a pergunta for "mas e o que já foi decidido com a política errada entre março e agora?" — essa é uma questão de negócio (reprocessar decisões, compensar clientes, etc.), não algo que a ferramenta resolve sozinha. O histórico completo e imutável é exatamente o que permite ao time de política responder essa pergunta com precisão, em vez de adivinhar.
