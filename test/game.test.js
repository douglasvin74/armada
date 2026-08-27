// =============================================================================
//  Testes de game.js - as regras que o servidor impoe.
//
//  Foco no que um cliente modificado tentaria burlar: cadencia de tiro,
//  pontuacao, limites de input e formato do snapshot.
// =============================================================================

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Game, TEAM_COLORS } from '../server/game.js';
import { CONFIG } from '../server/config.js';

let game;
beforeEach(() => { game = new Game(); });

describe('gestao de jogadores', () => {
  test('addPlayer cria um jogador vivo com vida cheia', () => {
    const p = game.addPlayer('s1', 'Ahab', 0);
    assert.equal(p.name, 'Ahab');
    assert.equal(p.hp, CONFIG.SHIP.MAX_HP);
    assert.equal(p.alive, true);
    assert.equal(p.score, 0);
    assert.equal(game.players.size, 1);
  });

  test('nasce dentro da arena', () => {
    for (let i = 0; i < 20; i++) {
      const p = game.addPlayer('s' + i, 'P' + i, -1);
      const d = Math.hypot(p.x, p.z);
      assert.ok(d <= CONFIG.MAP.ARENA_RADIUS, `nasceu fora: ${d.toFixed(1)}`);
    }
  });

  test('cada jogador recebe uma cor unica', () => {
    const cores = new Set();
    for (let i = 0; i < TEAM_COLORS.length; i++) {
      cores.add(game.addPlayer('s' + i, 'P' + i, 0).color);
    }
    assert.equal(cores.size, TEAM_COLORS.length, 'houve cor repetida');
  });

  test('a cor preferida e respeitada quando esta livre', () => {
    assert.equal(game.addPlayer('s1', 'A', 3).color, 3);
  });

  test('cor preferida invalida nao quebra nada', () => {
    for (const ruim of [-5, 999, 1.5, 'azul', null, undefined, {}]) {
      const g = new Game();
      const p = g.addPlayer('x', 'P', ruim);
      assert.ok(Number.isInteger(p.color));
      assert.ok(p.color >= 0 && p.color < TEAM_COLORS.length);
    }
  });

  test('removePlayer tira do mapa', () => {
    game.addPlayer('s1', 'A', 0);
    game.removePlayer('s1');
    assert.equal(game.players.size, 0);
  });
});

describe('setInput (fronteira de confianca)', () => {
  test('fixa acelerador e leme entre -1 e 1', () => {
    const p = game.addPlayer('s1', 'A', 0);
    game.setInput('s1', { th: 500, ru: -500 });
    assert.equal(p.input.throttle, 1);
    assert.equal(p.input.rudder, -1);
  });

  test('fixa a elevacao do canhao nos limites de config', () => {
    const p = game.addPlayer('s1', 'A', 0);
    game.setInput('s1', { ap: 99 });
    assert.equal(p.aimPitch, CONFIG.SHELL.MAX_PITCH);
    game.setInput('s1', { ap: -99 });
    assert.equal(p.aimPitch, CONFIG.SHELL.MIN_PITCH);
  });

  test('payload lixo nao gera NaN no estado', () => {
    const p = game.addPlayer('s1', 'A', 0);
    for (const ruim of [null, undefined, 42, 'abc', [], { th: 'x', ru: {}, ap: NaN }]) {
      game.setInput('s1', ruim);
    }
    for (const k of ['throttle', 'rudder']) {
      assert.ok(Number.isFinite(p.input[k]), `${k} virou ${p.input[k]}`);
    }
    assert.ok(Number.isFinite(p.aimPitch));
    assert.ok(Number.isFinite(p.turretYaw));
  });

  test('input de socket desconhecido e ignorado', () => {
    game.setInput('fantasma', { th: 1 });   // nao pode lancar
    assert.equal(game.players.size, 0);
  });
});

describe('requestFire (cadencia validada no servidor)', () => {
  test('o primeiro tiro sai', () => {
    game.addPlayer('s1', 'A', 0);
    game.requestFire('s1', 'main');
    assert.equal(game.shells.length, 1);
  });

  test('metralhar nao funciona: o cooldown segura', () => {
    // Cenario de trapaca: cliente emite 100 pedidos de tiro seguidos.
    game.addPlayer('s1', 'A', 0);
    for (let i = 0; i < 100; i++) game.requestFire('s1', 'main');
    assert.equal(game.shells.length, 1, 'cooldown do canhao foi burlado');
  });

  test('depois do cooldown o proximo tiro sai', () => {
    game.addPlayer('s1', 'A', 0);
    game.requestFire('s1', 'main');
    game.clock += CONFIG.SHELL.MAIN_COOLDOWN + 0.01;
    game.requestFire('s1', 'main');
    assert.equal(game.shells.length, 2);
  });

  test('a salva lateral gera BROADSIDE_COUNT granadas', () => {
    game.addPlayer('s1', 'A', 0);
    game.requestFire('s1', 'broadside');
    assert.equal(game.shells.length, CONFIG.SHELL.BROADSIDE_COUNT);
  });

  test('navio afundado nao atira', () => {
    const p = game.addPlayer('s1', 'A', 0);
    p.alive = false;
    game.requestFire('s1', 'main');
    assert.equal(game.shells.length, 0);
  });

  test('nao se atira no intervalo entre partidas', () => {
    game.addPlayer('s1', 'A', 0);
    game.endMatch();
    game.requestFire('s1', 'main');
    assert.equal(game.shells.length, 0);
  });
});

describe('dano e pontuacao', () => {
  test('acerto soma SCORE.HIT ao atacante', () => {
    const a = game.addPlayer('a', 'A', 0);
    const v = game.addPlayer('v', 'V', 1);
    game.applyDamage(v, 10, 'a');
    assert.equal(a.score, CONFIG.SCORE.HIT);
    assert.equal(v.hp, CONFIG.SHIP.MAX_HP - 10);
  });

  test('afundar soma HIT + KILL e conta a morte da vitima', () => {
    const a = game.addPlayer('a', 'A', 0);
    const v = game.addPlayer('v', 'V', 1);
    game.applyDamage(v, CONFIG.SHIP.MAX_HP, 'a');
    assert.equal(v.alive, false);
    assert.equal(v.hp, 0);
    assert.equal(v.deaths, 1);
    assert.equal(a.kills, 1);
    assert.equal(a.score, CONFIG.SCORE.HIT + CONFIG.SCORE.KILL);
  });

  test('o placar nunca fica negativo', () => {
    const v = game.addPlayer('v', 'V', 0);
    game.applyDamage(v, 999, null);          // morte sem atacante
    assert.ok(v.score >= 0, `placar negativo: ${v.score}`);
  });

  test('dano em quem ja afundou nao pontua de novo', () => {
    const a = game.addPlayer('a', 'A', 0);
    const v = game.addPlayer('v', 'V', 1);
    game.applyDamage(v, 999, 'a');
    const placar = a.score, mortes = v.deaths;
    game.applyDamage(v, 999, 'a');
    assert.equal(a.score, placar, 'pontuou duas vezes pela mesma morte');
    assert.equal(v.deaths, mortes);
  });

  test('dano em si mesmo nao rende pontos nem kill', () => {
    const p = game.addPlayer('p', 'P', 0);
    game.applyDamage(p, 999, 'p');
    assert.equal(p.kills, 0);
    assert.ok(p.score >= 0);
  });

  test('a morte gera um evento de kill no fx', () => {
    const v = game.addPlayer('v', 'V', 0);
    game.addPlayer('a', 'A', 1);
    game.applyDamage(v, 999, 'a');
    assert.ok(game.fx.some((f) => f.t === 'kill'), 'nenhum evento kill emitido');
  });
});

describe('ciclo da partida', () => {
  test('comeca jogando com a duracao cheia', () => {
    assert.equal(game.state, 'playing');
    assert.equal(game.timeLeft, CONFIG.MATCH.DURATION);
  });

  test('o tempo acabando encerra a partida', () => {
    game.timeLeft = 0.01;
    game.update(0.1);
    assert.equal(game.state, 'ended');
    assert.equal(game.shells.length, 0, 'granadas sobreviveram ao fim');
  });

  test('o intervalo acabando reinicia com placar zerado', () => {
    const p = game.addPlayer('s1', 'A', 0);
    p.score = 500; p.kills = 9; p.hp = 3; p.alive = false;
    game.endMatch();
    game.timeLeft = 0.01;
    game.update(0.1);
    assert.equal(game.state, 'playing');
    assert.equal(game.matchNumber, 2);
    assert.equal(p.score, 0);
    assert.equal(p.kills, 0);
    assert.equal(p.hp, CONFIG.SHIP.MAX_HP);
    assert.equal(p.alive, true);
  });

  test('o ranking ordena por pontos', () => {
    game.addPlayer('a', 'A', 0).score = 10;
    game.addPlayer('b', 'B', 1).score = 90;
    game.addPlayer('c', 'C', 2).score = 50;
    assert.deepEqual(game.ranking().map((r) => r.name), ['B', 'C', 'A']);
  });
});

describe('respawn', () => {
  test('volta ao mar com vida cheia depois do tempo', () => {
    const p = game.addPlayer('s1', 'A', 0);
    game.applyDamage(p, 999, null);
    assert.equal(p.alive, false);

    game.clock = p.respawnAt - 0.1;
    game.updateRespawns();
    assert.equal(p.alive, false, 'renasceu cedo demais');

    game.clock = p.respawnAt + 0.1;
    game.updateRespawns();
    assert.equal(p.alive, true);
    assert.equal(p.hp, CONFIG.SHIP.MAX_HP);
    assert.equal(p.stamina, CONFIG.SHIP.STAMINA_MAX);
  });
});

describe('snapshot', () => {
  test('tem as chaves que o cliente consome', () => {
    game.addPlayer('s1', 'A', 0);
    const s = game.snapshot();
    for (const k of ['ts', 'ck', 'st', 'tl', 'mn', 'p', 's', 'fx']) {
      assert.ok(k in s, `falta a chave '${k}'`);
    }
    for (const k of ['i', 'n', 'c', 'x', 'z', 'y', 'h', 'a', 'sc']) {
      assert.ok(k in s.p[0], `falta a chave de jogador '${k}'`);
    }
  });

  test('esvazia a fila de fx (eventos nao se repetem)', () => {
    const v = game.addPlayer('v', 'V', 0);
    game.applyDamage(v, 999, null);
    assert.ok(game.snapshot().fx.length > 0);
    assert.equal(game.snapshot().fx.length, 0, 'fx foi enviado duas vezes');
  });

  test('e serializavel em JSON', () => {
    game.addPlayer('s1', 'A', 0);
    game.requestFire('s1', 'main');
    assert.doesNotThrow(() => JSON.stringify(game.snapshot()));
  });

  test('a fila de fx tem teto (nao cresce sem limite)', () => {
    for (let i = 0; i < 500; i++) game.fx.push({ t: 'boom', x: 0, y: 0, z: 0 });
    game.update(1 / 30);
    assert.ok(game.fx.length <= 60, `fx sem teto: ${game.fx.length}`);
  });
});

describe('simulacao completa', () => {
  test('300 ticks com 8 jogadores atirando nao produzem NaN', () => {
    for (let i = 0; i < CONFIG.MAX_PLAYERS; i++) {
      game.addPlayer('s' + i, 'P' + i, i);
      game.setInput('s' + i, { th: 1, ru: i % 2 ? 1 : -1, bo: true, ay: i, ap: 0.3 });
    }
    for (let t = 0; t < 300; t++) {
      for (let i = 0; i < CONFIG.MAX_PLAYERS; i++) game.requestFire('s' + i, 'main');
      game.update(1 / 30);
    }
    for (const p of game.players.values()) {
      for (const k of ['x', 'z', 'yaw', 'speed', 'hp', 'stamina', 'score']) {
        assert.ok(Number.isFinite(p[k]), `${p.name}.${k} virou ${p[k]}`);
      }
      assert.ok(p.hp >= 0 && p.hp <= CONFIG.SHIP.MAX_HP, `vida fora da faixa: ${p.hp}`);
      assert.ok(p.score >= 0, `placar negativo: ${p.score}`);
    }
  });

  test('granadas nao vazam: a lista nao cresce indefinidamente', () => {
    game.addPlayer('s1', 'A', 0);
    for (let t = 0; t < 600; t++) {
      game.requestFire('s1', 'main');
      game.update(1 / 30);
    }
    assert.ok(game.shells.length < 40, `vazamento de granadas: ${game.shells.length}`);
  });
});
