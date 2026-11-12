// Passo 1 — dinheiro.
// Regra do enunciado: AED tem 2 casas, BHD tem 3; valores guardados e
// arredondados na precisão da própria moeda.
// Decisão: todo valor é um bigint na unidade mínima (fils). Nunca number:
// 0.1 + 0.2 !== 0.3 em ponto flutuante, e um ledger não pode perder 1 fil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatAmount, splitEqually, roundHalfEven } from '../src/money.ts';

test('parseAmount converte texto para unidade mínima da moeda', () => {
  assert.equal(parseAmount('AED', '1,200.00'), 120000n);
  assert.equal(parseAmount('AED', '950.00'), 95000n);
  assert.equal(parseAmount('AED', '25'), 2500n);
  assert.equal(parseAmount('AED', '0.5'), 50n);
  assert.equal(parseAmount('BHD', '10.000'), 10000n);
});

test('parseAmount recusa precisão maior que a da moeda em vez de arredondar calado', () => {
  // Arredondar a entrada esconderia erro de quem enviou o evento.
  assert.throws(() => parseAmount('AED', '1.005'));
  assert.throws(() => parseAmount('BHD', '1.0005'));
});

test('parseAmount recusa lixo e sinal negativo (a direção vem do tipo do evento)', () => {
  assert.throws(() => parseAmount('AED', ''));
  assert.throws(() => parseAmount('AED', 'abc'));
  assert.throws(() => parseAmount('AED', '-1.00'));
});

test('formatAmount imprime na precisão da moeda, com sinal, sem separador de milhar', () => {
  assert.equal(formatAmount('AED', 120000n), '1200.00');
  assert.equal(formatAmount('AED', -37000n), '-370.00');
  assert.equal(formatAmount('AED', -5n), '-0.05');
  assert.equal(formatAmount('AED', 0n), '0.00');
  assert.equal(formatAmount('BHD', 4n), '0.004');
  assert.equal(formatAmount('BHD', 10008n), '10.008');
});

test('splitEqually: E10 — BHD 10.000 em 3 parcelas soma exatamente 10.000', () => {
  // Critério 7 (recusado) pede 3 x 3.334 = 10.002: cria 2 fils do nada.
  // Convenção escolhida: o resto vai para as ÚLTIMAS parcelas.
  const parts = splitEqually(10000n, 3);
  assert.deepEqual(parts, [3333n, 3333n, 3334n]);
  assert.equal(parts.reduce((a, b) => a + b, 0n), 10000n);
});

test('splitEqually: resto maior que 1 é espalhado, uma unidade por parcela', () => {
  assert.deepEqual(splitEqually(10001n, 3), [3333n, 3334n, 3334n]);
  assert.deepEqual(splitEqually(9n, 3), [3n, 3n, 3n]);
  assert.deepEqual(splitEqually(2n, 3), [0n, 1n, 1n]);
});

test('splitEqually recusa entradas sem sentido', () => {
  assert.throws(() => splitEqually(10000n, 0));
  assert.throws(() => splitEqually(10000n, 1.5));
  assert.throws(() => splitEqually(-1n, 3));
});

test('roundHalfEven arredonda uma fração (numerador/denominador) para inteiro', () => {
  // Uso real: juros do dia = saldo em fils x 4 / 10000 (0,04%).
  // 285.00 AED -> 28500 x 4 = 114000 / 10000 = 11,4 fils -> 11.
  assert.equal(roundHalfEven(114000n, 10000n), 11n);
  assert.equal(roundHalfEven(26n, 10n), 3n);
  assert.equal(roundHalfEven(0n, 7n), 0n);
});

test('roundHalfEven: empate vai para o par mais próximo', () => {
  assert.equal(roundHalfEven(5n, 10n), 0n); // 0,5 -> 0
  assert.equal(roundHalfEven(15n, 10n), 2n); // 1,5 -> 2
  assert.equal(roundHalfEven(25n, 10n), 2n); // 2,5 -> 2
  assert.equal(roundHalfEven(35n, 10n), 4n); // 3,5 -> 4
});

test('roundHalfEven recusa numerador negativo e denominador não positivo', () => {
  // Juros só existem sobre saldo positivo, então negativo aqui é bug de quem chamou.
  assert.throws(() => roundHalfEven(-1n, 10n));
  assert.throws(() => roundHalfEven(1n, 0n));
});
