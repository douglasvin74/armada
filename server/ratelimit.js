// =============================================================================
//  RATELIMIT - balde de eventos por socket, com janela de 1 segundo.
//
//  Vive num modulo proprio por dois motivos: e logica de seguranca (merece
//  teste) e index.js sobe um servidor ao ser importado, o que o tornaria
//  impossivel de testar isoladamente.
//
//  Node roda em UMA thread. Um cliente modificado emitindo 10 mil eventos por
//  segundo satura o event loop e congela a partida de TODOS - nao so a dele.
//  O cooldown de tiro ja existia na regra do jogo; isto protege a camada de
//  transporte, que e onde o abuso realmente machuca.
// =============================================================================

/** Estado do limitador de um socket. */
export function makeLimiter() {
  return { windowStart: 0, counts: Object.create(null), strikes: 0 };
}

/**
 * Contabiliza um evento e diz se ele pode ser processado.
 *
 * @param {object} lim       estado vindo de makeLimiter()
 * @param {string} event     nome do evento (cada um tem contador proprio)
 * @param {number} perSecond teto por janela de 1 s
 * @param {number} now       timestamp em ms (injetado para o teste ser deterministico)
 * @returns {{ allowed: boolean, strikes: number }}
 */
export function hit(lim, event, perSecond, now) {
  if (now - lim.windowStart >= 1000) {      // janela expirou: zera os contadores
    lim.windowStart = now;
    lim.counts = Object.create(null);
  }
  const n = (lim.counts[event] || 0) + 1;
  lim.counts[event] = n;

  if (n <= perSecond) return { allowed: true, strikes: lim.strikes };

  lim.strikes++;
  return { allowed: false, strikes: lim.strikes };
}
