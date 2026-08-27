// =============================================================================
//  SETTINGS - preferencias do jogador, persistidas em localStorage.
//
//  Nada aqui vai para o servidor: sao ajustes puramente locais (conforto de
//  controle, volume, qualidade grafica). O servidor continua sendo a verdade
//  sobre o jogo; isto so muda como ESTE navegador le a entrada e desenha.
//
//  Um unico objeto `settings` e compartilhado por input/audio/scene. Quem
//  precisa reagir a uma mudanca se inscreve em `settings.onChange()`.
// =============================================================================

import { CONFIG } from './config.js';

const KEY = 'armada.settings.v1';

/** Valores de fabrica. Toda chave nova precisa aparecer aqui. */
export const DEFAULTS = {
  invertX: false,          // inverte o eixo horizontal do mouse
  invertY: false,          // inverte o eixo vertical do mouse
  sensitivity: CONFIG.CAMERA.SENSITIVITY,
  masterVolume: 0.35,      // volume geral (0 = mudo)
  sfxVolume: 1.0,          // tiros, impactos, explosoes
  engineVolume: 1.0,       // ronco do motor do proprio navio
  muted: false,
  shadows: true,           // sombras projetadas (custa FPS)
  resolution: 1.75,        // teto do devicePixelRatio
  showFps: true,
  cameraSmoothing: 12,     // maior = camera mais colada no navio
};

/** Limites de cada chave numerica: usados pelos sliders e pela validacao. */
export const RANGES = {
  sensitivity:     { min: 0.0004, max: 0.008, step: 0.0002 },
  masterVolume:    { min: 0, max: 1, step: 0.05 },
  sfxVolume:       { min: 0, max: 1, step: 0.05 },
  engineVolume:    { min: 0, max: 1, step: 0.05 },
  resolution:      { min: 0.5, max: 2, step: 0.25 },
  cameraSmoothing: { min: 4, max: 30, step: 1 },
};

function coerce(key, value) {
  const def = DEFAULTS[key];
  if (typeof def === 'boolean') return !!value;
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  const r = RANGES[key];
  return r ? Math.min(r.max, Math.max(r.min, n)) : n;
}

class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    this.listeners = new Set();
    this.load();
  }

  load() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (err) {
      return;            // modo privado / storage bloqueado: segue nos padroes
    }
    if (!raw) return;
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch (err) {
      return;            // JSON corrompido: ignora e mantem os padroes
    }
    if (!saved || typeof saved !== 'object') return;
    for (const key of Object.keys(DEFAULTS)) {
      if (key in saved) this.values[key] = coerce(key, saved[key]);
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch (err) {
      // storage cheio ou bloqueado: as preferencias valem so nesta sessao
    }
  }

  get(key) { return this.values[key]; }

  /** Grava uma chave, persiste e avisa os inscritos. */
  set(key, value) {
    if (!(key in DEFAULTS)) return;
    const next = coerce(key, value);
    if (this.values[key] === next) return;
    this.values[key] = next;
    this.save();
    this.emit(key);
  }

  reset() {
    this.values = { ...DEFAULTS };
    this.save();
    this.emit(null);      // null = "tudo mudou"
  }

  /** @returns {() => void} funcao para cancelar a inscricao */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(key) {
    for (const fn of this.listeners) fn(key, this.values);
  }

  /**
   * Volume efetivo de uma categoria, ja considerando o mudo e o volume geral.
   * @param {'sfx'|'engine'} kind
   */
  volumeOf(kind) {
    if (this.values.muted) return 0;
    const cat = kind === 'engine' ? this.values.engineVolume : this.values.sfxVolume;
    return this.values.masterVolume * cat;
  }
}

export const settings = new Settings();
