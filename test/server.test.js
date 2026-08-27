// =============================================================================
//  Teste de integracao do processo do servidor.
//
//  Sobe o servidor de verdade como processo filho, numa porta alta, e verifica
//  o ciclo de vida: banner, resposta HTTP e encerramento limpo por sinal.
//
//  E o unico teste que cria processo/rede; os demais sao puros e instantaneos.
// =============================================================================

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'server', 'index.js');

/** Sobe o servidor e resolve quando o banner aparecer no stdout. */
function subirServidor(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [ENTRY], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    const prazo = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('servidor nao subiu em 10 s. Saida:\n' + saida));
    }, 10000);

    proc.stdout.on('data', (b) => {
      saida += b.toString();
      if (saida.includes('ARMADA')) {
        clearTimeout(prazo);
        resolve({ proc, saida: () => saida });
      }
    });
    proc.stderr.on('data', (b) => { saida += b.toString(); });
    proc.on('exit', (code) => {
      clearTimeout(prazo);
      reject(new Error(`servidor saiu cedo (codigo ${code}). Saida:\n` + saida));
    });
  });
}

function pedir(port, caminho) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: caminho }, (res) => {
      let corpo = '';
      res.on('data', (c) => { corpo += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

/** Espera o processo morrer; devolve quanto tempo levou, em ms. */
function esperarMorte(proc, limiteMs) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const prazo = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`nao encerrou em ${limiteMs} ms`));
    }, limiteMs);
    proc.on('exit', (code, signal) => {
      clearTimeout(prazo);
      resolve({ ms: Date.now() - inicio, code, signal });
    });
  });
}

// Porta alta e fixa por teste, para nao colidir com um servidor de verdade
// rodando na 3000 durante o desenvolvimento.
const PORTA_HTTP = 34071;
const PORTA_TERM = 34072;
const PORTA_INT = 34073;
const vivos = [];
after(() => { for (const p of vivos) { try { p.kill('SIGKILL'); } catch (e) { /* ja morreu */ } } });

describe('processo do servidor', () => {
  test('sobe, serve os arquivos do jogo e responde /api/info', async () => {
    const { proc } = await subirServidor(PORTA_HTTP);
    vivos.push(proc);
    try {
      for (const rota of ['/', '/style.css', '/js/main.js', '/js/settings.js',
                          '/js/config.js', '/js/shared.js']) {
        const r = await pedir(PORTA_HTTP, rota);
        assert.equal(r.status, 200, `${rota} devolveu ${r.status}`);
      }

      // config.js e shared.js moram em /server mas precisam ser servidos como
      // se estivessem em /public/js - e o que sustenta a predicao no cliente.
      const shared = await pedir(PORTA_HTTP, '/js/shared.js');
      assert.ok(shared.corpo.includes('stepShip'), '/js/shared.js sem stepShip');

      const info = await pedir(PORTA_HTTP, '/api/info');
      const dados = JSON.parse(info.corpo);
      assert.equal(dados.port, PORTA_HTTP);
      assert.ok(Array.isArray(dados.lan));
      assert.equal(dados.players, 0);
    } finally {
      proc.kill('SIGKILL');
    }
  });

  test('SIGTERM encerra limpo e rapido (Docker, systemd)', async () => {
    const { proc, saida } = await subirServidor(PORTA_TERM);
    vivos.push(proc);
    proc.kill('SIGTERM');
    const r = await esperarMorte(proc, 8000);
    assert.ok(saida().includes('SIGTERM'), 'nao registrou o sinal no log');
    assert.ok(r.ms < 5000, `demorou ${r.ms} ms para encerrar`);
    assert.notEqual(r.signal, 'SIGKILL', 'precisou de SIGKILL');
  });

  test('SIGINT (Ctrl+C) tambem encerra limpo', async () => {
    const { proc, saida } = await subirServidor(PORTA_INT);
    vivos.push(proc);
    proc.kill('SIGINT');
    const r = await esperarMorte(proc, 8000);
    assert.ok(saida().includes('SIGINT'), 'nao registrou o sinal no log');
    assert.equal(r.code, 0, `codigo de saida ${r.code}`);
  });
});
