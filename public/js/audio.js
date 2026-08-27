// =============================================================================
//  AUDIO - 100% procedural via Web Audio API (osciladores + ruido gerado).
//  Nenhum arquivo .mp3/.wav: nada para dar 404.
//
//  O AudioContext so e criado depois de um clique do usuario (exigencia dos
//  navegadores para permitir som).
// =============================================================================

import { settings } from './settings.js';

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = settings.get('muted');
    this.noiseBuffer = null;
    this.engine = null;
  }

  /** Chamado no clique de "Entrar na partida". */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;                       // navegador sem Web Audio: segue sem som
    try {
      this.ctx = new AC();
    } catch (err) {
      this.ctx = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterTarget();
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoise(1.0);
    this.startEngine();
    // qualquer mudanca no painel de opcoes reflete no som na hora
    settings.onChange(() => this.applySettings());
  }

  /** Ganho do barramento principal: volume geral, zerado se estiver mudo. */
  masterTarget() {
    return settings.get('muted') ? 0 : settings.get('masterVolume');
  }

  /** Reaplica volumes vindos do painel de opcoes (rampa curta, sem estalo). */
  applySettings() {
    this.muted = settings.get('muted');
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.masterTarget(), this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    settings.set('muted', !settings.get('muted'));
    this.muted = settings.get('muted');
    this.applySettings();
    return this.muted;
  }

  /** Buffer de ruido branco reutilizado por todos os efeitos percussivos. */
  makeNoise(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  // ------------------------------------------------------------------ efeitos

  /** Tiro de canhao: estouro de ruido filtrado + soco grave de seno. */
  cannon(volume = 1) {
    if (!this.ctx || this.muted) return;
    volume *= settings.get('sfxVolume');
    const t = this.ctx.currentTime;

    const noise = this.noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9 * volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    noise.connect(lp).connect(g).connect(this.master);
    noise.start(t);
    noise.stop(t + 0.45);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.8 * volume, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.36);
  }

  /** Granada caindo na agua. */
  splash(volume = 1) {
    if (!this.ctx || this.muted || volume < 0.03) return;
    volume *= settings.get('sfxVolume');
    const t = this.ctx.currentTime;
    const noise = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1500, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.3);
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5 * volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    noise.connect(bp).connect(g).connect(this.master);
    noise.start(t);
    noise.stop(t + 0.36);
  }

  /** Impacto no casco: metalico e curto. */
  hit(volume = 1) {
    if (!this.ctx || this.muted || volume < 0.03) return;
    volume *= settings.get('sfxVolume');
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.45 * volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.24);

    const noise = this.noiseSource();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.35 * volume, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    noise.connect(hp).connect(ng).connect(this.master);
    noise.start(t);
    noise.stop(t + 0.14);
  }

  /** Navio afundando: explosao longa e grave. */
  explosion(volume = 1) {
    if (!this.ctx || this.muted || volume < 0.03) return;
    volume *= settings.get('sfxVolume');
    const t = this.ctx.currentTime;
    const noise = this.noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 1.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(1.0 * volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    noise.connect(lp).connect(g).connect(this.master);
    noise.start(t);
    noise.stop(t + 1.25);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(24, t + 0.9);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.9 * volume, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 1.0);
  }

  /** Sirene curta ao renascer. */
  respawn() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.linearRampToValueAtTime(660, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.52);
  }

  /** Fanfarra de fim de partida (arpejo maior). */
  fanfare() {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    [392, 494, 587, 784].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      const t = t0 + i * 0.13;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.24, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  }

  click() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 720;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  // ------------------------------------------------------------------- motor

  /** Motor: dente de serra grave + ruido de agua, ambos modulados pela velocidade. */
  startEngine() {
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 42;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;

    osc.connect(lp).connect(gain).connect(this.master);
    osc.start(t);

    const noise = this.noiseSource();
    const nbp = this.ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 500;
    nbp.Q.value = 0.6;
    const ngain = this.ctx.createGain();
    ngain.gain.value = 0.0;
    noise.connect(nbp).connect(ngain).connect(this.master);
    noise.start(t);

    this.engine = { osc, gain, ngain, lp };
  }

  /** Chamado a cada quadro com a velocidade atual do navio local. */
  setEngine(speedAbs, maxSpeed) {
    if (!this.ctx || !this.engine) return;
    const k = Math.min(1, speedAbs / maxSpeed);
    const ev = settings.get('engineVolume');
    const t = this.ctx.currentTime;
    this.engine.osc.frequency.setTargetAtTime(38 + k * 46, t, 0.15);
    this.engine.lp.frequency.setTargetAtTime(200 + k * 500, t, 0.15);
    this.engine.gain.gain.setTargetAtTime((0.055 + k * 0.10) * ev, t, 0.2);
    this.engine.ngain.gain.setTargetAtTime(k * 0.05 * ev, t, 0.2);
  }

  /** Volume por distancia: efeitos longe quase nao aparecem. */
  static distanceVolume(dist) {
    return Math.max(0, Math.min(1, 1 / (1 + dist / 55)));
  }
}
