// =============================================================================
//  INPUT - teclado, mouse e Pointer Lock.
//
//  O cliente NUNCA manda posicao: manda apenas intencao (acelerador, leme,
//  turbina, angulo de mira). O servidor decide o resto.
// =============================================================================

import { CONFIG } from './config.js';
import { clamp } from './shared.js';
import { settings } from './settings.js';

const C = CONFIG.CAMERA;

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} hooks onBroadside, onScoreboard(bool), onChatToggle,
   *                       onPause(bool), onMute, onLockError
   */
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.hooks = hooks || {};
    this.keys = new Set();
    this.mouseDown = false;
    this.locked = false;
    this.chatOpen = false;
    this.enabled = false;       // so vale depois de entrar na partida
    this.lockErrorShown = false;

    this.camYaw = 0;
    this.camPitch = 0.18;

    this._bind();
  }

  _bind() {
    const stopKeys = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

    window.addEventListener('keydown', (e) => {
      // Se o foco esta num campo de texto (apelido ou chat), o teclado pertence
      // a ele: nada de preventDefault e nada de mover o navio. O envio da
      // mensagem acontece pelo submit do formulario (Enter nativo).
      const tgt = e.target;
      const typing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA');
      if (typing) {
        if (this.chatOpen && e.code === 'Escape') {
          this.hooks.onChatToggle && this.hooks.onChatToggle('close');
        }
        return;
      }

      if (stopKeys.has(e.code)) e.preventDefault();
      if (!this.enabled) return;

      if (e.repeat) {
        this.keys.add(e.code);
        return;
      }
      this.keys.add(e.code);

      switch (e.code) {
        case 'Space':
          this.hooks.onBroadside && this.hooks.onBroadside();
          break;
        case 'Tab':
          this.hooks.onScoreboard && this.hooks.onScoreboard(true);
          break;
        case 'Enter':
        case 'NumpadEnter':
          this.hooks.onChatToggle && this.hooks.onChatToggle('open');
          break;
        case 'KeyM':
          this.hooks.onMute && this.hooks.onMute();
          break;
        case 'KeyC':
          this.hooks.onRecenter && this.hooks.onRecenter();
          break;
        default:
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.hooks.onScoreboard && this.hooks.onScoreboard(false);
    });

    // se a aba perde o foco, solta todas as teclas (senao o navio fica preso)
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.mouseDown = true;
      if (!this.locked) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.chatOpen) return;
      // fora do pointer lock so giramos com o botao pressionado (fallback)
      if (!this.locked && !this.mouseDown) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      // Sensibilidade e inversao de eixo sao preferencias do jogador; o sinal
      // -1/+1 troca o lado para quem joga com o eixo invertido (estilo aviao).
      const sens = settings.get('sensitivity');
      const sx = settings.get('invertX') ? -1 : 1;
      const sy = settings.get('invertY') ? -1 : 1;
      this.camYaw -= dx * sens * sx;
      this.camPitch = clamp(this.camPitch - dy * sens * sy, C.MIN_PITCH, C.MAX_PITCH);
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.mouseDown = false; }
      // Esc solta o mouse -> mostramos a tela de pausa
      if (this.enabled) this.hooks.onPause && this.hooks.onPause(!this.locked);
    });

    document.addEventListener('pointerlockerror', () => this._lockError());
  }

  /**
   * A dica de mouse aparece UMA vez por sessao: o navegador pode recusar o
   * Pointer Lock varias vezes seguidas e repetir a mensagem poluiria o HUD.
   */
  _lockError() {
    if (this.lockErrorShown) return;
    this.lockErrorShown = true;
    this.hooks.onLockError && this.hooks.onLockError();
  }

  /** Pede o Pointer Lock tratando navegadores que devolvem Promise. */
  requestLock() {
    if (!this.canvas.requestPointerLock) {
      this._lockError();
      return;
    }
    try {
      const r = this.canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => this._lockError());
    } catch (err) {
      this._lockError();
    }
  }

  // ------------------------------------------------------------------ eixos

  get throttle() {
    if (!this.enabled || this.chatOpen) return 0;
    let v = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) v += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) v -= 1;
    return v;
  }

  get rudder() {
    if (!this.enabled || this.chatOpen) return 0;
    let v = 0;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) v += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) v -= 1;
    return v;
  }

  get boost() {
    if (!this.enabled || this.chatOpen) return false;
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  get firing() {
    return this.enabled && !this.chatOpen && this.mouseDown;
  }

  /** Giro da camera por teclado (fallback quando o Pointer Lock e negado). */
  applyKeyboardLook(dt) {
    if (!this.enabled || this.chatOpen) return;
    // o teclado respeita a mesma inversao configurada para o mouse
    const sx = settings.get('invertX') ? -1 : 1;
    const sy = settings.get('invertY') ? -1 : 1;
    if (this.keys.has('KeyQ')) this.camYaw += 1.6 * dt * sx;
    if (this.keys.has('KeyE')) this.camYaw -= 1.6 * dt * sx;
    if (this.keys.has('KeyR')) this.camPitch = clamp(this.camPitch + 0.5 * dt * sy, C.MIN_PITCH, C.MAX_PITCH);
    if (this.keys.has('KeyF')) this.camPitch = clamp(this.camPitch - 0.5 * dt * sy, C.MIN_PITCH, C.MAX_PITCH);
  }
}
