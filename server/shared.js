// =============================================================================
//  SHARED - matematica, geracao de mapa e FISICA DO NAVIO.
//
//  Rodado nos DOIS lados:
//   - no servidor, como fonte da verdade (30 Hz);
//   - no cliente, para a PREDICAO LOCAL do proprio navio (60 FPS).
//  Servido ao navegador em /js/shared.js (ver server/index.js).
// =============================================================================

import { CONFIG } from './config.js';

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/** Numero valido ou fallback (usado para sanitizar input vindo da rede). */
export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * PRNG deterministico (mulberry32). A mesma seed produz sempre a mesma
 * sequencia, no Node e no navegador, entao todo mundo gera o mesmo mapa.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normaliza um angulo para o intervalo (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * Interpola angulos pelo caminho mais curto. Sem isso, um navio que cruza
 * de +179 para -179 graus daria um giro completo na tela durante a
 * interpolacao entre snapshots.
 */
export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

/**
 * Gera as ilhas do mapa a partir da seed fixa de CONFIG.MAP.SEED.
 * Deve ser 100% deterministica: nada de Math.random() aqui.
 */
export function generateIslands() {
  const M = CONFIG.MAP;
  const rnd = mulberry32(M.SEED);
  const list = [];
  let guard = 0;
  while (list.length < M.ISLAND_COUNT && guard++ < 4000) {
    const ang = rnd() * Math.PI * 2;
    const span = M.ARENA_RADIUS - M.ISLAND_KEEPOUT - 34;
    const dist = M.ISLAND_KEEPOUT + rnd() * span;
    const r = M.ISLAND_MIN_R + rnd() * (M.ISLAND_MAX_R - M.ISLAND_MIN_R);
    const h = M.ISLAND_MIN_H + rnd() * (M.ISLAND_MAX_H - M.ISLAND_MIN_H);
    const rot = rnd() * Math.PI * 2;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    // rejeita se ficar colada em outra ilha (mantem canais navegaveis)
    let ok = true;
    for (const i of list) {
      if (Math.hypot(i.x - x, i.z - z) < i.r + r + M.ISLAND_GAP) { ok = false; break; }
    }
    if (ok) list.push({ x, z, r, h, rot });
  }
  return list;
}

/**
 * Altura da onda em (x,z) no instante t. E puramente visual, mas a formula
 * mora aqui e usa o relogio compartilhado para que todos vejam o mar na mesma
 * fase, fazendo o balanco dos navios bater entre as telas.
 */
export function waveHeight(x, z, t) {
  return Math.sin(x * 0.045 + t * 0.9) * 0.55
       + Math.sin(z * 0.037 - t * 0.7) * 0.45
       + Math.sin((x + z) * 0.021 + t * 1.3) * 0.30;
}

/**
 * FISICA DO NAVIO - um passo de simulacao.
 *
 * s       : estado mutavel { x, z, yaw, speed, rudder, stamina, grounded }
 * input   : { throttle -1..1, rudder -1..1, boost bool }
 * dt      : tempo em segundos
 * islands : obstaculos circulares
 *
 * Convencao de eixos: yaw = 0 aponta para +Z. O vetor "frente" e
 * (sin(yaw), 0, cos(yaw)), que e exatamente o +Z local de um Object3D do
 * Three.js com rotation.y = yaw. Por isso o casco e modelado com a proa em +Z.
 */
export function stepShip(s, input, dt, islands) {
  const S = CONFIG.SHIP;
  const throttle = clamp(num(input && input.throttle), -1, 1);
  const rudderIn = clamp(num(input && input.rudder), -1, 1);

  // --- turbina: so vale indo para frente e com estamina sobrando ---
  const boosting = !!(input && input.boost) && s.stamina > 1 && throttle > 0.1;
  const maxFwd = S.MAX_SPEED * (boosting ? S.BOOST_MULT : 1);
  const target = throttle >= 0 ? throttle * maxFwd : throttle * S.MAX_REVERSE;

  // acelerar e lento; frear/reverter e rapido (sensacao de massa)
  const sameWay = Math.sign(target) === Math.sign(s.speed) || s.speed === 0;
  const rate = (sameWay && Math.abs(target) > Math.abs(s.speed)) ? S.ACCEL : S.BRAKE;
  s.speed += clamp(target - s.speed, -rate * dt, rate * dt);

  s.stamina = boosting
    ? Math.max(0, s.stamina - S.STAMINA_DRAIN * dt)
    : Math.min(S.STAMINA_MAX, s.stamina + S.STAMINA_REGEN * dt);
  s.boosting = boosting;

  // --- leme com inercia: o navio nao muda de direcao instantaneamente ---
  s.rudder += clamp(rudderIn - s.rudder, -S.RUDDER_RESPONSE * dt, S.RUDDER_RESPONSE * dt);
  // parado o leme nao faz nada; a autoridade cresce com a velocidade
  const authority = clamp(Math.abs(s.speed) / (S.MAX_SPEED * S.TURN_SPEED_REF), 0, 1);
  const dir = s.speed < -0.05 ? -1 : 1; // dando re, o leme inverte
  s.yaw = wrapAngle(s.yaw + s.rudder * S.TURN_RATE * authority * dir * dt);

  // --- integracao de posicao ---
  let nx = s.x + Math.sin(s.yaw) * s.speed * dt;
  let nz = s.z + Math.cos(s.yaw) * s.speed * dt;

  // --- colisao por circulos contra as ilhas: empurra para fora e freia ---
  s.grounded = false;
  for (let i = 0; i < islands.length; i++) {
    const isl = islands[i];
    const dx = nx - isl.x, dz = nz - isl.z;
    const d = Math.hypot(dx, dz);
    const minDist = isl.r + S.COLLISION_RADIUS;
    if (d < minDist && d > 0.0001) {
      nx = isl.x + (dx / d) * minDist;
      nz = isl.z + (dz / d) * minDist;
      s.speed *= 0.4;
      s.grounded = true;
    }
  }

  // --- limite da arena (parede de tempestade) ---
  const lim = CONFIG.MAP.ARENA_RADIUS - S.COLLISION_RADIUS;
  const dc = Math.hypot(nx, nz);
  if (dc > lim && dc > 0.0001) {
    nx = (nx / dc) * lim;
    nz = (nz / dc) * lim;
    s.speed *= 0.55;
    s.grounded = true;
  }

  s.x = nx;
  s.z = nz;
  return s;
}

/**
 * Remove caracteres de controle e sinais de marcacao de um texto.
 * Feito com charCodeAt em vez de regex para nao depender de classes
 * de caracteres exoticas.
 */
function stripUnsafe(raw) {
  // So string e entrada valida. Sem esta guarda, String() coage qualquer coisa
  // vinda do socket: o numero 42 vira a mensagem "42" e {} vira
  // "[object Object]" no chat de todos.
  if (typeof raw !== 'string') return '';
  const str = raw;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 32 || c === 127) continue;          // controles
    if (c === 60 || c === 62 || c === 38) continue; // < > &
    out += str[i];
  }
  return out;
}

/** Remove controles/HTML do apelido e limita o tamanho. */
export function sanitizeName(raw) {
  let n = stripUnsafe(raw).replace(/\s+/g, ' ').trim().slice(0, 14);
  if (!n) n = 'Marujo' + Math.floor(100 + Math.random() * 900);
  return n;
}

/** Sanitiza mensagem de chat (o cliente insere via textContent, mas dobramos). */
export function sanitizeChat(raw) {
  return stripUnsafe(raw).trim().slice(0, CONFIG.CHAT.MAX_LEN);
}
