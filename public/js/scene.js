// =============================================================================
//  SCENE - renderer, camera, luzes, mar, ilhas, tempestade e particulas.
//
//  Regra de otimizacao: geometrias e materiais sao criados UMA vez e
//  reaproveitados; tudo que se repete muito (ilhas, recifes, granadas)
//  usa InstancedMesh ou pool de objetos para manter as draw calls baixas.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { settings } from './settings.js';
import { mulberry32, waveHeight } from './shared.js';

// -----------------------------------------------------------------------------
//  Texturas procedurais (CanvasTexture) - zero arquivos externos
// -----------------------------------------------------------------------------

/** Ponto suave usado pelas particulas. */
function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Espuma/ruido do mar, repetida no plano da agua. */
function makeWaterTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#2f7099';
  g.fillRect(0, 0, S, S);
  const rnd = mulberry32(7);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 2.2;
    g.fillStyle = `rgba(170,225,255,${0.05 + rnd() * 0.18})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 120; i++) {
    const y = rnd() * S;
    g.strokeStyle = `rgba(180,225,255,${0.02 + rnd() * 0.05})`;
    g.lineWidth = 0.6 + rnd();
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(S * 0.3, y + rnd() * 12 - 6, S * 0.7, y + rnd() * 12 - 6, S, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(26, 26);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Gradiente de ceu (do horizonte quente ao zenite azul). */
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.00, '#0a2038');
  grd.addColorStop(0.42, '#2f6f9e');
  grd.addColorStop(0.55, '#7db3cf');
  grd.addColorStop(0.63, '#d8b98a');
  grd.addColorStop(1.00, '#173049');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Listras verticais da parede de tempestade que fecha a arena. */
function makeStormTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  const rnd = mulberry32(99);
  for (let i = 0; i < 60; i++) {
    const x = rnd() * 128;
    const w = 1 + rnd() * 4;
    g.fillStyle = `rgba(120,200,255,${0.05 + rnd() * 0.18})`;
    g.fillRect(x, 0, w, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(50, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// -----------------------------------------------------------------------------
//  Sistema de particulas (um unico THREE.Points para tudo)
// -----------------------------------------------------------------------------

class Particles {
  constructor(max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));

    // Blending aditivo: quando a cor chega a preto a particula some sozinha,
    // o que evita precisar de alpha por vertice (que exigiria shader custom).
    const mat = new THREE.PointsMaterial({
      size: 2.2,
      map: makeDotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, life, drag = 1.2) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.base[i3] = r; this.base[i3 + 1] = g; this.base[i3 + 2] = b;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = drag;
  }

  update(dt) {
    const { pos, col, base, vel, life, maxLife, drag } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      const i3 = i * 3;
      life[i] -= dt;
      if (life[i] <= 0) {
        col[i3] = col[i3 + 1] = col[i3 + 2] = 0;
        continue;
      }
      const damp = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= damp;
      vel[i3 + 1] = vel[i3 + 1] * damp - 9 * dt;
      vel[i3 + 2] *= damp;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const k = life[i] / maxLife[i];
      col[i3] = base[i3] * k;
      col[i3 + 1] = base[i3 + 1] * k;
      col[i3 + 2] = base[i3 + 2] * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// -----------------------------------------------------------------------------
//  Mundo
// -----------------------------------------------------------------------------

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.applyQuality();          // resolucao + sombras vem das preferencias
    settings.onChange(() => this.applyQuality());
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x8fbdd6, 150, 700);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 2200);
    this.camera.position.set(0, 30, -50);

    this.buildSky();
    this.buildLights();
    this.buildOcean();
    this.buildStormWall();

    this.particles = new Particles(900);
    this.scene.add(this.particles.points);

    // pool de granadas (esferas emissivas reutilizadas)
    this.shellGeo = new THREE.SphereGeometry(0.65, 8, 6);
    this.shellMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
    this.shellPool = [];
    this.shellsGroup = new THREE.Group();
    this.scene.add(this.shellsGroup);

    // marcador do ponto de impacto previsto (mira balistica)
    this.aimMarker = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 2.6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })
    );
    this.aimMarker.rotation.x = -Math.PI / 2;
    this.aimMarker.renderOrder = 3;
    this.scene.add(this.aimMarker);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    this._tmpMatrix = new THREE.Matrix4();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpEuler = new THREE.Euler();
    this._tmpVec = new THREE.Vector3();
    this._tmpScale = new THREE.Vector3();
    this._normalsTick = 0;
  }

  // --------------------------------------------------------------------- ceu
  buildSky() {
    const geo = new THREE.SphereGeometry(1100, 24, 16);
    const mat = new THREE.MeshBasicMaterial({
      map: makeSkyTexture(),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);

    // sol como esfera emissiva simples
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(26, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3cf, fog: false })
    );
    sun.position.set(-620, 210, 540);
    this.scene.add(sun);
  }

  // ------------------------------------------------------------------- luzes
  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9fd0ff, 0x123048, 1.15));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.28));

    const sun = new THREE.DirectionalLight(0xfff0d0, 2.5);
    sun.position.set(-90, 120, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // Sombra em area pequena que ACOMPANHA o jogador: com 2048px cobrindo
    // apenas ~150 unidades a sombra sai nitida, em vez de borrada em 480.
    const d = 78;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 340;
    sun.shadow.bias = -0.0009;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  // --------------------------------------------------------------------- mar
  buildOcean() {
    const size = CONFIG.MAP.ARENA_RADIUS * 2.8;
    const seg = 56;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);           // ja nasce deitado no plano XZ
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9fd4f0,
      map: makeWaterTexture(),
      roughness: 0.38,
      metalness: 0.10,
      transparent: false,
    });
    this.ocean = new THREE.Mesh(geo, mat);
    this.ocean.receiveShadow = true;
    this.scene.add(this.ocean);
    this.oceanGeo = geo;
    this.oceanBase = Float32Array.from(geo.attributes.position.array);
  }

  // -------------------------------------------------------------- tempestade
  buildStormWall() {
    const R = CONFIG.MAP.ARENA_RADIUS;
    const geo = new THREE.CylinderGeometry(R, R, 34, 72, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      map: makeStormTexture(),
      color: 0x6fd8ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.30,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.storm = new THREE.Mesh(geo, mat);
    this.storm.position.y = 15;
    this.scene.add(this.storm);
    this.stormMat = mat;
  }

  // ------------------------------------------------------------------- ilhas
  /**
   * Constroi as ilhas com InstancedMesh: 14 rochas + 14 praias em apenas
   * 2 draw calls, mesmo que aumentemos ISLAND_COUNT depois.
   */
  buildIslands(islands) {
    const n = islands.length;

    const rockGeo = new THREE.ConeGeometry(1, 1, 7, 1);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a5d4a, roughness: 0.95, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, n);
    rocks.castShadow = true;
    rocks.receiveShadow = true;

    const sandGeo = new THREE.CylinderGeometry(1, 1.16, 1, 14, 1);
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xd8c391, roughness: 1.0 });
    const sand = new THREE.InstancedMesh(sandGeo, sandMat, n);
    sand.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      const isl = islands[i];
      e.set(0, isl.rot, 0);
      q.setFromEuler(e);

      // rocha: cone com base afundada um pouco na agua
      p.set(isl.x, isl.h / 2 - 1.2, isl.z);
      s.set(isl.r * 0.94, isl.h, isl.r * 0.94);
      m.compose(p, q, s);
      rocks.setMatrixAt(i, m);

      // praia: cilindro baixo do tamanho do raio de colisao
      p.set(isl.x, 0.5, isl.z);
      s.set(isl.r, 2.4, isl.r);
      m.compose(p, q, s);
      sand.setMatrixAt(i, m);
    }
    rocks.instanceMatrix.needsUpdate = true;
    sand.instanceMatrix.needsUpdate = true;
    this.scene.add(rocks, sand);

    this.buildReefs();
  }

  /** Recifes decorativos na borda, tambem em uma unica draw call. */
  buildReefs() {
    const M = CONFIG.MAP;
    const n = M.REEF_COUNT;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a4a58, roughness: 0.95, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.castShadow = true;

    const rnd = mulberry32(M.SEED + 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rnd() * 0.05;
      const rad = M.ARENA_RADIUS + 4 + rnd() * 22;
      const sc = 2 + rnd() * 5;
      e.set(rnd() * 3, rnd() * 3, rnd() * 3);
      q.setFromEuler(e);
      p.set(Math.cos(ang) * rad, -sc * 0.35 + rnd() * 1.5, Math.sin(ang) * rad);
      s.set(sc, sc * (0.7 + rnd() * 0.8), sc);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- granadas
  /** Reaproveita esferas do pool para desenhar os projeteis do snapshot. */
  syncShells(shellMap) {
    let i = 0;
    for (const s of shellMap.values()) {
      let mesh = this.shellPool[i];
      if (!mesh) {
        mesh = new THREE.Mesh(this.shellGeo, this.shellMat);
        this.shellPool.push(mesh);
        this.shellsGroup.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(s.x, s.y, s.z);
      i++;
      // rastro de fumaca
      if (Math.random() < 0.55) {
        this.particles.spawn(s.x, s.y, s.z, 0, 1.2, 0, 0.35, 0.32, 0.3, 0.45, 2.2);
      }
    }
    for (; i < this.shellPool.length; i++) this.shellPool[i].visible = false;
  }

  // ------------------------------------------------------------------ efeitos
  explosion(x, y, z, big = false) {
    const n = big ? 46 : 26;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (big ? 16 : 10) * (0.3 + Math.random());
      this.particles.spawn(
        x, y + 0.4, z,
        Math.cos(a) * sp, 5 + Math.random() * (big ? 16 : 10), Math.sin(a) * sp,
        1.0, 0.45 + Math.random() * 0.4, 0.12,
        0.5 + Math.random() * 0.6, 1.5
      );
    }
  }

  splash(x, y, z) {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 5 * (0.3 + Math.random());
      this.particles.spawn(
        x, Math.max(0.2, y), z,
        Math.cos(a) * sp, 6 + Math.random() * 9, Math.sin(a) * sp,
        0.55, 0.8, 1.0,
        0.55 + Math.random() * 0.5, 1.4
      );
    }
  }

  muzzleFlash(x, y, z, dirX, dirZ) {
    for (let i = 0; i < 12; i++) {
      this.particles.spawn(
        x + dirX * 3, y, z + dirZ * 3,
        dirX * (8 + Math.random() * 10) + (Math.random() - 0.5) * 4,
        1 + Math.random() * 3,
        dirZ * (8 + Math.random() * 10) + (Math.random() - 0.5) * 4,
        1.0, 0.85, 0.4,
        0.22 + Math.random() * 0.18, 3.0
      );
    }
  }

  /** Esteira de espuma atras dos navios em movimento. */
  wake(x, y, z, dirX, dirZ, strength) {
    if (Math.random() > strength) return;
    const spread = (Math.random() - 0.5) * 4;
    this.particles.spawn(
      x - dirX * 6 + spread, y + 0.2, z - dirZ * 6 + spread,
      -dirX * 2 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), -dirZ * 2 + (Math.random() - 0.5) * 2,
      0.55, 0.7, 0.8,
      0.7 + Math.random() * 0.5, 1.6
    );
  }

  sparkRing(x, y, z, r, g, b) {
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      this.particles.spawn(x, y, z, Math.cos(a) * 9, 4 + Math.random() * 4, Math.sin(a) * 9, r, g, b, 0.8, 1.1);
    }
  }

  /** Posiciona o anel amarelo no ponto de queda previsto da granada. */
  setAimMarker(x, z, visible) {
    this.aimMarker.visible = visible;
    if (visible) this.aimMarker.position.set(x, 0.35, z);
  }

  // -------------------------------------------------------------------- loop
  update(dt, clock, focus) {
    // --- ondas: desloca os vertices do mar pela formula compartilhada ---
    const arr = this.oceanGeo.attributes.position.array;
    const base = this.oceanBase;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] = waveHeight(base[i], base[i + 2], clock);
    }
    this.oceanGeo.attributes.position.needsUpdate = true;
    // recalcular normais e caro: fazemos em quadros alternados
    if ((this._normalsTick++ & 1) === 0) this.oceanGeo.computeVertexNormals();

    // textura da agua rolando devagar (sensacao de correnteza)
    this.ocean.material.map.offset.x = clock * 0.004;
    this.ocean.material.map.offset.y = clock * 0.0025;
    this.stormMat.map.offset.x = clock * 0.05;

    // sombra segue o jogador para manter resolucao alta
    if (focus) {
      this.sun.position.set(focus.x - 90, 120, focus.z + 80);
      this.sun.target.position.set(focus.x, 0, focus.z);
      this.sun.target.updateMatrixWorld();
      this.sky.position.set(focus.x, 0, focus.z);
    }

    this.particles.update(dt);
  }

  /**
   * Aplica as opcoes graficas. `resolution` limita o devicePixelRatio: 1 deixa
   * a imagem mais serrilhada mas dobra o FPS em telas Retina/4K.
   */
  applyQuality() {
    const cap = settings.get('resolution');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = settings.get('shadows');
    this.renderer.shadowMap.needsUpdate = true;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.get('resolution')));
    this.renderer.setSize(w, h);
  }
}
