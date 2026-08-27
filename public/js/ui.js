// =============================================================================
//  UI - telas (inicial, pausa, fim, reconexao), HUD, placar, chat e killfeed.
//  Tudo em CSS puro; nenhuma fonte ou imagem externa.
// =============================================================================

import { CONFIG } from './config.js';
import { clamp } from './shared.js';
import { settings, RANGES } from './settings.js';

const $ = (id) => document.getElementById(id);
const hexCss = (hex) => '#' + hex.toString(16).padStart(6, '0');

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'),
      timer: $('matchTimer'),
      topScores: $('topScores'),
      fps: $('fps'),
      ping: $('ping'),
      muteTag: $('muteTag'),
      hpFill: $('hpFill'), hpText: $('hpText'),
      stFill: $('stFill'), stText: $('stText'),
      speed: $('speedText'), score: $('scoreText'),
      cdMain: $('cdMain'), cdBroad: $('cdBroad'),
      wMain: $('wMain'), wBroad: $('wBroad'),
      killfeed: $('killfeed'),
      chatLog: $('chatLog'),
      chatForm: $('chatForm'), chatInput: $('chatInput'),
      centerMsg: $('centerMsg'),
      damage: $('damageFlash'),
      scoreboard: $('scoreboard'), sbBody: $('sbBody'), sbMatch: $('sbMatch'),
      start: $('startScreen'), nick: $('nickInput'), picker: $('colorPicker'),
      joinBtn: $('joinBtn'), startError: $('startError'),
      roomAddr: $('roomAddr'),
      end: $('endScreen'), podium: $('podium'), endBody: $('endBody'), endCountdown: $('endCountdown'),
      pause: $('pauseScreen'), resumeBtn: $('resumeBtn'),
      reconnect: $('reconnectScreen'),
      fatal: $('fatalScreen'), fatalMsg: $('fatalMsg'),
      settings: $('settingsScreen'), settingsBody: $('settingsBody'),
      settingsBtn: $('settingsBtn'), pauseSettingsBtn: $('pauseSettingsBtn'),
      settingsClose: $('settingsClose'), settingsReset: $('settingsReset'),
    };
    this.selectedColor = 0;
    this.colors = [];
    this.chatTimers = [];
    this.killTimers = [];
    this.damageTimer = 0;
    this.buildSettings();
  }

  // ----------------------------------------------------------------- opções

  /**
   * Descricao declarativa do painel. Cada linha vira um slider (se a chave tem
   * faixa em RANGES) ou um interruptor. Acrescentar uma opcao = uma linha aqui
   * mais o valor padrao em settings.js.
   */
  static SCHEMA = [
    { group: 'CONTROLES' },
    { key: 'invertX', label: 'Inverter eixo X', help: 'Mover o mouse para a direita gira a câmera para a esquerda.' },
    { key: 'invertY', label: 'Inverter eixo Y', help: 'Estilo simulador de voo: puxar para baixo levanta a mira.' },
    { key: 'sensitivity', label: 'Sensibilidade do mouse', fmt: (v) => (v * 1000).toFixed(1) },

    { group: 'SOM' },
    { key: 'muted', label: 'Mudo', help: 'Mesmo efeito da tecla M.' },
    { key: 'masterVolume', label: 'Volume geral', fmt: (v) => Math.round(v * 100) + '%' },
    { key: 'sfxVolume', label: 'Efeitos (tiros, impactos)', fmt: (v) => Math.round(v * 100) + '%' },
    { key: 'engineVolume', label: 'Motor do seu navio', fmt: (v) => Math.round(v * 100) + '%' },

    { group: 'VÍDEO' },
    { key: 'shadows', label: 'Sombras', help: 'Desligar melhora o FPS em máquinas fracas.' },
    { key: 'resolution', label: 'Resolução', help: 'Abaixo de 1 a imagem borra, mas o jogo acelera.', fmt: (v) => v.toFixed(2) + 'x' },
    { key: 'showFps', label: 'Mostrar FPS e ping' },

    { group: 'CÂMERA' },
    { key: 'cameraSmoothing', label: 'Firmeza da câmera', help: 'Maior = mais colada no navio; menor = mais suave.', fmt: (v) => String(Math.round(v)) },
  ];

  /** Monta o painel uma vez e mantem os controles sincronizados. */
  buildSettings() {
    const body = this.el.settingsBody;
    if (!body) return;
    body.textContent = '';
    this.settingsSync = [];

    for (const item of UI.SCHEMA) {
      if (item.group) {
        const h = document.createElement('div');
        h.className = 'set-group';
        h.textContent = item.group;
        body.appendChild(h);
        continue;
      }

      const row = document.createElement('div');
      row.className = 'set-row';

      const label = document.createElement('div');
      label.className = 'set-label';
      label.textContent = item.label;
      if (item.help) {
        const help = document.createElement('span');
        help.className = 'set-help';
        help.textContent = item.help;
        label.appendChild(help);
      }
      row.appendChild(label);

      const range = RANGES[item.key];
      if (range) {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = range.min;
        input.max = range.max;
        input.step = range.step;
        const value = document.createElement('span');
        value.className = 'set-value';
        input.addEventListener('input', () => settings.set(item.key, input.value));
        row.append(input, value);
        this.settingsSync.push(() => {
          const v = settings.get(item.key);
          input.value = v;
          value.textContent = item.fmt ? item.fmt(v) : String(v);
        });
      } else {
        const toggle = document.createElement('div');
        toggle.className = 'set-toggle';
        toggle.setAttribute('role', 'switch');
        toggle.tabIndex = 0;
        const flip = () => settings.set(item.key, !settings.get(item.key));
        toggle.addEventListener('click', flip);
        toggle.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
        });
        row.append(toggle, document.createElement('span'));
        this.settingsSync.push(() => {
          const on = settings.get(item.key);
          toggle.classList.toggle('on', on);
          toggle.setAttribute('aria-checked', String(on));
        });
      }
      body.appendChild(row);
    }

    settings.onChange(() => this.syncSettings());
    this.syncSettings();

    this.el.settingsBtn.addEventListener('click', () => this.toggleSettings(true));
    this.el.pauseSettingsBtn.addEventListener('click', () => this.toggleSettings(true));
    this.el.settingsClose.addEventListener('click', () => this.toggleSettings(false));
    this.el.settingsReset.addEventListener('click', () => settings.reset());
  }

  syncSettings() {
    for (const fn of this.settingsSync) fn();
    // o painel manda no indicador de FPS/ping
    document.getElementById('stats').classList.toggle('hidden', !settings.get('showFps'));
    this.setMuted(settings.get('muted'));
  }

  toggleSettings(v) {
    this.el.settings.classList.toggle('hidden', !v);
  }

  settingsOpen() { return !this.el.settings.classList.contains('hidden'); }

  // ----------------------------------------------------------- tela inicial

  /** Monta os quadradinhos de cor; as ja usadas aparecem riscadas. */
  buildColorPicker(colors, taken) {
    this.colors = colors;
    const takenSet = new Set(taken || []);
    this.el.picker.textContent = '';
    // se a cor escolhida foi tomada, pula para a primeira livre
    if (takenSet.has(this.selectedColor)) {
      const free = colors.findIndex((_, i) => !takenSet.has(i));
      this.selectedColor = free >= 0 ? free : 0;
    }
    colors.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'swatch' + (i === this.selectedColor ? ' sel' : '') + (takenSet.has(i) ? ' taken' : '');
      d.style.background = hexCss(c.hex);
      d.title = c.name + (takenSet.has(i) ? ' (em uso)' : '');
      if (!takenSet.has(i)) {
        d.addEventListener('click', () => {
          this.selectedColor = i;
          this.buildColorPicker(this.colors, taken);
        });
      }
      this.el.picker.appendChild(d);
    });
  }

  setRoomAddress(urls) {
    const list = [location.origin, ...(urls || []).filter((u) => u !== location.origin)];
    this.el.roomAddr.textContent = list.slice(0, 3).join('    ou    ');
  }

  onJoin(cb) {
    const go = () => cb(this.el.nick.value, this.selectedColor);
    this.el.joinBtn.addEventListener('click', go);
    this.el.nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  onResume(cb) { this.el.resumeBtn.addEventListener('click', cb); }

  hideStart() { this.el.start.classList.add('hidden'); }
  showStart() { this.el.start.classList.remove('hidden'); }
  startError(msg) {
    this.el.startError.textContent = msg;
    this.el.startError.classList.remove('hidden');
  }
  setHudVisible(v) { this.el.hud.classList.toggle('hidden', !v); }

  fatal(msg) {
    this.el.fatalMsg.textContent = msg;
    this.el.fatal.classList.remove('hidden');
    this.el.start.classList.add('hidden');
  }

  // --------------------------------------------------------------------- HUD

  setStats(fps, ping) {
    this.el.fps.textContent = fps + ' FPS';
    this.el.ping.textContent = ping + ' ms';
  }

  setMuted(v) { this.el.muteTag.classList.toggle('hidden', !v); }


  /** me = entrada crua do snapshot referente ao jogador local. */
  setStatus(me) {
    const hp = clamp(me.h / CONFIG.SHIP.MAX_HP, 0, 1);
    this.el.hpFill.style.width = (hp * 100).toFixed(0) + '%';
    this.el.hpText.textContent = me.h;
    const st = clamp(me.st / CONFIG.SHIP.STAMINA_MAX, 0, 1);
    this.el.stFill.style.width = (st * 100).toFixed(0) + '%';
    this.el.stText.textContent = me.st;
    this.el.score.textContent = me.sc + ' pts';

    // cooldowns: barra cheia = pronto para atirar
    const m = 1 - clamp(me.cm / CONFIG.SHELL.MAIN_COOLDOWN, 0, 1);
    const b = 1 - clamp(me.cb / CONFIG.SHELL.BROADSIDE_COOLDOWN, 0, 1);
    this.el.cdMain.style.width = (m * 100).toFixed(0) + '%';
    this.el.cdBroad.style.width = (b * 100).toFixed(0) + '%';
    this.el.wMain.classList.toggle('ready', m >= 1);
    this.el.wBroad.classList.toggle('ready', b >= 1);
  }

  setSpeed(speed) {
    // 1 unidade/s ~ 1 no; arredondado para o HUD ficar legivel
    this.el.speed.textContent = Math.round(Math.abs(speed)) + (speed < -0.5 ? ' nós (ré)' : ' nós');
  }

  setTimer(seconds, state) {
    const s = Math.max(0, Math.ceil(seconds));
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    this.el.timer.textContent = state === 'ended' ? 'INTERVALO' : `${mm}:${ss}`;
    this.el.timer.classList.toggle('urgent', state === 'playing' && s <= 30);
  }

  /** Top 3 fixo no alto da tela. */
  setTopScores(players, myId) {
    const top = [...players].sort((a, b) => b.sc - a.sc).slice(0, 3);
    this.el.topScores.textContent = '';
    for (const p of top) {
      const d = document.createElement('div');
      d.className = 'tscore' + (p.i === myId ? ' me' : '');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = hexCss(this.colorOf(p.c));
      d.appendChild(dot);
      d.appendChild(document.createTextNode(`${p.n} ${p.sc}`));
      this.el.topScores.appendChild(d);
    }
  }

  colorOf(idx) {
    const c = this.colors[idx];
    return c ? c.hex : 0xffffff;
  }

  centerMessage(text) {
    if (!text) {
      this.el.centerMsg.classList.add('hidden');
      return;
    }
    this.el.centerMsg.textContent = text;
    this.el.centerMsg.classList.remove('hidden');
  }

  flashDamage() {
    const el = this.el.damage;
    el.classList.add('on');
    clearTimeout(this.damageTimer);
    this.damageTimer = setTimeout(() => el.classList.remove('on'), 60);
  }

  // ------------------------------------------------------------------ placar

  toggleScoreboard(v) { this.el.scoreboard.classList.toggle('hidden', !v); }

  setScoreboard(players, myId, matchNumber) {
    this.el.sbMatch.textContent = `partida #${matchNumber}`;
    const sorted = [...players].sort((a, b) => b.sc - a.sc || b.k - a.k || a.d - b.d);
    this.el.sbBody.textContent = '';
    sorted.forEach((p, i) => {
      const tr = document.createElement('tr');
      if (p.i === myId) tr.className = 'me';
      tr.appendChild(this.td(String(i + 1)));

      const nameTd = document.createElement('td');
      nameTd.className = 'nm';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = hexCss(this.colorOf(p.c));
      nameTd.appendChild(dot);
      nameTd.appendChild(document.createTextNode(p.n + (p.a ? '' : '  (afundado)')));
      tr.appendChild(nameTd);

      tr.appendChild(this.td(String(p.sc)));
      tr.appendChild(this.td(String(p.k)));
      tr.appendChild(this.td(String(p.d)));
      tr.appendChild(this.td(p.pg + ' ms'));
      this.el.sbBody.appendChild(tr);
    });
  }

  td(text) {
    const e = document.createElement('td');
    e.textContent = text;
    return e;
  }

  // -------------------------------------------------------------- fim de jogo

  showEnd(ranking, seconds) {
    this.el.end.classList.remove('hidden');
    this.el.endCountdown.textContent = `Próxima partida em ${Math.max(0, Math.ceil(seconds))}s`;
    if (this._endSignature === JSON.stringify(ranking)) return; // nao redesenha a cada tick
    this._endSignature = JSON.stringify(ranking);

    const order = [1, 0, 2]; // 2o lugar, 1o lugar, 3o lugar (visual de podio)
    this.el.podium.textContent = '';
    for (const idx of order) {
      const p = ranking[idx];
      if (!p) continue;
      const wrap = document.createElement('div');
      wrap.className = 'pod p' + (idx + 1);
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = p.name;
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.background = hexCss(p.color != null ? this.colorOf(p.color) : 0x888888);
      bar.textContent = String(idx + 1);
      const pts = document.createElement('div');
      pts.className = 'pts';
      pts.textContent = p.score + ' pts';
      wrap.append(who, bar, pts);
      this.el.podium.appendChild(wrap);
    }

    this.el.endBody.textContent = '';
    ranking.forEach((p, i) => {
      const tr = document.createElement('tr');
      tr.appendChild(this.td(String(i + 1)));
      const nameTd = document.createElement('td');
      nameTd.className = 'nm';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = hexCss(this.colorOf(p.color));
      nameTd.appendChild(dot);
      nameTd.appendChild(document.createTextNode(p.name));
      tr.appendChild(nameTd);
      tr.appendChild(this.td(String(p.score)));
      tr.appendChild(this.td(String(p.kills)));
      this.el.endBody.appendChild(tr);
    });
  }

  hideEnd() {
    this.el.end.classList.add('hidden');
    this._endSignature = null;
  }

  // ------------------------------------------------------- pausa / reconexao

  setPaused(v) { this.el.pause.classList.toggle('hidden', !v); }
  setReconnecting(v) { this.el.reconnect.classList.toggle('hidden', !v); }

  // ------------------------------------------------------------------- chat

  onChatSubmit(cb) {
    this.el.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      cb(this.el.chatInput.value);
    });
  }

  openChat() {
    this.el.chatForm.classList.remove('hidden');
    this.el.chatInput.value = '';
    this.el.chatInput.focus();
  }

  closeChat() {
    this.el.chatForm.classList.add('hidden');
    this.el.chatInput.blur();
  }

  chatValue() { return this.el.chatInput.value; }

  /** Mensagens somem sozinhas depois de CONFIG.CHAT.TTL_MS. */
  addChat(name, colorHex, text, sys) {
    const d = document.createElement('div');
    d.className = 'cm' + (sys ? ' sys' : '');
    if (!sys) {
      const who = document.createElement('span');
      who.className = 'who';
      who.style.color = hexCss(colorHex || 0xffffff);
      who.textContent = name + ': ';
      d.appendChild(who);
    }
    d.appendChild(document.createTextNode(text));
    this.el.chatLog.appendChild(d);
    while (this.el.chatLog.children.length > 6) this.el.chatLog.removeChild(this.el.chatLog.firstChild);
    setTimeout(() => d.remove(), CONFIG.CHAT.TTL_MS);
  }

  addKill(killer, victim) {
    const d = document.createElement('div');
    d.className = 'kf';
    const a = document.createElement('span');
    a.className = 'n';
    a.textContent = killer;
    const b = document.createElement('span');
    b.className = 'n';
    b.textContent = victim;
    d.append(a, document.createTextNode('  afundou  '), b);
    this.el.killfeed.appendChild(d);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.removeChild(this.el.killfeed.firstChild);
    setTimeout(() => d.remove(), 6000);
  }
}
