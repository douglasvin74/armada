// =============================================================================
//  Testes de shared.js - o modulo que roda IDENTICO no servidor e no cliente.
//
//  Qualquer divergencia aqui quebra a predicao local: o navio do jogador
//  passaria a andar diferente da verdade do servidor. Por isso este arquivo
//  trava tambem o DETERMINISMO, nao so o comportamento.
// =============================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp, num, mulberry32, wrapAngle, lerpAngle,
  generateIslands, waveHeight, stepShip,
  sanitizeName, sanitizeChat,
} from '../server/shared.js';
import { CONFIG } from '../server/config.js';

describe('clamp', () => {
  test('fixa dentro da faixa', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-3, 0, 10), 0);
    assert.equal(clamp(99, 0, 10), 10);
  });

  test('respeita os limites exatos', () => {
    assert.equal(clamp(0, 0, 10), 0);
    assert.equal(clamp(10, 0, 10), 10);
  });
});

describe('num', () => {
  test('converte numeros validos', () => {
    assert.equal(num(4.5), 4.5);
    assert.equal(num(0), 0);
  });

  test('usa o fallback para o que nao e numero', () => {
    // Primeira linha de defesa contra payload malicioso: tudo que vem do
    // socket passa por num() antes de virar estado do jogo.
    assert.equal(num(undefined, 7), 7);
    assert.equal(num('abc', 7), 7);
    assert.equal(num(NaN, 7), 7);
    assert.equal(num(Infinity, 7), 7);
    assert.equal(num(-Infinity, 7), 7);
    assert.equal(num({}, 7), 7);
  });

  test('null e array vazio viram 0, nao o fallback', () => {
    // Comportamento intencional: Number(null) e Number([]) sao 0, um valor
    // neutro e seguro para acelerador/leme. Documentado aqui para que uma
    // mudanca futura em num() apareca como falha.
    assert.equal(num(null, 7), 0);
    assert.equal(num([], 7), 0);
  });
});

describe('wrapAngle', () => {
  test('mantem o resultado entre -PI e PI', () => {
    for (const a of [0, 3, -3, 7, -7, 100, -100]) {
      const w = wrapAngle(a);
      assert.ok(w >= -Math.PI - 1e-9 && w <= Math.PI + 1e-9, `fora da faixa: ${w}`);
    }
  });

  test('preserva angulos ja normalizados', () => {
    assert.ok(Math.abs(wrapAngle(1.2) - 1.2) < 1e-9);
  });
});

describe('lerpAngle', () => {
  test('t=0 e t=1 devolvem os extremos', () => {
    assert.ok(Math.abs(lerpAngle(0.5, 2.0, 0) - 0.5) < 1e-9);
    assert.ok(Math.abs(wrapAngle(lerpAngle(0.5, 2.0, 1) - 2.0)) < 1e-9);
  });

  test('cruza a descontinuidade pelo caminho curto', () => {
    // De +170 para -170 graus: o caminho curto passa por 180, nao por 0.
    const mid = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 0.05, `passou pelo lado longo: ${mid}`);
  });
});

describe('mulberry32', () => {
  test('mesma seed produz a mesma sequencia', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 50; i++) assert.equal(a(), b());
  });

  test('seeds diferentes divergem', () => {
    assert.notEqual(mulberry32(1)(), mulberry32(2)());
  });

  test('resultado sempre entre 0 e 1', () => {
    const r = mulberry32(999);
    for (let i = 0; i < 200; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1, `fora de [0,1): ${v}`);
    }
  });
});

describe('generateIslands', () => {
  const islands = generateIslands();

  test('e deterministico entre chamadas', () => {
    // Se isto quebrar, cada cliente veria um mapa diferente do servidor e os
    // navios colidiriam com ilhas invisiveis.
    assert.deepEqual(generateIslands(), islands);
  });

  test('respeita a contagem configurada', () => {
    assert.equal(islands.length, CONFIG.MAP.ISLAND_COUNT);
  });

  test('nenhum centro de ilha cai dentro do keepout', () => {
    // ISLAND_KEEPOUT e medido do centro da arena ao CENTRO da ilha.
    for (const i of islands) {
      const d = Math.hypot(i.x, i.z);
      assert.ok(d >= CONFIG.MAP.ISLAND_KEEPOUT - 1e-6,
        `ilha dentro do keepout: dist=${d.toFixed(1)}`);
    }
  });

  test('todas as ilhas cabem dentro da arena', () => {
    for (const i of islands) {
      const d = Math.hypot(i.x, i.z);
      assert.ok(d + i.r <= CONFIG.MAP.ARENA_RADIUS,
        `ilha vazando a arena: dist=${d.toFixed(1)} r=${i.r.toFixed(1)}`);
    }
  });

  test('ilhas nao se sobrepoem (canais navegaveis)', () => {
    for (let i = 0; i < islands.length; i++) {
      for (let j = i + 1; j < islands.length; j++) {
        const a = islands[i], b = islands[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        assert.ok(d >= a.r + b.r + CONFIG.MAP.ISLAND_GAP,
          `canal estreito demais entre as ilhas ${i} e ${j}`);
      }
    }
  });

  test('raio e altura dentro dos limites de config', () => {
    for (const i of islands) {
      assert.ok(i.r >= CONFIG.MAP.ISLAND_MIN_R && i.r <= CONFIG.MAP.ISLAND_MAX_R);
      assert.ok(i.h >= CONFIG.MAP.ISLAND_MIN_H && i.h <= CONFIG.MAP.ISLAND_MAX_H);
    }
  });
});

describe('waveHeight', () => {
  test('e deterministico para a mesma entrada', () => {
    assert.equal(waveHeight(10, 20, 3.5), waveHeight(10, 20, 3.5));
  });

  test('fica em amplitude razoavel', () => {
    for (let t = 0; t < 20; t += 0.7) {
      for (let x = -200; x <= 200; x += 50) {
        const h = waveHeight(x, x * 0.5, t);
        assert.ok(Number.isFinite(h) && Math.abs(h) < 6, `onda absurda: ${h}`);
      }
    }
  });
});

// -----------------------------------------------------------------------------
//  stepShip: o coracao da simulacao. Roda no servidor (verdade) e no cliente
//  (predicao). Estes testes travam o contrato entre os dois.
// -----------------------------------------------------------------------------

function novoNavio(over = {}) {
  return {
    x: 0, z: 0, yaw: 0, speed: 0, rudder: 0,
    stamina: CONFIG.SHIP.STAMINA_MAX,
    grounded: false, boosting: false,
    ...over,
  };
}
const PARADO = { throttle: 0, rudder: 0, boost: false };
const FRENTE = { throttle: 1, rudder: 0, boost: false };

describe('stepShip', () => {
  test('e deterministico: mesma entrada, mesma saida', () => {
    // A garantia que sustenta toda a predicao local do cliente.
    const a = novoNavio(), b = novoNavio();
    for (let i = 0; i < 120; i++) {
      stepShip(a, FRENTE, 1 / 30, []);
      stepShip(b, FRENTE, 1 / 30, []);
    }
    assert.deepEqual(a, b);
  });

  test('acelera para a frente sem passar de MAX_SPEED', () => {
    const s = novoNavio();
    for (let i = 0; i < 600; i++) stepShip(s, FRENTE, 1 / 30, []);
    assert.ok(s.speed > 0, 'nao acelerou');
    assert.ok(s.speed <= CONFIG.SHIP.MAX_SPEED + 1e-6, `estourou o teto: ${s.speed}`);
  });

  test('a re e limitada por MAX_REVERSE', () => {
    const s = novoNavio();
    const re = { throttle: -1, rudder: 0, boost: false };
    for (let i = 0; i < 600; i++) stepShip(s, re, 1 / 30, []);
    assert.ok(s.speed < 0, 'nao deu re');
    assert.ok(Math.abs(s.speed) <= CONFIG.SHIP.MAX_REVERSE + 1e-6, `re rapida demais: ${s.speed}`);
  });

  test('input fora da faixa nao burla o limite de velocidade', () => {
    // Cenario de trapaca: cliente modificado manda throttle = 999.
    const s = novoNavio();
    const batota = { throttle: 999, rudder: 0, boost: true };
    for (let i = 0; i < 600; i++) stepShip(s, batota, 1 / 30, []);
    const teto = CONFIG.SHIP.MAX_SPEED * CONFIG.SHIP.BOOST_MULT;
    assert.ok(s.speed <= teto + 1e-6, `velocidade impossivel: ${s.speed}`);
  });

  test('a turbina consome estamina e ela se recupera parada', () => {
    const s = novoNavio();
    const turbo = { throttle: 1, rudder: 0, boost: true };
    for (let i = 0; i < 60; i++) stepShip(s, turbo, 1 / 30, []);
    const gasta = s.stamina;
    assert.ok(gasta < CONFIG.SHIP.STAMINA_MAX, 'turbina nao consumiu estamina');

    for (let i = 0; i < 120; i++) stepShip(s, PARADO, 1 / 30, []);
    assert.ok(s.stamina > gasta, 'estamina nao se recuperou');
    assert.ok(s.stamina <= CONFIG.SHIP.STAMINA_MAX + 1e-6, 'estamina estourou o teto');
  });

  test('o leme so gira o navio quando ha velocidade', () => {
    const parado = novoNavio();
    for (let i = 0; i < 60; i++) {
      stepShip(parado, { throttle: 0, rudder: 1, boost: false }, 1 / 30, []);
    }
    assert.ok(Math.abs(parado.yaw) < 0.05, `girou parado: ${parado.yaw}`);

    const andando = novoNavio({ speed: CONFIG.SHIP.MAX_SPEED });
    for (let i = 0; i < 60; i++) {
      stepShip(andando, { throttle: 1, rudder: 1, boost: false }, 1 / 30, []);
    }
    assert.ok(Math.abs(andando.yaw) > 0.1, 'nao girou em movimento');
  });

  test('nao ultrapassa a borda da arena', () => {
    const s = novoNavio();
    for (let i = 0; i < 3000; i++) stepShip(s, FRENTE, 1 / 30, []);
    const d = Math.hypot(s.x, s.z);
    assert.ok(d <= CONFIG.MAP.ARENA_RADIUS + 30, `fugiu da arena: ${d.toFixed(1)}`);
  });

  test('encalhar numa ilha marca grounded e nao atravessa', () => {
    const ilha = { x: 0, z: 60, r: 20, h: 20 };
    const s = novoNavio({ speed: CONFIG.SHIP.MAX_SPEED });
    let encalhou = false;
    for (let i = 0; i < 300; i++) {
      stepShip(s, FRENTE, 1 / 30, [ilha]);
      if (s.grounded) { encalhou = true; break; }
    }
    assert.ok(encalhou, 'atravessou a ilha sem encalhar');
    const dist = Math.hypot(s.x - ilha.x, s.z - ilha.z);
    assert.ok(dist >= ilha.r - 1e-6, 'navio entrou dentro da ilha');
  });

  test('sobrevive a dt zero e a dt grande sem gerar NaN', () => {
    const s = novoNavio({ speed: 10 });
    stepShip(s, FRENTE, 0, []);
    stepShip(s, FRENTE, 0.1, []);
    for (const k of ['x', 'z', 'yaw', 'speed', 'rudder', 'stamina']) {
      assert.ok(Number.isFinite(s[k]), `${k} virou ${s[k]}`);
    }
  });
});

// -----------------------------------------------------------------------------
//  Sanitizacao: fronteira de confianca. Tudo que o jogador digita passa aqui.
// -----------------------------------------------------------------------------

// Faixa ASCII de controle (0x00-0x1F) mais DEL (0x7F).
const CTRL = new RegExp('[\\u0000-\\u001f\\u007f]');

describe('sanitizeName', () => {
  test('mantem nomes normais', () => {
    assert.equal(sanitizeName('Capitao Ahab'), 'Capitao Ahab');
  });

  test('gera nome padrao para entrada vazia ou invalida', () => {
    for (const entrada of ['', '   ', null, undefined, 123, {}]) {
      const r = sanitizeName(entrada);
      assert.equal(typeof r, 'string');
      assert.ok(r.length > 0, `nome vazio para ${JSON.stringify(entrada)}`);
    }
  });

  test('corta nomes longos', () => {
    assert.ok(sanitizeName('A'.repeat(500)).length <= 14);
  });

  test('remove sinais de marcacao', () => {
    const r = sanitizeName('<script>alert(1)</script>');
    assert.ok(!r.includes('<'), `sobrou menor-que: ${r}`);
    assert.ok(!r.includes('>'), `sobrou maior-que: ${r}`);
  });

  test('remove caracteres de controle', () => {
    const sujo = 'ab' + String.fromCharCode(7) + String.fromCharCode(27) + 'cd';
    assert.ok(!CTRL.test(sanitizeName(sujo)), 'sobrou caractere de controle');
  });
});

describe('sanitizeChat', () => {
  test('mantem mensagens normais', () => {
    assert.equal(sanitizeChat('a bombordo!'), 'a bombordo!');
  });

  test('descarta mensagens vazias ou invalidas', () => {
    for (const entrada of ['', '   ', null, undefined, 42, []]) {
      assert.ok(!sanitizeChat(entrada), `aceitou ${JSON.stringify(entrada)}`);
    }
  });

  test('respeita CHAT.MAX_LEN', () => {
    assert.ok(sanitizeChat('x'.repeat(1000)).length <= CONFIG.CHAT.MAX_LEN);
  });

  test('remove sinais de marcacao', () => {
    const r = sanitizeChat('<img src=x onerror=alert(1)>');
    assert.ok(!r.includes('<') && !r.includes('>'), `sobrou tag: ${r}`);
  });
});
