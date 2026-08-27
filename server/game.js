// =============================================================================
//  GAME - loop de simulacao autoritativo, estado da partida e regras.
//
//  O servidor e a FONTE DA VERDADE: posicoes, vida, placar, colisoes e tempo
//  de partida sao decididos aqui. O cliente so manda intencao (input).
// =============================================================================

import { CONFIG } from './config.js';
import { clamp, num, generateIslands, stepShip } from './shared.js';

/** Paleta de cores unicas dos jogadores (uma por barco). */
export const TEAM_COLORS = [
  { name: 'Vermelho', hex: 0xff4d4d },
  { name: 'Azul',     hex: 0x4d9bff },
  { name: 'Verde',    hex: 0x53d769 },
  { name: 'Amarelo',  hex: 0xffd23f },
  { name: 'Roxo',     hex: 0xb06bff },
  { name: 'Laranja',  hex: 0xff8c42 },
  { name: 'Ciano',    hex: 0x35e0d8 },
  { name: 'Rosa',     hex: 0xff6fb5 },
];

// Arredonda para 2 casas: corta ~40% do tamanho do snapshot na rede.
const r2 = (n) => Math.round(n * 100) / 100;

export class Game {
  constructor() {
    this.islands = generateIslands();       // mesmo mapa em todos os clientes
    this.players = new Map();               // socketId -> jogador
    this.shells = [];                       // projeteis em voo
    this.fx = [];                           // eventos visuais do tick atual
    this.nextShellId = 1;
    this.clock = 0;                         // relogio interno em segundos
    this.state = 'playing';                 // 'playing' | 'ended'
    this.timeLeft = CONFIG.MATCH.DURATION;
    this.matchNumber = 1;
    this.lastRanking = [];
    console.log(`[PARTIDA] #1 iniciada (${CONFIG.MATCH.DURATION}s)`);
  }

  // --------------------------------------------------------------- jogadores

  /** Primeira cor livre; se a preferida estiver tomada, pega a proxima. */
  pickColor(preferred) {
    const taken = new Set([...this.players.values()].map((p) => p.color));
    if (Number.isInteger(preferred) && preferred >= 0
        && preferred < TEAM_COLORS.length && !taken.has(preferred)) {
      return preferred;
    }
    for (let i = 0; i < TEAM_COLORS.length; i++) if (!taken.has(i)) return i;
    return 0;
  }

  /** Ponto de nascimento espalhado num anel, sempre olhando para o centro. */
  spawnPoint() {
    const ang = Math.random() * Math.PI * 2;
    const dist = CONFIG.MAP.ARENA_RADIUS * (0.55 + Math.random() * 0.3);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    // yaw apontando para o centro: frente = (sin yaw, cos yaw)
    const yaw = Math.atan2(-x, -z);
    return { x, z, yaw };
  }

  addPlayer(id, name, preferredColor) {
    const sp = this.spawnPoint();
    const p = {
      id,
      name,
      color: this.pickColor(preferredColor),
      x: sp.x, z: sp.z, yaw: sp.yaw,
      speed: 0, rudder: 0, stamina: CONFIG.SHIP.STAMINA_MAX,
      grounded: false, boosting: false,
      hp: CONFIG.SHIP.MAX_HP, alive: true, respawnAt: 0,
      turretYaw: sp.yaw, aimPitch: 0.15,
      score: 0, kills: 0, deaths: 0,
      input: { throttle: 0, rudder: 0, boost: false },
      lastMain: -99, lastBroadside: -99, lastChat: -99, lastRam: -99,
      scrapeAcc: 0,
      latency: 0,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (p) this.players.delete(id);
    // projeteis orfaos continuam voando, mas sem dono para pontuar
    return p;
  }

  /** Aplica o input recebido, sempre com validacao/limitacao. */
  setInput(id, d) {
    const p = this.players.get(id);
    if (!p || !d) return;
    p.input.throttle = clamp(num(d.th), -1, 1);
    p.input.rudder = clamp(num(d.ru), -1, 1);
    p.input.boost = !!d.bo;
    p.turretYaw = num(d.ay, p.turretYaw);
    p.aimPitch = clamp(num(d.ap, p.aimPitch), CONFIG.SHELL.MIN_PITCH, CONFIG.SHELL.MAX_PITCH);
    p.latency = clamp(Math.round(num(d.pg)), 0, 999);
  }

  // ------------------------------------------------------------------ tiros

  /** Valida cadencia no servidor: cliente nao consegue metralhar. */
  requestFire(id, kind) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.state !== 'playing') return;
    const S = CONFIG.SHELL;

    if (kind === 'broadside') {
      if (this.clock - p.lastBroadside < S.BROADSIDE_COOLDOWN) return;
      p.lastBroadside = this.clock;
      const half = (S.BROADSIDE_COUNT - 1) / 2;
      for (let i = 0; i < S.BROADSIDE_COUNT; i++) {
        const off = (i - half) * S.BROADSIDE_SPREAD;
        this.spawnShell(p, p.turretYaw + off, p.aimPitch + 0.05, S.BROADSIDE_DAMAGE);
      }
      this.fx.push({ t: 'fire', o: p.id, x: r2(p.x), y: S.MUZZLE_HEIGHT, z: r2(p.z), b: 1 });
    } else {
      if (this.clock - p.lastMain < S.MAIN_COOLDOWN) return;
      p.lastMain = this.clock;
      this.spawnShell(p, p.turretYaw, p.aimPitch, S.MAIN_DAMAGE);
      this.fx.push({ t: 'fire', o: p.id, x: r2(p.x), y: S.MUZZLE_HEIGHT, z: r2(p.z), b: 0 });
    }
  }

  spawnShell(p, yaw, pitch, dmg) {
    const S = CONFIG.SHELL;
    pitch = clamp(pitch, S.MIN_PITCH, S.MAX_PITCH);
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = Math.cos(yaw) * cp;
    this.shells.push({
      id: this.nextShellId++,
      owner: p.id,
      dmg,
      x: p.x + dx * S.MUZZLE_FORWARD,
      y: S.MUZZLE_HEIGHT,
      z: p.z + dz * S.MUZZLE_FORWARD,
      // metade da velocidade do navio entra na granada (inercia)
      vx: dx * S.SPEED + Math.sin(p.yaw) * p.speed * 0.5,
      vy: dy * S.SPEED,
      vz: dz * S.SPEED + Math.cos(p.yaw) * p.speed * 0.5,
      life: S.LIFE,
    });
  }

  // -------------------------------------------------------------------- dano

  applyDamage(victim, dmg, attackerId) {
    if (!victim.alive || this.state !== 'playing') return;
    const attacker = attackerId ? this.players.get(attackerId) : null;
    victim.hp -= dmg;

    if (attacker && attacker !== victim) attacker.score += CONFIG.SCORE.HIT;

    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      victim.speed = 0;
      victim.rudder = 0;
      victim.deaths++;
      victim.score = Math.max(0, victim.score + CONFIG.SCORE.DEATH);
      victim.respawnAt = this.clock + CONFIG.SHIP.RESPAWN_DELAY;
      if (attacker && attacker !== victim) {
        attacker.kills++;
        attacker.score += CONFIG.SCORE.KILL;
      }
      this.fx.push({
        t: 'kill', x: r2(victim.x), y: 2, z: r2(victim.z),
        a: attacker && attacker !== victim ? attacker.name : 'O mar',
        b: victim.name, v: victim.id, c: victim.color,
      });
    }
  }

  // --------------------------------------------------------------- simulacao

  update(dt) {
    this.clock += dt;

    if (this.state === 'playing') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.endMatch();
    } else {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.restartMatch();
    }

    if (this.state === 'playing') {
      this.updateShips(dt);
      this.resolveShipCollisions();
      this.updateShells(dt);
      this.updateRespawns();
    }

    if (this.fx.length > 60) this.fx.length = 60; // trava de seguranca
  }

  updateShips(dt) {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      stepShip(p, p.input, dt, this.islands);
      // raspar em ilha ou na tempestade machuca aos poucos
      if (p.grounded) {
        p.scrapeAcc += CONFIG.SHIP.ISLAND_DPS * dt;
        if (p.scrapeAcc >= 1) {
          const dmg = Math.floor(p.scrapeAcc);
          p.scrapeAcc -= dmg;
          this.applyDamage(p, dmg, null);
        }
      } else {
        p.scrapeAcc = 0;
      }
    }
  }

  /** Colisao navio-navio por esferas: separa os dois e cobra dano de aríete. */
  resolveShipCollisions() {
    const arr = [];
    for (const p of this.players.values()) if (p.alive) arr.push(p);
    const minDist = CONFIG.SHIP.COLLISION_RADIUS * 2;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= minDist || d < 0.0001) continue;
        const push = (minDist - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
        const impact = Math.abs(a.speed) + Math.abs(b.speed);
        a.speed *= 0.35; b.speed *= 0.35;
        if (impact > 12 && this.clock - a.lastRam > 1 && this.clock - b.lastRam > 1) {
          a.lastRam = b.lastRam = this.clock;
          const d0 = CONFIG.SHIP.RAM_DAMAGE;
          this.applyDamage(a, d0, null);
          this.applyDamage(b, d0, null);
          this.fx.push({ t: 'boom', x: r2((a.x + b.x) / 2), y: 1.5, z: r2((a.z + b.z) / 2) });
        }
      }
    }
  }

  updateShells(dt) {
    const S = CONFIG.SHELL;
    const arenaLimit = CONFIG.MAP.ARENA_RADIUS + 40;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.vy -= S.GRAVITY * dt;          // arco balistico
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.z += sh.vz * dt;
      sh.life -= dt;

      // --- acerto em navio (esfera x esfera no plano XZ + faixa de altura) ---
      let victim = null;
      if (sh.y > -1 && sh.y < 9) {
        for (const p of this.players.values()) {
          if (!p.alive || p.id === sh.owner) continue;
          if (Math.hypot(sh.x - p.x, sh.z - p.z) < CONFIG.SHIP.COLLISION_RADIUS + S.RADIUS) {
            victim = p; break;
          }
        }
      }
      if (victim) {
        this.fx.push({ t: 'hit', x: r2(sh.x), y: r2(sh.y), z: r2(sh.z), v: victim.id });
        this.applyDamage(victim, sh.dmg, sh.owner);
        this.shells.splice(i, 1);
        continue;
      }

      // --- acerto em ilha (aproximada por cilindro: barato e previsivel) ---
      let onIsland = false;
      for (const isl of this.islands) {
        if (sh.y < isl.h && Math.hypot(sh.x - isl.x, sh.z - isl.z) < isl.r) { onIsland = true; break; }
      }

      const out = Math.hypot(sh.x, sh.z) > arenaLimit;
      if (onIsland || sh.y <= 0 || sh.life <= 0 || out) {
        if (!out) {
          this.fx.push({
            t: onIsland ? 'boom' : 'splash',
            x: r2(sh.x), y: r2(Math.max(0, sh.y)), z: r2(sh.z),
          });
        }
        this.shells.splice(i, 1);
      }
    }
  }

  updateRespawns() {
    for (const p of this.players.values()) {
      if (p.alive || this.clock < p.respawnAt) continue;
      const sp = this.spawnPoint();
      p.x = sp.x; p.z = sp.z; p.yaw = sp.yaw; p.turretYaw = sp.yaw;
      p.speed = 0; p.rudder = 0; p.hp = CONFIG.SHIP.MAX_HP;
      p.stamina = CONFIG.SHIP.STAMINA_MAX;
      p.alive = true;
      p.scrapeAcc = 0;
      this.fx.push({ t: 'respawn', x: r2(p.x), y: 1, z: r2(p.z), c: p.color });
    }
  }

  // ----------------------------------------------------------------- partida

  ranking() {
    return [...this.players.values()]
      .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, kills: p.kills, deaths: p.deaths }));
  }

  endMatch() {
    this.state = 'ended';
    this.timeLeft = CONFIG.MATCH.POST_MATCH;
    this.shells.length = 0;
    this.lastRanking = this.ranking();
    const winner = this.lastRanking[0];
    console.log(`[PARTIDA] #${this.matchNumber} terminou. Vencedor: ${winner ? winner.name + ' (' + winner.score + ' pts)' : 'ninguem'}`);
  }

  restartMatch() {
    this.matchNumber++;
    this.state = 'playing';
    this.timeLeft = CONFIG.MATCH.DURATION;
    this.shells.length = 0;
    for (const p of this.players.values()) {
      const sp = this.spawnPoint();
      p.x = sp.x; p.z = sp.z; p.yaw = sp.yaw; p.turretYaw = sp.yaw;
      p.speed = 0; p.rudder = 0; p.hp = CONFIG.SHIP.MAX_HP;
      p.stamina = CONFIG.SHIP.STAMINA_MAX;
      p.alive = true; p.score = 0; p.kills = 0; p.deaths = 0;
      p.scrapeAcc = 0; p.lastMain = -99; p.lastBroadside = -99;
    }
    console.log(`[PARTIDA] #${this.matchNumber} iniciada (${CONFIG.MATCH.DURATION}s)`);
  }

  // ---------------------------------------------------------------- snapshot

  /** Estado compacto enviado a 30 Hz. Chaves curtas = menos banda. */
  snapshot() {
    const S = CONFIG.SHELL;
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        i: p.id,
        n: p.name,
        c: p.color,
        x: r2(p.x), z: r2(p.z),
        y: r2(p.yaw), t: r2(p.turretYaw),
        s: r2(p.speed),
        h: Math.round(p.hp),
        a: p.alive ? 1 : 0,
        st: Math.round(p.stamina),
        sc: p.score, k: p.kills, d: p.deaths,
        rt: p.alive ? 0 : r2(Math.max(0, p.respawnAt - this.clock)),
        // cooldowns restantes (o HUD do dono usa; sao 2 numeros, cabe bem)
        cm: r2(Math.max(0, S.MAIN_COOLDOWN - (this.clock - p.lastMain))),
        cb: r2(Math.max(0, S.BROADSIDE_COOLDOWN - (this.clock - p.lastBroadside))),
        pg: p.latency,
      });
    }
    const shells = this.shells.map((s) => ({ i: s.id, x: r2(s.x), y: r2(s.y), z: r2(s.z) }));
    const fx = this.fx;
    this.fx = [];
    return {
      ts: Date.now(),
      ck: r2(this.clock),      // relogio compartilhado (ondas em fase)
      st: this.state,
      tl: Math.max(0, this.timeLeft),
      mn: this.matchNumber,
      p: players,
      s: shells,
      fx,
      rk: this.state === 'ended' ? this.lastRanking : null,
    };
  }
}
