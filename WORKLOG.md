# WORKLOG

Horários em UTC. Entradas marcadas (AI) foram feitas pelo Claude; as demais, por Antonio.

- 2026-11-12 ~11:22 UTC (AI, horário aproximado) — Leitura do enunciado. Replay feito em script descartável (fora do repo) para fixar os números antes de desenhar: fechamentos por value_date, 3 tarifas causadas por E7 (Dias 2, 4, 5), Auth-B recusada, juros 0,79 (arredondamento ingênuo) vs 0,80 (resíduo carregado).
- 2026-11-12 ~11:25 UTC (AI, horário aproximado) — Primeira leitura dos critérios: 1, 3, 5 corretos; 2, 4, 6, 7, 8 a recusar. Critério 4 marcado como o julgamento de maior risco.
- 2026-11-12 11:30 UTC — Decisões de Antonio: TypeScript; tarifas estornadas automaticamente após E9 (lançamentos compensatórios); Antonio escreve o núcleo, Claude guia e mantém este log. Decisão sobre E6 (Auth-Z) ainda em aberto.
- 2026-11-12 11:30 UTC (AI) — Scaffold: package.json (Node >= 22.18 roda .ts direto, sem build e sem dependências em runtime), tsconfig, .gitignore.
- 2026-11-12 11:37 UTC — Decisão de Antonio sobre E6: opção A (lançar o débito e registrar exceção; critério 4 recusado). Método combinado: Claude escreve os testes de cada passo, Antonio implementa. Node local de Antonio: v25.2.1.
- 2026-11-12 11:37 UTC (AI) — Passo 1: testes de dinheiro (test/money.test.ts) escritos antes da implementação. Decisões embutidas: bigint em unidade mínima, entrada com precisão excedente é recusada, resto do parcelamento vai para as últimas parcelas, arredondamento half-even.
