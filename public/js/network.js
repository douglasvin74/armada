// =============================================================================
//  NETWORK - cliente Socket.IO, buffer de snapshots e INTERPOLACAO.
//
//  O servidor manda estado a 30 Hz; a tela roda a 60 FPS. Para nao ver os
//  outros navios "pipocando", o cliente renderiza sempre um pouco no passado
//  (CONFIG.INTERP_DELAY_MS) e interpola entre os dois snapshots que cercam
//  esse instante. E o preco classico: ~110 ms de atraso visual em troca de
//  movimento perfeitamente suave.
// =============================================================================

import { CONFIG } from './config.js';
import { clamp, lerpAngle } from './shared.js';

export class Net {
  /**
   * @param {object} handlers callbacks: onLobby, onWelcome, onFull, onState,
   *                          onChat, onLeft, onDown, onUp
   */
  constructor(handlers) {
    this.h = handlers;
    this.snaps = [];          // { ct: tempo local de chegada, d: snapshot }
    this.latest = null;       // ultimo snapshot cru (verdade p/ HUD e placar)
    this.ping = 0;
    this.joinPayload = null;
    this.joined = false;
    this.wasConnected = false;

    if (typeof window.io !== 'function') {
      throw new Error('Cliente Socket.IO nao carregou (/socket.io/socket.io.js).');
    }

    const s = window.io({
      // WebSocket primeiro (menor latencia); long-polling fica como reserva
      // para redes/proxies que bloqueiam WS.
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 700,
      reconnectionDelayMax: 3000,
      timeout: 8000,
    });
    this.socket = s;

    s.on('connect', () => {
      if (this.wasConnected) this.h.onUp && this.h.onUp();
      this.wasConnected = true;
      // Reconexao simples: se ja tinhamos entrado, entramos de novo sozinhos.
      if (this.joinPayload) s.emit('join', this.joinPayload);
    });

    s.on('lobby', (d) => this.h.onLobby && this.h.onLobby(d));
    s.on('welcome', (d) => { this.joined = true; this.h.onWelcome && this.h.onWelcome(d); });
    s.on('full', (d) => this.h.onFull && this.h.onFull(d));
    s.on('chat', (m) => this.h.onChat && this.h.onChat(m));
    s.on('left', (d) => this.h.onLeft && this.h.onLeft(d));

    s.on('state', (d) => {
      this.latest = d;
      this.snaps.push({ ct: performance.now(), d });
      if (this.snaps.length > 24) this.snaps.shift();
      this.h.onState && this.h.onState(d);
    });

    s.on('lpong', (t) => { this.ping = Math.max(0, Math.round(performance.now() - t)); });

    s.on('disconnect', () => {
      this.snaps.length = 0;
      this.h.onDown && this.h.onDown();
    });
    s.on('connect_error', () => this.h.onDown && this.h.onDown());

    // medicao de latencia 1x por segundo
    this.pingTimer = setInterval(() => {
      if (s.connected) s.emit('lp', performance.now());
    }, 1000);
  }

  join(name, color) {
    this.joinPayload = { name, color };
    this.socket.emit('join', this.joinPayload);
  }

  sendInput(packet) {
    if (this.joined && this.socket.connected) this.socket.emit('input', packet);
  }

  fire(kind) {
    if (this.joined && this.socket.connected) this.socket.emit('fire', { kind });
  }

  say(text) {
    if (this.joined && this.socket.connected) this.socket.emit('chat', text);
  }

  /**
   * Estado interpolado no instante de render.
   * Retorna Maps id -> estado para navios e granadas.
   */
  sample() {
    const out = { players: new Map(), shells: new Map() };
    const n = this.snaps.length;
    if (n === 0) return out;

    const renderTime = performance.now() - CONFIG.INTERP_DELAY_MS;

    // procura o par (a, b) que cerca renderTime
    let a = this.snaps[n - 1];
    let b = null;
    for (let i = n - 1; i > 0; i--) {
      if (this.snaps[i - 1].ct <= renderTime && this.snaps[i].ct >= renderTime) {
        a = this.snaps[i - 1];
        b = this.snaps[i];
        break;
      }
    }
    // sem par valido (pacote atrasado): usa o mais recente sem interpolar
    const t = b ? clamp((renderTime - a.ct) / Math.max(1, b.ct - a.ct), 0, 1) : 0;

    const bp = new Map();
    if (b) for (const p of b.d.p) bp.set(p.i, p);

    for (const p of a.d.p) {
      const q = bp.get(p.i);
      if (q) {
        out.players.set(p.i, {
          raw: p,
          x: p.x + (q.x - p.x) * t,
          z: p.z + (q.z - p.z) * t,
          yaw: lerpAngle(p.y, q.y, t),
          turretYaw: lerpAngle(p.t, q.t, t),
          speed: p.s + (q.s - p.s) * t,
          alive: q.a === 1,
          hp: q.h,
        });
      } else {
        out.players.set(p.i, {
          raw: p, x: p.x, z: p.z, yaw: p.y, turretYaw: p.t,
          speed: p.s, alive: p.a === 1, hp: p.h,
        });
      }
    }

    const bs = new Map();
    if (b) for (const s of b.d.s) bs.set(s.i, s);
    for (const s of a.d.s) {
      const q = bs.get(s.i);
      out.shells.set(s.i, q
        ? { x: s.x + (q.x - s.x) * t, y: s.y + (q.y - s.y) * t, z: s.z + (q.z - s.z) * t }
        : { x: s.x, y: s.y, z: s.z });
    }

    return out;
  }

  /** Relogio do servidor em segundos, usado para deixar as ondas em fase. */
  serverClock() {
    return this.latest ? this.latest.ck : performance.now() / 1000;
  }
}
