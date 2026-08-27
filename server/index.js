// =============================================================================
//  SERVIDOR - Express (arquivos estaticos) + Socket.IO (tempo real).
//
//  Escuta em 0.0.0.0 para que amigos na mesma rede consigam entrar pelo IP LAN.
// =============================================================================

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { Server as SocketServer } from 'socket.io';

import { CONFIG } from './config.js';
import { Game, TEAM_COLORS } from './game.js';
import { sanitizeName, sanitizeChat } from './shared.js';
import { makeLimiter, hit } from './ratelimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5,
});

const game = new Game();

// -----------------------------------------------------------------------------
//  Rotas estaticas
// -----------------------------------------------------------------------------

// config.js e shared.js moram em /server mas sao servidos ao navegador como se
// estivessem em /public/js. Isso garante UMA unica fonte de verdade para as
// constantes e para a fisica do navio (usada na predicao local do cliente).
const sendServerModule = (file) => (req, res) => {
  res.type('application/javascript; charset=utf-8');
  res.sendFile(path.join(__dirname, file));
};
app.get('/js/config.js', sendServerModule('config.js'));
app.get('/js/shared.js', sendServerModule('shared.js'));

// Three.js vem do node_modules (nao de CDN): funciona offline e nunca da 404.
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three')));

app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/info', (req, res) => {
  res.json({
    port: PORT,
    lan: lanAddresses().map((n) => `http://${n.address}:${PORT}`),
    players: game.players.size,
    max: CONFIG.MAX_PLAYERS,
  });
});

// -----------------------------------------------------------------------------
//  Protecao contra inundacao de eventos
// -----------------------------------------------------------------------------

const L = CONFIG.LIMITS;

/**
 * Aplica o balde de eventos (ver server/ratelimit.js) e desliga o socket que
 * insistir em estourar o limite.
 *
 * @returns {boolean} true se o evento pode ser processado
 */
function allow(socket, event, perSecond) {
  const r = hit(socket.data.limiter, event, perSecond, Date.now());
  if (r.allowed) return true;
  if (r.strikes >= L.STRIKES) {
    console.warn(`[LIMITE] ${socket.id.slice(0, 6)} desconectado: excesso de '${event}'`);
    socket.disconnect(true);
  }
  return false;
}

/**
 * Registra um handler com limite de taxa E captura de excecao.
 *
 * O try/catch e o ponto critico (item 3): sem ele, um payload inesperado
 * vindo de UM cliente lanca uma excecao nao tratada e derruba o processo -
 * levando junto a partida, o placar e os outros 7 jogadores.
 */
function on(socket, event, perSecond, handler) {
  socket.on(event, (...args) => {
    if (!allow(socket, event, perSecond)) return;
    try {
      handler(...args);
    } catch (err) {
      console.error(`[HANDLER] falha em '${event}' (${socket.id.slice(0, 6)}):`, err.message);
    }
  });
}

// -----------------------------------------------------------------------------
//  Socket.IO
// -----------------------------------------------------------------------------

function lobbyPayload() {
  return {
    colors: TEAM_COLORS.map((c) => ({ name: c.name, hex: c.hex })),
    taken: [...game.players.values()].map((p) => p.color),
    players: game.players.size,
    max: CONFIG.MAX_PLAYERS,
  };
}

function systemMessage(text) {
  io.emit('chat', { name: null, color: null, text, sys: true });
}

io.on('connection', (socket) => {
  // --- item 4: teto de conexoes simultaneas ---------------------------------
  // MAX_PLAYERS limita quem JOGA; sem este teto, sockets que nunca entram na
  // partida se acumulam sem limite e consomem memoria do processo.
  if (io.engine.clientsCount > L.MAX_SOCKETS) {
    console.warn(`[LIMITE] conexao recusada: ${io.engine.clientsCount} sockets abertos`);
    socket.emit('full', { max: CONFIG.MAX_PLAYERS, reason: 'server' });
    socket.disconnect(true);
    return;
  }

  socket.data.limiter = makeLimiter();

  // --- item 4: socket ocioso na tela inicial e desligado --------------------
  socket.data.joinTimer = setTimeout(() => {
    if (!game.players.has(socket.id)) {
      console.log(`[OCIOSO] ${socket.id.slice(0, 6)} desconectado apos ${L.JOIN_TIMEOUT}s sem entrar`);
      socket.disconnect(true);
    }
  }, L.JOIN_TIMEOUT * 1000);

  socket.emit('lobby', lobbyPayload());

  on(socket, 'join', L.JOIN_RATE, (data) => {
    if (game.players.has(socket.id)) return;              // ja esta jogando
    if (game.players.size >= CONFIG.MAX_PLAYERS) {
      socket.emit('full', { max: CONFIG.MAX_PLAYERS });
      return;
    }
    const name = sanitizeName(data && data.name);
    const color = Number.isInteger(data && data.color) ? data.color : -1;
    const p = game.addPlayer(socket.id, name, color);

    socket.emit('welcome', {
      id: socket.id,
      color: p.color,
      colors: TEAM_COLORS.map((c) => ({ name: c.name, hex: c.hex })),
    });
    clearTimeout(socket.data.joinTimer);      // entrou: nao e mais ocioso
    io.emit('lobby', lobbyPayload());
    systemMessage(`${p.name} entrou na batalha`);
    console.log(`[ENTROU] ${p.name} (${socket.id.slice(0, 6)}) - ${game.players.size}/${CONFIG.MAX_PLAYERS} a bordo`);
  });

  on(socket, 'input', L.INPUT_RATE, (d) => game.setInput(socket.id, d));

  on(socket, 'fire', L.FIRE_RATE, (d) => {
    const kind = d && d.kind === 'broadside' ? 'broadside' : 'main';
    game.requestFire(socket.id, kind);
  });

  on(socket, 'chat', L.CHAT_RATE, (raw) => {
    const p = game.players.get(socket.id);
    if (!p) return;
    if (game.clock - p.lastChat < CONFIG.CHAT.COOLDOWN) return;  // anti-flood
    const text = sanitizeChat(raw);
    if (!text) return;
    p.lastChat = game.clock;
    io.emit('chat', { name: p.name, color: TEAM_COLORS[p.color].hex, text, sys: false });
  });

  // Medicao de ping: eco puro, o cliente calcula o round-trip.
  on(socket, 'lp', L.PING_RATE, (t) => socket.emit('lpong', t));

  // Um erro emitido pelo proprio socket (parse, transporte) chega aqui. Sem
  // este listener, o EventEmitter transforma 'error' em excecao nao tratada.
  socket.on('error', (err) => {
    console.error(`[SOCKET] ${socket.id.slice(0, 6)}:`, err && err.message);
  });

  socket.on('disconnect', () => {
    clearTimeout(socket.data.joinTimer);
    const p = game.removePlayer(socket.id);
    if (!p) return;
    io.emit('left', { id: socket.id });
    io.emit('lobby', lobbyPayload());
    systemMessage(`${p.name} abandonou o mar`);
    console.log(`[SAIU]   ${p.name} (${socket.id.slice(0, 6)}) - ${game.players.size}/${CONFIG.MAX_PLAYERS} a bordo`);
  });
});

// -----------------------------------------------------------------------------
//  Loop autoritativo (30 Hz) + broadcast do estado
// -----------------------------------------------------------------------------

const TICK_MS = 1000 / CONFIG.TICK_HZ;
let lastTick = Date.now();

setInterval(() => {
  const now = Date.now();
  // dt limitado: se o processo travar por 1s, nao teleportamos todo mundo
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  try {
    game.update(dt);
    io.emit('state', game.snapshot());
  } catch (err) {
    // Uma excecao aqui mataria o processo e, com ele, a partida de todos.
    // Preferimos perder UM tick a perder a sala inteira.
    console.error('[TICK] erro na simulacao:', err.stack || err.message);
  }
}, TICK_MS);

// -----------------------------------------------------------------------------
//  Deteccao de IP na LAN + banner de inicializacao
// -----------------------------------------------------------------------------

/** Pontua enderecos para colocar as faixas domesticas comuns primeiro. */
function rankAddress(addr) {
  if (addr.startsWith('192.168.')) return 3;
  if (addr.startsWith('10.')) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 2;
  if (addr.startsWith('169.254.')) return -1;   // link-local, quase sempre inutil
  return 0;
}

function lanAddresses() {
  const found = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const net of list || []) {
      const isV4 = net.family === 'IPv4' || net.family === 4;
      if (!isV4 || net.internal) continue;       // ignora lo / interfaces internas
      found.push({ name, address: net.address });
    }
  }
  found.sort((a, b) => rankAddress(b.address) - rankAddress(a.address));
  return found;
}

function printBanner() {
  const lan = lanAddresses();
  const line = '='.repeat(66);
  console.log('');
  console.log(line);
  console.log('  ARMADA - Batalha Naval 3D    (Node ' + process.version + ')');
  console.log(line);
  console.log(`  Local:   http://localhost:${PORT}`);
  if (lan.length) {
    for (const n of lan) {
      console.log(`  Rede:    http://${n.address}:${PORT}      [${n.name}]`);
    }
  } else {
    console.log('  Rede:    (nenhuma interface de rede externa encontrada)');
  }
  console.log(line);
  console.log('  Seus amigos precisam estar no MESMO Wi-Fi / rede local.');
  console.log('  Se nao abrir na maquina deles, libere a porta ' + PORT + ' no firewall');
  console.log('  (o README.md tem o comando pronto para Windows, macOS e Linux).');
  console.log(`  Ate ${CONFIG.MAX_PLAYERS} jogadores | partida de ${CONFIG.MATCH.DURATION / 60} min | reinicio automatico`);
  console.log(line);
  console.log('');
}

server.listen(PORT, HOST, printBanner);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERRO] A porta ${PORT} ja esta em uso.`);
    console.error(`       Feche o outro processo ou rode:  PORT=3001 npm start\n`);
  } else {
    console.error('[ERRO] Falha ao subir o servidor:', err.message);
  }
  process.exit(1);
});

// -----------------------------------------------------------------------------
//  Encerramento limpo e rede de seguranca
// -----------------------------------------------------------------------------

let shuttingDown = false;

/**
 * SIGINT vem do Ctrl+C no terminal. SIGTERM e o que Docker, systemd e
 * orquestradores enviam - sem trata-lo, o processo so morre no timeout, a
 * forca, sem fechar os sockets abertos.
 */
function shutdown(signal, code = 0) {
  if (shuttingDown) return;              // segundo Ctrl+C nao reentra
  shuttingDown = true;
  console.log(`\n[SERVIDOR] ${signal} recebido. Encerrando...`);
  try {
    systemMessage('O servidor esta sendo encerrado.');
  } catch (err) { /* io ja pode estar fechando */ }
  io.close();
  server.close(() => process.exit(code));
  // rede de seguranca: se algum socket travar, saimos assim mesmo
  setTimeout(() => process.exit(code), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Doutrina padrao do Node: um throw nao capturado deixa o processo em estado
// indefinido. Logamos com o stack completo e SAIMOS com codigo de erro - quem
// reinicia e o supervisor (systemd, PM2, container). Continuar rodando aqui
// seria pior: corromperia o estado da partida silenciosamente.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] excecao nao capturada:', err.stack || err.message);
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] promise rejeitada sem catch:', reason);
  shutdown('unhandledRejection', 1);
});
