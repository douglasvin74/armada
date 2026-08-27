// =============================================================================
//  Testes do limitador de eventos por socket (protecao do event loop).
//
//  O tempo e injetado, entao o teste e deterministico e instantaneo - nada de
//  setTimeout esperando a janela virar.
// =============================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeLimiter, hit } from '../server/ratelimit.js';
import { CONFIG } from '../server/config.js';

describe('rate limit', () => {
  test('deixa passar ate o teto', () => {
    const lim = makeLimiter();
    for (let i = 0; i < 10; i++) {
      assert.equal(hit(lim, 'input', 10, 1000).allowed, true, `bloqueou no evento ${i + 1}`);
    }
  });

  test('bloqueia a partir do teto+1', () => {
    const lim = makeLimiter();
    for (let i = 0; i < 10; i++) hit(lim, 'input', 10, 1000);
    assert.equal(hit(lim, 'input', 10, 1000).allowed, false);
  });

  test('cada evento tem contador proprio', () => {
    const lim = makeLimiter();
    for (let i = 0; i < 10; i++) hit(lim, 'input', 10, 1000);
    // 'input' estourou, mas 'chat' ainda esta zerado
    assert.equal(hit(lim, 'chat', 4, 1000).allowed, true);
  });

  test('a janela de 1 s zera os contadores', () => {
    const lim = makeLimiter();
    for (let i = 0; i < 10; i++) hit(lim, 'input', 10, 1000);
    assert.equal(hit(lim, 'input', 10, 1500).allowed, false, 'zerou cedo demais');
    assert.equal(hit(lim, 'input', 10, 2000).allowed, true, 'nao zerou apos 1 s');
  });

  test('os strikes acumulam entre janelas', () => {
    // Um abusador nao escapa do kick so por esperar a janela virar.
    const lim = makeLimiter();
    let strikes = 0;
    for (let janela = 0; janela < 3; janela++) {
      const t = 1000 + janela * 1000;
      for (let i = 0; i < 12; i++) strikes = hit(lim, 'input', 10, t).strikes;
    }
    assert.ok(strikes >= 3, `strikes nao acumularam: ${strikes}`);
  });

  test('uso normal nunca acumula strike', () => {
    // O cliente envia input a INPUT_HZ; o teto tem folga sobre isso.
    const lim = makeLimiter();
    for (let s = 0; s < 60; s++) {
      const t = 1000 + s * 1000;
      for (let i = 0; i < CONFIG.INPUT_HZ; i++) {
        assert.equal(hit(lim, 'input', CONFIG.LIMITS.INPUT_RATE, t).allowed, true);
      }
    }
    assert.equal(lim.strikes, 0, 'jogador legitimo levou strike');
  });

  test('uma rajada de 10 mil eventos vira 1 strike, nao 10 mil', () => {
    const lim = makeLimiter();
    let ultimo;
    for (let i = 0; i < 10000; i++) ultimo = hit(lim, 'input', 45, 1000);
    assert.equal(ultimo.allowed, false);
    assert.ok(lim.counts.input === 10000);
    assert.ok(lim.strikes > 0);
  });

  test('o teto de input tem folga sobre INPUT_HZ', () => {
    // Se alguem baixar INPUT_RATE abaixo de INPUT_HZ, jogadores honestos
    // comecariam a ser desconectados. Este teste tranca essa relacao.
    assert.ok(CONFIG.LIMITS.INPUT_RATE > CONFIG.INPUT_HZ,
      'INPUT_RATE precisa ser maior que INPUT_HZ');
  });

  test('objeto sem prototipo: chave "__proto__" nao envenena o balde', () => {
    const lim = makeLimiter();
    assert.equal(hit(lim, '__proto__', 2, 1000).allowed, true);
    assert.equal(hit(lim, '__proto__', 2, 1000).allowed, true);
    assert.equal(hit(lim, '__proto__', 2, 1000).allowed, false);
  });
});
