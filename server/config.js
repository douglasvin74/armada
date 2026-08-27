// =============================================================================
//  CONFIG - todas as constantes de balanceamento do jogo ficam AQUI.
//
//  Este arquivo e um modulo ES e tambem e servido ao navegador em /js/config.js
//  (ver server/index.js). Assim cliente e servidor usam EXATAMENTE os mesmos
//  numeros, sem duplicacao e sem risco de dessincronizacao na predicao local.
// =============================================================================

export const CONFIG = {
  // ---------------------------------------------------------------- rede ----
  TICK_HZ: 30,            // frequencia do loop autoritativo do servidor
  INPUT_HZ: 30,           // frequencia com que o cliente envia input
  INTERP_DELAY_MS: 110,   // atraso de render: o cliente desenha o passado
                          // recente para sempre ter 2 snapshots p/ interpolar
  MAX_PLAYERS: 8,         // limite de jogadores simultaneos na sala

  // ------------------------------------------------- limites de protecao ----
  // Node e single-thread: um cliente modificado que inunde o servidor de
  // eventos trava o jogo de TODO MUNDO. Estes tetos existem para isso.
  LIMITS: {
    MAX_SOCKETS: 64,        // conexoes simultaneas (jogando ou nao)
    JOIN_TIMEOUT: 180,      // segundos na tela inicial antes de ser desligado
    INPUT_RATE: 45,         // eventos 'input' por segundo (INPUT_HZ e 30)
    FIRE_RATE: 12,          // pedidos de tiro por segundo (cadencia real e ~1/s)
    CHAT_RATE: 4,           // mensagens de chat por segundo
    PING_RATE: 4,           // medicoes de latencia por segundo
    JOIN_RATE: 3,           // tentativas de entrar por segundo
    STRIKES: 3,             // estouros de limite tolerados antes do kick
  },

  // ----------------------------------------------------------------- mapa ---
  MAP: {
    SEED: 20260820,           // seed FIXA -> todo mundo ve o mesmo mapa
    ARENA_RADIUS: 240,        // raio navegavel, em unidades do mundo
    ISLAND_COUNT: 14,         // quantidade de ilhas/obstaculos
    ISLAND_MIN_R: 10,
    ISLAND_MAX_R: 26,
    ISLAND_MIN_H: 12,
    ISLAND_MAX_H: 34,
    ISLAND_KEEPOUT: 46,       // raio central sem ilhas (area de combate aberta)
    ISLAND_GAP: 26,           // folga minima entre ilhas (canais navegaveis)
    REEF_COUNT: 110,          // rochas decorativas na borda da arena
  },

  // ---------------------------------------------------------------- navio ---
  SHIP: {
    HULL_LENGTH: 12,          // comprimento visual do casco
    HULL_WIDTH: 4.4,          // largura visual do casco
    COLLISION_RADIUS: 4.6,    // colisao por esfera (barata e suficiente)
    MAX_SPEED: 22,            // velocidade maxima a frente (unidades/s)
    MAX_REVERSE: 8,           // velocidade maxima de re
    BOOST_MULT: 1.55,         // multiplicador da turbina (Shift)
    ACCEL: 9,                 // aceleracao (unidades/s^2)
    BRAKE: 16,                // desaceleracao / freio
    TURN_RATE: 0.95,          // rad/s de giro com leme 100%
    RUDDER_RESPONSE: 3.2,     // quao rapido o leme responde ao A/D
    TURN_SPEED_REF: 0.45,     // fracao de MAX_SPEED p/ leme render 100%
    MAX_HP: 100,
    RESPAWN_DELAY: 4,         // segundos ate voltar a flutuar
    STAMINA_MAX: 100,
    STAMINA_DRAIN: 26,        // gasto de estamina por segundo com turbina
    STAMINA_REGEN: 11,        // recuperacao por segundo
    RAM_DAMAGE: 6,            // dano ao esporrar em outro navio
    ISLAND_DPS: 9,            // dano por segundo raspando numa ilha/tempestade
  },

  // -------------------------------------------------------------- projetil --
  SHELL: {
    SPEED: 78,                // velocidade inicial da granada
    GRAVITY: 22,              // gravidade aplicada ao projetil (arco balistico)
    RADIUS: 1.4,
    LIFE: 7,                  // tempo de vida maximo, em segundos
    MUZZLE_HEIGHT: 3.2,       // altura da boca do canhao
    MUZZLE_FORWARD: 3.2,
    MAIN_DAMAGE: 24,
    MAIN_COOLDOWN: 1.1,       // cadencia do canhao principal (clique esquerdo)
    BROADSIDE_DAMAGE: 15,
    BROADSIDE_COUNT: 3,       // salva lateral (Espaco): 3 granadas em leque
    BROADSIDE_SPREAD: 0.10,   // abertura do leque, em radianos
    BROADSIDE_COOLDOWN: 7,
    MIN_PITCH: -0.05,         // elevacao minima do canhao
    MAX_PITCH: 0.55,          // elevacao maxima do canhao
  },

  // ------------------------------------------------------------ pontuacao ---
  SCORE: { HIT: 10, KILL: 100, DEATH: -25 },

  // -------------------------------------------------------------- partida ---
  MATCH: {
    DURATION: 300,            // 5 minutos de partida
    POST_MATCH: 10,           // 10 segundos de placar final antes de reiniciar
  },

  // --------------------------------------------------- camera (so cliente) --
  CAMERA: {
    DISTANCE: 27,             // distancia da camera em 3a pessoa
    HEIGHT: 11,
    LOOK_AHEAD: 14,
    MIN_PITCH: -0.05,         // ligado a elevacao do canhao
    MAX_PITCH: 0.55,
    SENSITIVITY: 0.0022,      // sensibilidade do mouse
  },

  // ----------------------------------------------------------------- chat ---
  CHAT: { MAX_LEN: 90, COOLDOWN: 0.7, TTL_MS: 9000 },
};

export default CONFIG;
