// =============================================================================
//  PLAYER - avatar do navio (construido so com primitivas), placa de nome
//  e a suavizacao visual aplicada em cima do estado vindo da rede.
//
//  Todas as geometrias sao criadas UMA vez (cache de modulo) e compartilhadas
//  entre os ate 8 navios. So o material do casco e por jogador, porque cada
//  um tem sua cor unica.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { waveHeight, lerpAngle, clamp } from './shared.js';

const S = CONFIG.SHIP;

// ------------------------------------------------------------ cache de geo ---
const geo = {
  hull:    new THREE.BoxGeometry(S.HULL_WIDTH, 2.4, S.HULL_LENGTH),
  bow:     new THREE.CylinderGeometry(0, S.HULL_WIDTH * 0.707, 4.6, 4, 1),
  deck:    new THREE.BoxGeometry(S.HULL_WIDTH * 0.86, 0.5, S.HULL_LENGTH * 0.74),
  tower:   new THREE.BoxGeometry(S.HULL_WIDTH * 0.62, 2.6, S.HULL_LENGTH * 0.26),
  bridge:  new THREE.BoxGeometry(S.HULL_WIDTH * 0.46, 1.2, S.HULL_LENGTH * 0.15),
  funnel:  new THREE.CylinderGeometry(0.5, 0.62, 2.2, 10),
  mast:    new THREE.CylinderGeometry(0.11, 0.14, 7, 6),
  turretB: new THREE.CylinderGeometry(1.15, 1.35, 1.1, 10),
  barrel:  new THREE.CylinderGeometry(0.2, 0.24, 5.0, 8),
  flag:    new THREE.PlaneGeometry(1.9, 1.1),
  stripe:  new THREE.BoxGeometry(S.HULL_WIDTH + 0.12, 0.35, S.HULL_LENGTH * 0.98),

  // --- detalhes acrescentados na revisao visual ---
  keel:    new THREE.CylinderGeometry(S.HULL_WIDTH * 0.34, S.HULL_WIDTH * 0.30, S.HULL_LENGTH * 0.94, 8),
  stern:   new THREE.CylinderGeometry(S.HULL_WIDTH * 0.5, S.HULL_WIDTH * 0.44, 2.6, 12, 1),
  tier2:   new THREE.BoxGeometry(S.HULL_WIDTH * 0.44, 1.5, S.HULL_LENGTH * 0.16),
  funnelCap: new THREE.CylinderGeometry(0.66, 0.56, 0.34, 10),
  secBase: new THREE.CylinderGeometry(0.72, 0.86, 0.8, 8),
  secBarrel: new THREE.CylinderGeometry(0.12, 0.15, 2.8, 6),
  railLong: new THREE.BoxGeometry(0.09, 0.62, S.HULL_LENGTH * 0.72),
  railPost: new THREE.BoxGeometry(0.14, 0.7, 0.14),
  boat:    new THREE.CapsuleGeometry(0.42, 1.5, 3, 6),
  radarBar: new THREE.BoxGeometry(2.6, 0.5, 0.12),
  radarHub: new THREE.CylinderGeometry(0.16, 0.16, 0.4, 6),
  yard:    new THREE.CylinderGeometry(0.07, 0.07, 4.2, 5),
  wash:    new THREE.PlaneGeometry(S.HULL_WIDTH * 2.2, S.HULL_LENGTH * 1.5),
};

// ------------------------------------------------------ materiais comuns -----
const matSteel = new THREE.MeshStandardMaterial({ color: 0x9fb0bd, roughness: 0.55, metalness: 0.5 });
const matDark  = new THREE.MeshStandardMaterial({ color: 0x2c3742, roughness: 0.7, metalness: 0.4 });
const matDeck  = new THREE.MeshStandardMaterial({ color: 0x6b5741, roughness: 0.9 });
const matRail  = new THREE.MeshStandardMaterial({ color: 0xd7e2ea, roughness: 0.4, metalness: 0.6 });
const matBoat  = new THREE.MeshStandardMaterial({ color: 0xe0d3b4, roughness: 0.85 });
const matGlass = new THREE.MeshStandardMaterial({
  color: 0x0d2233, roughness: 0.12, metalness: 0.85,
  emissive: 0x7fd4ff, emissiveIntensity: 0.35,
});

/**
 * Textura da faixa de vigias: um retangulo escuro com circulos claros. Feita
 * uma unica vez e reaproveitada pelos 8 navios (e so uma fita de 256x32).
 */
const portholeTex = (() => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.55)';
  x.fillRect(0, 0, 256, 32);
  for (let i = 0; i < 10; i++) {
    x.beginPath();
    x.arc(16 + i * 25, 16, 5.5, 0, Math.PI * 2);
    x.fillStyle = '#ffe9b0';
    x.fill();
    x.lineWidth = 2;
    x.strokeStyle = '#5d6a75';
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const matPorthole = new THREE.MeshStandardMaterial({
  map: portholeTex, transparent: true, roughness: 0.5,
  emissiveMap: portholeTex, emissive: 0xffffff, emissiveIntensity: 0.4,
});

/** Desenha a placa flutuante com nome + barra de vida (CanvasTexture). */
function drawNameplate(ctx, name, hp, colorCss, alive) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.font = 'bold 42px system-ui, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(name, W / 2, 34);
  ctx.fillStyle = alive ? '#ffffff' : '#8ea6b8';
  ctx.fillText(name, W / 2, 34);

  // barra de vida
  const bw = 210, bh = 16, bx = (W - bw) / 2, by = 62;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(bx, by, bw, bh);
  const frac = clamp(hp / S.MAX_HP, 0, 1);
  ctx.fillStyle = frac > 0.5 ? '#6fe08a' : (frac > 0.22 ? '#ffd23f' : '#ff5252');
  ctx.fillRect(bx, by, bw * frac, bh);
  ctx.strokeStyle = colorCss;
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
}

export class ShipEntity {
  /**
   * @param {THREE.Scene} scene
   * @param {number} colorHex cor unica atribuida pelo servidor
   * @param {string} name apelido ja sanitizado
   * @param {boolean} isLocal se e o navio do jogador desta aba
   */
  constructor(scene, colorHex, name, isLocal) {
    this.scene = scene;
    this.name = name;
    this.colorHex = colorHex;
    this.isLocal = isLocal;
    this.hpShown = S.MAX_HP;
    this.alive = true;
    this.sink = 0;          // 0 = flutuando, 1 = afundado
    this.roll = 0;

    this.hullMat = new THREE.MeshStandardMaterial({
      color: colorHex, roughness: 0.55, metalness: 0.35,
      emissive: colorHex, emissiveIntensity: 0.06,
    });

    const g = new THREE.Group();
    this.group = g;

    const hull = new THREE.Mesh(geo.hull, this.hullMat);
    hull.position.y = 0.35;
    hull.castShadow = true;
    g.add(hull);

    // proa: cone de 4 lados girado para apontar em +Z
    const bow = new THREE.Mesh(geo.bow, this.hullMat);
    bow.rotation.x = Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.position.set(0, 0.35, S.HULL_LENGTH / 2 + 2.1);
    bow.castShadow = true;
    g.add(bow);

    // quilha arredondada por baixo: tira o aspecto de "caixa flutuando"
    const keel = new THREE.Mesh(geo.keel, this.hullMat);
    keel.rotation.x = Math.PI / 2;
    keel.position.y = -0.95;
    g.add(keel);

    // popa arredondada
    const stern = new THREE.Mesh(geo.stern, this.hullMat);
    stern.rotation.x = Math.PI / 2;
    stern.position.set(0, 0.35, -S.HULL_LENGTH / 2 - 0.6);
    stern.castShadow = true;
    g.add(stern);

    const stripe = new THREE.Mesh(geo.stripe, matDark);
    stripe.position.y = -0.62;
    g.add(stripe);

    // faixa de vigias iluminadas nos dois bordos
    for (const side of [-1, 1]) {
      const ph = new THREE.Mesh(
        new THREE.PlaneGeometry(S.HULL_LENGTH * 0.72, 1.0),
        matPorthole
      );
      ph.position.set(side * (S.HULL_WIDTH / 2 + 0.02), 0.75, 0);
      ph.rotation.y = side * Math.PI / 2;
      g.add(ph);
    }

    const deck = new THREE.Mesh(geo.deck, matDeck);
    deck.position.y = 2.0;
    deck.receiveShadow = true;
    g.add(deck);

    const tower = new THREE.Mesh(geo.tower, matSteel);
    tower.position.set(0, 3.5, -1.6);
    tower.castShadow = true;
    g.add(tower);

    // segundo andar da superestrutura
    const tier2 = new THREE.Mesh(geo.tier2, matSteel);
    tier2.position.set(0, 5.5, -1.6);
    tier2.castShadow = true;
    g.add(tier2);

    const bridge = new THREE.Mesh(geo.bridge, matDark);
    bridge.position.set(0, 6.5, -1.6);
    g.add(bridge);

    // vidros da ponte de comando (frente e laterais)
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(S.HULL_WIDTH * 0.47, 0.7, S.HULL_LENGTH * 0.155),
      matGlass
    );
    glass.position.set(0, 6.55, -1.55);
    g.add(glass);

    const funnel = new THREE.Mesh(geo.funnel, matDark);
    funnel.position.set(0, 5.2, -3.6);
    funnel.castShadow = true;
    g.add(funnel);
    this.funnel = funnel;

    // faixa colorida no topo da chamine: identifica o jogador de longe
    const cap = new THREE.Mesh(geo.funnelCap, this.hullMat);
    cap.position.set(0, 6.35, -3.6);
    g.add(cap);

    const mast = new THREE.Mesh(geo.mast, matSteel);
    mast.position.set(0, 9.2, -1.6);
    g.add(mast);

    // verga transversal (o "T" classico do mastro)
    const yard = new THREE.Mesh(geo.yard, matSteel);
    yard.rotation.z = Math.PI / 2;
    yard.position.set(0, 10.4, -1.6);
    g.add(yard);

    // antena de radar: gira devagar o tempo todo, da vida ao modelo parado
    const radar = new THREE.Group();
    radar.position.set(0, 8.6, -1.6);
    radar.add(new THREE.Mesh(geo.radarHub, matSteel));
    const bar = new THREE.Mesh(geo.radarBar, matRail);
    bar.position.y = 0.3;
    radar.add(bar);
    g.add(radar);
    this.radar = radar;

    // baleeiras (botes salva-vidas) presas nos bordos
    for (const side of [-1, 1]) {
      const boat = new THREE.Mesh(geo.boat, matBoat);
      boat.rotation.x = Math.PI / 2;
      boat.position.set(side * S.HULL_WIDTH * 0.34, 3.0, -4.9);
      boat.castShadow = true;
      g.add(boat);
    }

    // corrimao do convés: dois trilhos + postes espacados
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(geo.railLong, matRail);
      rail.position.set(side * S.HULL_WIDTH * 0.43, 2.55, 0);
      g.add(rail);
      for (let i = -3; i <= 3; i++) {
        const post = new THREE.Mesh(geo.railPost, matRail);
        post.position.set(side * S.HULL_WIDTH * 0.43, 2.55, i * (S.HULL_LENGTH * 0.11));
        g.add(post);
      }
    }

    const flag = new THREE.Mesh(
      geo.flag,
      new THREE.MeshStandardMaterial({ color: colorHex, side: THREE.DoubleSide, roughness: 0.9, emissive: colorHex, emissiveIntensity: 0.25 })
    );
    flag.position.set(0.95, 10.6, -1.6);
    g.add(flag);
    this.flag = flag;

    // ---- torre giratoria (segue a mira do jogador) ----
    const turret = new THREE.Group();
    turret.position.set(0, 2.4, 1.9);
    const tBase = new THREE.Mesh(geo.turretB, matSteel);
    tBase.castShadow = true;
    turret.add(tBase);
    const barrel = new THREE.Mesh(geo.barrel, matDark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.35, 2.6);
    turret.add(barrel);
    this.barrel = barrel;
    g.add(turret);
    this.turret = turret;

    // ---- duas torres secundarias (proa e popa) ----
    // Sao decorativas: acompanham a torre principal, mas nao disparam. Existem
    // para o navio ler como "navio de guerra" e nao como bloco com um cano.
    this.secondaries = [];
    for (const z of [S.HULL_LENGTH * 0.30, -S.HULL_LENGTH * 0.34]) {
      const sec = new THREE.Group();
      sec.position.set(0, 2.55, z);
      const sb = new THREE.Mesh(geo.secBase, matSteel);
      sb.castShadow = true;
      sec.add(sb);
      const bar2 = new THREE.Mesh(geo.secBarrel, matDark);
      bar2.rotation.x = Math.PI / 2;
      bar2.position.set(0, 0.22, 1.5);
      sec.add(bar2);
      g.add(sec);
      this.secondaries.push(sec);
    }

    // ---- placa de nome (sprite com CanvasTexture) ----
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    this.nameCtx = canvas.getContext('2d');
    this.colorCss = '#' + colorHex.toString(16).padStart(6, '0');
    drawNameplate(this.nameCtx, name, S.MAX_HP, this.colorCss, true);
    this.nameTex = new THREE.CanvasTexture(canvas);
    this.nameTex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.nameTex, transparent: true, depthTest: false, depthWrite: false, fog: false,
    }));
    sprite.scale.set(16, 3, 1);
    sprite.position.y = 13.5;
    sprite.renderOrder = 10;
    g.add(sprite);
    this.sprite = sprite;

    // o navio local nao precisa da propria placa atrapalhando a mira
    if (isLocal) sprite.visible = false;

    scene.add(g);
  }

  /** Atualiza a textura da placa apenas quando a vida muda de verdade. */
  setHp(hp, alive) {
    const bucket = Math.round(hp / 4);
    if (bucket === this.hpBucket && alive === this.alive) return;
    this.hpBucket = bucket;
    this.alive = alive;
    drawNameplate(this.nameCtx, this.name, hp, this.colorCss, alive);
    this.nameTex.needsUpdate = true;
  }

  /**
   * Aplica o estado (ja interpolado ou predito) e o balanco das ondas.
   * `dt` e usado para suavizar rolagem/afundamento.
   */
  apply(state, clock, dt) {
    const g = this.group;
    g.position.x = state.x;
    g.position.z = state.z;
    g.rotation.y = state.yaw;

    // afundar/emergir suavemente
    const targetSink = state.alive ? 0 : 1;
    this.sink += clamp(targetSink - this.sink, -dt * 1.6, dt * 0.6);

    const wave = waveHeight(state.x, state.z, clock);
    g.position.y = wave * 0.8 - this.sink * 12;

    // adernar: proa sobe/desce com a onda e o casco inclina na curva
    const ahead = waveHeight(state.x + Math.sin(state.yaw) * 6, state.z + Math.cos(state.yaw) * 6, clock);
    const pitch = clamp((ahead - wave) * 0.09, -0.14, 0.14);
    const targetRoll = clamp(-(state.rudder || 0) * (Math.abs(state.speed || 0) / S.MAX_SPEED) * 0.28, -0.3, 0.3);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 4);

    g.rotation.x = pitch + this.sink * 0.9;
    g.rotation.z = this.roll + Math.sin(clock * 0.9 + state.x * 0.05) * 0.02;

    // bandeira tremulando
    this.flag.rotation.y = Math.sin(clock * 3.2) * 0.35;

    // radar varrendo o horizonte (uma volta a cada ~7 s)
    if (this.radar) this.radar.rotation.y = clock * 0.9;

    // torre segue a mira (angulo local = mundo - casco)
    if (state.turretYaw != null) {
      const local = state.turretYaw - state.yaw;
      this.turret.rotation.y = lerpAngle(this.turret.rotation.y, local, Math.min(1, dt * 12));
      // as secundarias seguem mais devagar: da sensacao de massa
      for (const sec of this.secondaries) {
        sec.rotation.y = lerpAngle(sec.rotation.y, local, Math.min(1, dt * 4));
      }
    }
    // elevacao do canhao
    if (state.aimPitch != null) {
      this.barrel.rotation.x = Math.PI / 2 - state.aimPitch;
    }

    this.sprite.visible = !this.isLocal && state.alive;
  }

  dispose() {
    this.scene.remove(this.group);
    this.hullMat.dispose();
    this.nameTex.dispose();
    this.sprite.material.dispose();
    this.flag.material.dispose();
  }
}
