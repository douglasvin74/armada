// =============================================================================
//  MAIN - bootstrap, laco de render a 60 FPS, PREDICAO LOCAL e camera.
//
//  Divisao de responsabilidades:
//   - o servidor decide tudo que importa (vida, placar, acertos, tempo);
//   - o cliente desenha os OUTROS navios interpolados ~110 ms no passado;
//   - o cliente move o PROPRIO navio imediatamente (predicao) e corrige a
//     posicao devagar em direcao a verdade do servidor.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, generateIslands, stepShip, lerpAngle } from './shared.js';
import { World } from './scene.js';
import { ShipEntity } from './player.js';
import { Net } from './network.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { GameAudio } from './audio.js';
import { settings } from './settings.js';

const ui = new UI();
const audio = new GameAudio();
const canvas = document.getElementById('game');

// ------------------------------------------------------------- WebGL / boot --
let world;
try {
  world = new World(canvas);
} catch (err) {
  console.error('Falha ao iniciar o WebGL:', err);
  ui.fatal('Seu navegador nao conseguiu iniciar o WebGL. Tente um Chrome/Edge/Firefox atualizado e verifique se a aceleracao de hardware esta ligada.');
  throw err;
}

// O mapa vem da mesma seed no servidor e em todos os clientes.
const islands = generateIslands();
world.buildIslands(islands);

// ----------------------------------------------------------------- estado ----
const ships = new Map();          // id -> ShipEntity
let myId = null;
let myColorIdx = 0;
let lastMatch = 0;
let lastMyHp = CONFIG.SHIP.MAX_HP;
let endedAnnounced = false;

/** Estado predito do navio local (a mesma forma que o servidor usa). */
const local = {
  x: 0, z: 0, yaw: 0, speed: 0, rudder: 0,
  stamina: CONFIG.SHIP.STAMINA_MAX, grounded: false, boosting: false,
};
let localInitialized = false;

// cooldowns espelhados no cliente: evita inundar o servidor de pedidos
let lastMainFire = -99;
let lastBroadFire = -99;

// ------------------------------------------------------------------ input ----
const input = new Input(canvas, {
  onBroadside: () => tryFire('broadside'),
  onScoreboard: (v) => ui.toggleScoreboard(v),
  onChatToggle: (action) => {
    if (action === 'open') { input.chatOpen = true; ui.openChat(); }
    else { input.chatOpen = false; ui.closeChat(); }
  },
  onPause: (paused) => ui.setPaused(paused),
  onMute: () => ui.setMuted(audio.toggleMute()),
  // C recoloca a camera atras do casco (a camera e livre, estilo naval)
  onRecenter: () => { input.camYaw = local.yaw; },
  onLockError: () => {
    ui.addChat(null, 0, 'Mouse nao capturado: segure o botao esquerdo para girar a camera, ou use Q/E e R/F.', true);
  },
});

// ------------------------------------------------------------------- rede ----
const net = new Net({
  onLobby: (d) => {
    ui.buildColorPicker(d.colors, d.taken);
  },
  onWelcome: (d) => {
    myId = d.id;
    myColorIdx = d.color;
    ui.hideStart();
    ui.setHudVisible(true);
    ui.setPaused(false);
    input.enabled = true;
    input.requestLock();
    console.log('Entrou na partida como', d.id);
  },
  onFull: (d) => {
    ui.startError(`A sala esta cheia (${d.max} capitaes). Tente novamente em alguns segundos.`);
  },
  onState: handleSnapshot,
  onChat: (m) => ui.addChat(m.name, m.color, m.text, m.sys),
  onDown: () => { if (input.enabled) ui.setReconnecting(true); },
  onUp: () => ui.setReconnecting(false),
});

// ------------------------------------------------------------- telas / chat --
fetch('/api/info')
  .then((r) => r.json())
  .then((info) => ui.setRoomAddress(info.lan))
  .catch(() => ui.setRoomAddress([]));

ui.onJoin((nick, colorIdx) => {
  audio.unlock();               // precisa acontecer dentro do gesto do usuario
  audio.click();
  net.join(nick, colorIdx);
});

ui.onResume(() => {
  ui.toggleSettings(false);
  ui.setPaused(false);
  input.requestLock();
});

ui.onChatSubmit((text) => {
  if (text && text.trim()) net.say(text.trim());
  input.chatOpen = false;
  ui.closeChat();
});

// -------------------------------------------------------------------- tiro ---
function tryFire(kind) {
  const nowS = performance.now() / 1000;
  const S = CONFIG.SHELL;
  const dirX = Math.sin(input.camYaw);
  const dirZ = Math.cos(input.camYaw);

  if (kind === 'broadside') {
    if (nowS - lastBroadFire < S.BROADSIDE_COOLDOWN) return;
    lastBroadFire = nowS;
    net.fire('broadside');
    // feedback imediato: o servidor confirma depois, mas o jogador ja "sente"
    audio.cannon(1);
    world.muzzleFlash(local.x, S.MUZZLE_HEIGHT, local.z, dirX, dirZ);
    world.muzzleFlash(local.x, S.MUZZLE_HEIGHT, local.z, -dirZ, dirX);
    return;
  }
  if (nowS - lastMainFire < S.MAIN_COOLDOWN) return;
  lastMainFire = nowS;
  net.fire('main');
  audio.cannon(0.9);
  world.muzzleFlash(local.x, S.MUZZLE_HEIGHT, local.z, dirX, dirZ);
}

// ------------------------------------------------------- eventos do servidor -
function distToLocal(x, z) {
  return Math.hypot(x - local.x, z - local.z);
}

function handleSnapshot(s) {
  // ---- reinicio de partida ----
  if (s.mn !== lastMatch) {
    lastMatch = s.mn;
    ui.hideEnd();
    endedAnnounced = false;
  }

  // ---- fim de partida / podio ----
  if (s.st === 'ended' && s.rk) {
    ui.showEnd(s.rk, s.tl);
    if (!endedAnnounced) {
      endedAnnounced = true;
      audio.fanfare();
      console.log('Partida encerrada. Vencedor:', s.rk[0] ? s.rk[0].name : 'ninguem');
    }
  }

  // ---- efeitos visuais e sonoros do tick ----
  for (const f of s.fx) {
    const vol = GameAudio.distanceVolume(distToLocal(f.x, f.z));
    switch (f.t) {
      case 'fire': {
        if (f.o === myId) break;                 // o local ja tocou na hora
        const shooter = s.p.find((p) => p.i === f.o);
        const dx = shooter ? Math.sin(shooter.t) : 0;
        const dz = shooter ? Math.cos(shooter.t) : 0;
        world.muzzleFlash(f.x, f.y, f.z, dx, dz);
        audio.cannon(vol * 0.9);
        break;
      }
      case 'splash':
        world.splash(f.x, f.y, f.z);
        audio.splash(vol);
        break;
      case 'boom':
        world.explosion(f.x, f.y, f.z, false);
        audio.hit(vol);
        break;
      case 'hit':
        world.explosion(f.x, f.y, f.z, false);
        audio.hit(vol);
        break;
      case 'kill':
        ui.addKill(f.a, f.b);
        world.explosion(f.x, 3, f.z, true);
        audio.explosion(vol);
        break;
      case 'respawn':
        world.sparkRing(f.x, 1.5, f.z, 0.4, 0.9, 1.0);
        if (f.c === myColorIdx) audio.respawn();
        break;
      default:
        break;
    }
  }

  // ---- HUD do jogador local ----
  const me = myId ? s.p.find((p) => p.i === myId) : null;
  if (me) {
    if (me.h < lastMyHp) ui.flashDamage();       // flash ao levar dano
    lastMyHp = me.h;
    ui.setStatus(me);
    ui.centerMessage(me.a ? '' : `AFUNDADO - renascendo em ${Math.ceil(me.rt)}s`);

    if (!localInitialized) {                     // primeira posicao conhecida
      local.x = me.x; local.z = me.z; local.yaw = me.y;
      local.speed = me.s; local.stamina = me.st;
      input.camYaw = me.y;
      localInitialized = true;
    }
  }

  ui.setTimer(s.tl, s.st);
  ui.setTopScores(s.p, myId);
  ui.setScoreboard(s.p, myId, s.mn);
}

// ------------------------------------------------------------------ camera ---
const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();

function updateCamera(dt) {
  const C = CONFIG.CAMERA;
  const yaw = input.camYaw;
  const pitch = input.camPitch;

  camTarget.set(local.x, 2.5, local.z);

  const dist = C.DISTANCE;
  const height = C.HEIGHT + pitch * 16;
  let cx = camTarget.x - Math.sin(yaw) * dist;
  let cz = camTarget.z - Math.cos(yaw) * dist;

  // impede a camera de entrar dentro de uma ilha
  for (const isl of islands) {
    const dx = cx - isl.x, dz = cz - isl.z;
    const d = Math.hypot(dx, dz);
    const min = isl.r + 3;
    if (d < min && d > 0.0001) {
      cx = isl.x + (dx / d) * min;
      cz = isl.z + (dz / d) * min;
    }
  }

  // suavizacao leve para a camera nao tremer com o balanco do mar
  // (a firmeza e configuravel no painel de opcoes)
  const k = Math.min(1, dt * settings.get('cameraSmoothing'));
  world.camera.position.x += (cx - world.camera.position.x) * k;
  world.camera.position.y += (camTarget.y + height - world.camera.position.y) * k;
  world.camera.position.z += (cz - world.camera.position.z) * k;

  camLook.set(
    camTarget.x + Math.sin(yaw) * C.LOOK_AHEAD,
    camTarget.y + 2 + pitch * 24,
    camTarget.z + Math.cos(yaw) * C.LOOK_AHEAD
  );
  world.camera.lookAt(camLook);
}

/** Ponto de queda previsto da granada (mira balistica no plano da agua). */
function updateAimMarker() {
  const S = CONFIG.SHELL;
  const pitch = clamp(input.camPitch, S.MIN_PITCH, S.MAX_PITCH);
  const vy = S.SPEED * Math.sin(pitch);
  const vh = S.SPEED * Math.cos(pitch);
  const y0 = S.MUZZLE_HEIGHT;
  // y0 + vy*t - g*t^2/2 = 0  =>  t = (vy + sqrt(vy^2 + 2*g*y0)) / g
  const t = (vy + Math.sqrt(vy * vy + 2 * S.GRAVITY * y0)) / S.GRAVITY;
  const dirX = Math.sin(input.camYaw);
  const dirZ = Math.cos(input.camYaw);
  const inertiaX = Math.sin(local.yaw) * local.speed * 0.5 * t;
  const inertiaZ = Math.cos(local.yaw) * local.speed * 0.5 * t;
  const mx = local.x + dirX * (S.MUZZLE_FORWARD + vh * t) + inertiaX;
  const mz = local.z + dirZ * (S.MUZZLE_FORWARD + vh * t) + inertiaZ;
  world.setAimMarker(mx, mz, true);
}

// -------------------------------------------------- predicao + reconciliacao -
const predInput = { throttle: 0, rudder: 0, boost: false };

function predictLocal(dt, me) {
  if (!localInitialized || !me) return;

  if (me.a === 1) {
    predInput.throttle = input.throttle;
    predInput.rudder = input.rudder;
    predInput.boost = input.boost;
    // MESMA funcao que o servidor roda: a predicao acompanha a verdade
    stepShip(local, predInput, dt, islands);
  } else {
    // afundado: sem controle, apenas segue o que o servidor diz
    local.speed = 0;
  }

  // --- reconciliacao suave ---------------------------------------------------
  // O local roda ~meio RTT a frente do servidor. Puxar a posicao de volta de
  // uma vez causaria "elastico", entao corrigimos devagar (navio e lento, o
  // erro fica invisivel). Se o erro for grande demais (teleporte, respawn,
  // reconexao), damos um snap direto.
  const err = Math.hypot(me.x - local.x, me.z - local.z);
  if (err > 14 || me.a === 0) {
    local.x = me.x; local.z = me.z; local.yaw = me.y; local.speed = me.s;
  } else {
    const k = Math.min(1, dt * 2.0);
    local.x += (me.x - local.x) * k;
    local.z += (me.z - local.z) * k;
    local.yaw = lerpAngle(local.yaw, me.y, Math.min(1, dt * 1.2));
  }
  local.stamina = me.st;   // estamina e autoridade do servidor (barra do HUD)
}

// -------------------------------------------------------------- loop 60 FPS --
let lastFrame = performance.now();
let inputAcc = 0;
let fpsFrames = 0;
let fpsAcc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  // --- contador de FPS (janela de 0,5 s) ---
  fpsFrames++;
  fpsAcc += dt;
  if (fpsAcc >= 0.5) {
    ui.setStats(Math.round(fpsFrames / fpsAcc), net.ping);
    fpsFrames = 0;
    fpsAcc = 0;
  }

  input.applyKeyboardLook(dt);

  const snap = net.latest;
  const me = snap && myId ? snap.p.find((p) => p.i === myId) : null;
  const clock = net.serverClock();

  // --- predicao do navio local ---
  predictLocal(dt, me);

  // --- tiro continuo com o botao esquerdo pressionado ---
  if (input.firing && me && me.a === 1 && snap && snap.st === 'playing') tryFire('main');

  // --- estado interpolado dos outros navios ---
  const frameState = net.sample();
  const seen = new Set();

  for (const [id, st] of frameState.players) {
    seen.add(id);
    let ent = ships.get(id);
    if (!ent) {
      ent = new ShipEntity(world.scene, ui.colorOf(st.raw.c), st.raw.n, id === myId);
      ships.set(id, ent);
    }

    const isLocal = id === myId;
    const view = isLocal
      ? {
          x: local.x, z: local.z, yaw: local.yaw, speed: local.speed,
          rudder: local.rudder, alive: st.alive,
          turretYaw: input.camYaw, aimPitch: input.camPitch,
        }
      : {
          x: st.x, z: st.z, yaw: st.yaw, speed: st.speed,
          rudder: 0, alive: st.alive,
          turretYaw: st.turretYaw, aimPitch: 0.15,
        };

    ent.setHp(st.raw.h, st.alive);
    ent.apply(view, clock, dt);

    // esteira de espuma proporcional a velocidade
    if (st.alive && Math.abs(view.speed) > 3) {
      const strength = Math.min(1, Math.abs(view.speed) / CONFIG.SHIP.MAX_SPEED);
      world.wake(view.x, ent.group.position.y, view.z, Math.sin(view.yaw), Math.cos(view.yaw), strength);
    }
  }

  // remove navios que sairam (desconexao aparece em ~110 ms)
  for (const [id, ent] of ships) {
    if (!seen.has(id)) {
      ent.dispose();
      ships.delete(id);
    }
  }

  world.syncShells(frameState.shells);

  if (me) {
    ui.setSpeed(local.speed);
    audio.setEngine(me.a === 1 ? Math.abs(local.speed) : 0, CONFIG.SHIP.MAX_SPEED);
    world.setAimMarker(0, 0, false);
    if (me.a === 1) updateAimMarker();
  } else {
    world.setAimMarker(0, 0, false);
  }

  updateCamera(dt);
  world.update(dt, clock, local);
  world.render();

  // --- envio de input a 30 Hz (nao a 60: economiza banda sem perder resposta) --
  inputAcc += dt;
  if (inputAcc >= 1 / CONFIG.INPUT_HZ) {
    inputAcc = 0;
    net.sendInput({
      th: input.throttle,
      ru: input.rudder,
      bo: input.boost,
      ay: input.camYaw,
      ap: input.camPitch,
      pg: net.ping,
    });
  }
}

requestAnimationFrame(frame);

// mensagem de boas-vindas na tela inicial enquanto ninguem entrou
console.log('Armada: cliente carregado. Aguardando entrada na partida.');
