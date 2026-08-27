# ARMADA — Batalha Naval 3D multiplayer no navegador

Jogo de guerra de navios em 3ª pessoa, até 8 jogadores, partidas de 5 minutos com
reinício automático. Servidor **Node.js + Express + Socket.IO**, cliente **Three.js
0.160.0** em ES Modules puros — **sem etapa de build, sem banco de dados e sem um
único asset externo** (toda a arte é geometria primitiva, `CanvasTexture` e Web Audio).

---

## Como rodar

```bash
npm install
```

```bash
npm start
```

Para desenvolver com reinício automático do servidor a cada alteração:

```bash
npm run dev
```

Para rodar a suíte de testes (83 testes, runner nativo do Node, sem dependências):

```bash
npm test
```

Ao subir, o terminal imprime algo assim:

```
==================================================================
  ARMADA - Batalha Naval 3D    (Node v20.x)
==================================================================
  Local:   http://localhost:3000
  Rede:    http://192.168.0.42:3000      [Wi-Fi]
==================================================================
```

Abra o endereço **Local** no seu navegador. Abra em **duas abas** para ver dois
navios se enxergando em tempo real.

A porta pode ser trocada por variável de ambiente:

```bash
PORT=8080 npm start
```

---

## Como convidar os amigos

1. Todos precisam estar na **mesma rede local** (mesmo Wi-Fi / mesmo roteador).
2. Passe para eles a linha **Rede:** impressa no terminal (ex.: `http://192.168.0.42:3000`).
   O mesmo endereço aparece na tela inicial do jogo, em amarelo, pronto para copiar.
3. Se não abrir na máquina deles, é quase sempre o **firewall** da sua máquina.
   Veja abaixo.

### Liberar a porta 3000 no firewall

**Windows** (PowerShell como Administrador):

```powershell
New-NetFirewallRule -DisplayName "Armada 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Para remover depois:

```powershell
Remove-NetFirewallRule -DisplayName "Armada 3000"
```

**macOS** — o firewall pergunta na primeira execução; basta clicar em *Permitir*.
Se você negou antes, libere o binário do Node manualmente:

```bash
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$(which node)"
```

**Linux (ufw)**:

```bash
sudo ufw allow 3000/tcp
```

**Linux (firewalld)**:

```bash
sudo firewall-cmd --add-port=3000/tcp
```

### Opcional: jogar com gente fora da sua rede

Não é necessário para LAN. Se quiser abrir para a internet, use um túnel — e
lembre que isso expõe seu servidor publicamente enquanto o túnel estiver ativo.

```bash
ngrok http 3000
```

```bash
cloudflared tunnel --url http://localhost:3000
```

Os dois entregam uma URL `https://...` que qualquer pessoa pode abrir. A latência
sobe (a interpolação do cliente absorve bem até ~150 ms).

---

## Controles

| Tecla / Mouse | Ação |
|---|---|
| `W` / `S` | acelerar à frente / dar ré |
| `A` / `D` | leme para bombordo / boreste |
| `Mouse` | girar a câmera e a torre do canhão (Pointer Lock) |
| `Clique esquerdo` | canhão principal (segure para tiro contínuo na cadência) |
| `Espaço` | salva lateral: 3 granadas em leque |
| `Shift` | turbina (consome a barra de estamina) |
| `C` | recentrar a câmera atrás do casco |
| `Tab` | segurar para ver o placar completo |
| `Enter` | abrir o chat; `Enter` de novo envia, `Esc` cancela |
| `Esc` | liberar o mouse e abrir a tela de pausa |
| `M` | ligar/desligar o som |
| `Esc` → **OPÇÕES** | inverter eixos, sensibilidade, volumes, sombras, resolução |
| `Q`/`E`, `R`/`F` | girar câmera pelo teclado (usado se o Pointer Lock for negado) |

O anel amarelo na água mostra **onde a granada vai cair** com a elevação atual.
Use-o: as granadas têm arco balístico e tempo de voo, então mire adiantado em
alvos em movimento.

### Pontuação

| Evento | Pontos |
|---|---|
| Acerto de granada | +10 |
| Afundar um adversário | +100 |
| Ser afundado | −25 (nunca fica negativo) |

Encostar em ilhas ou entrar na tempestade da borda causa dano contínuo.
Ao afundar, você volta ao mar em 4 segundos, em posição aleatória.

---

## Estrutura de arquivos

```
meu-jogo-3d/
├── package.json
├── README.md
├── LICENSE
├── server/
│   ├── index.js      Express + Socket.IO + detecção de IP da LAN + banner
│   ├── game.js       loop autoritativo, estado da partida, colisões, placar
│   ├── config.js     TODAS as constantes de balanceamento (comentadas)
│   ├── ratelimit.js  balde de eventos por socket (protege o event loop)
│   └── shared.js     física do navio, geração do mapa e matemática
├── test/             suíte `node --test` (física, regras, limites, processo)
└── public/
    ├── index.html    import map do Three.js + canvas + HUD
    ├── style.css
    └── js/
        ├── main.js     bootstrap, loop de render, predição local, câmera
        ├── scene.js    cena, luzes, mar, ilhas, tempestade, partículas
        ├── player.js   avatar do navio, placa de nome, balanço nas ondas
        ├── network.js  cliente Socket.IO, snapshots e interpolação
        ├── input.js    teclado, mouse, Pointer Lock
        ├── ui.js       HUD, placar, chat, telas, painel de opcoes
        ├── settings.js preferencias do jogador (localStorage)
        └── audio.js    sons procedurais (Web Audio API)
```

`server/config.js` e `server/shared.js` são servidos ao navegador como
`/js/config.js` e `/js/shared.js`. Isso é de propósito: as constantes e a função
`stepShip()` existem **uma única vez** e rodam idênticas no servidor (verdade) e
no cliente (predicação local). Não duplique essa lógica.

---

## Opções do jogador

O botão **OPÇÕES** (tela inicial e tela de pausa) ajusta, por navegador:

- **Controles** — inverter eixo X, inverter eixo Y, sensibilidade do mouse.
- **Som** — mudo, volume geral, efeitos, motor.
- **Vídeo** — sombras, resolução, exibir FPS/ping.
- **Câmera** — firmeza do acompanhamento.

Fica salvo em `localStorage`; nada vai para o servidor nem afeta os outros
jogadores. **RESTAURAR PADRÕES** desfaz tudo.

## Como customizar

Tudo que vale mexer está em [`server/config.js`](server/config.js) — o cliente
lê o mesmo arquivo, então basta reiniciar o servidor e recarregar a página.

| Constante | Efeito |
|---|---|
| `MAP.SEED` | muda o mapa inteiro (ilhas e recifes) |
| `MAP.ARENA_RADIUS` | tamanho da arena |
| `MAP.ISLAND_COUNT` | mais ilhas = mais esconderijos |
| `SHIP.MAX_SPEED`, `TURN_RATE` | agilidade dos navios |
| `SHIP.MAX_HP` | duração dos combates |
| `SHELL.SPEED`, `SHELL.GRAVITY` | achata ou levanta o arco das granadas |
| `SHELL.MAIN_COOLDOWN` | cadência do canhão |
| `MATCH.DURATION` | duração da partida, em segundos |
| `MATCH.POST_MATCH` | tempo do pódio antes do reinício |
| `MAX_PLAYERS` | vagas na sala |
| `LIMITS.*` | tetos de proteção: conexões, eventos/s e tempo ocioso |
| `TICK_HZ` | frequência do loop do servidor (20–30 é o ideal) |
| `INTERP_DELAY_MS` | atraso de interpolação; suba se a rede for ruim |

As cores dos jogadores estão em `TEAM_COLORS`, no topo de
[`server/game.js`](server/game.js).

---

## Testes

```bash
npm test
```

83 testes no runner nativo do Node (`node --test`), **sem nenhuma dependência de
teste**. Rodam em ~14 s.

| Arquivo | Cobre |
|---|---|
| `test/shared.test.js` | determinismo de `stepShip`, `mulberry32` e `generateIslands`; tetos de velocidade e estamina; colisão com ilha; sanitização de apelido e chat |
| `test/game.test.js` | cadência validada no servidor, pontuação, ciclo de partida, respawn, formato do snapshot, 300 ticks com 8 jogadores sem NaN |
| `test/ratelimit.test.js` | tetos por evento, janela deslizante, acúmulo de strikes, tráfego legítimo nunca punido |
| `test/server.test.js` | integração: sobe o processo real, valida as rotas e confirma `SIGTERM`/`SIGINT` |

Rodar um arquivo só, ou filtrar por nome:

```bash
node --test test/game.test.js
```

```bash
node --test --test-name-pattern="cooldown" test/*.test.js
```

Alguns testes travam **invariantes de arquitetura**, não só comportamento: se
`stepShip` ou `generateIslands` deixarem de ser determinísticos, a predição do
cliente diverge da verdade do servidor e o teste falha na hora.

---

## Como a rede funciona

- O **servidor é a fonte da verdade**: posição, vida, placar, acertos e o
  cronômetro. Ele roda `game.update()` a 30 Hz e faz `io.emit('state', ...)` no
  mesmo ritmo.
- O **cliente só manda intenção** (`{ th, ru, bo, ay, ap }` = acelerador, leme,
  turbina, mira). Nunca posição. O servidor limita velocidade, cadência de tiro,
  ângulo de elevação, tamanho do apelido e frequência de chat.
- **Proteção do servidor**: Node roda em uma única thread, então um cliente
  modificado que inunde o socket travaria a partida de todos. Há teto de eventos
  por segundo (`CONFIG.LIMITS`), teto de conexões simultâneas, desligamento de
  socket ocioso e `try/catch` em cada handler — um erro em um jogador não derruba
  mais o processo inteiro.
- Os **outros navios** são desenhados ~110 ms no passado (`INTERP_DELAY_MS`) e
  interpolados entre os dois snapshots que cercam esse instante. É o que faz 30
  updates por segundo virarem movimento fluido a 60 FPS.
- O **navio local** usa predição: `stepShip()` roda no cliente a cada quadro, então
  a tecla responde na hora. A posição do servidor é reconciliada devagar
  (~2/s) para não causar efeito elástico, com *snap* direto se o erro passar de
  14 unidades (respawn, reconexão, teleporte).
- **Desconexão**: o jogador sai do placar e da cena em menos de meio segundo, e os
  demais recebem aviso no chat.
- **Reconexão**: se o socket cair, aparece o overlay "Reconectando..." e o cliente
  se re-inscreve na partida sozinho quando o servidor voltar.

---

## Problemas comuns

**"A porta 3000 já está em uso"** — outro processo está ocupando a porta. Rode
`PORT=3001 npm start`.

**Tela preta / erro de WebGL** — o jogo mostra um aviso na tela. Verifique se a
aceleração de hardware está ligada no navegador (em `chrome://gpu` dá para
confirmar).

**O mouse não foi capturado** — alguns navegadores negam o Pointer Lock em certas
situações. Aparece uma dica no HUD; nesse caso segure o botão esquerdo para girar
a câmera, ou use `Q`/`E` e `R`/`F`.

**Sem som** — o navegador só libera áudio depois de um clique. O som começa junto
com o clique em "Entrar na partida". `M` alterna mudo.

**O amigo abre e fica em branco** — quase sempre firewall. Veja a seção acima.

---

## Licença

MIT — veja [LICENSE](LICENSE).
