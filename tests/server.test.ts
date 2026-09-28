/// <reference types="node" />
/**
 * The lobby server as a real process: malformed requests must not kill it,
 * and the origin check must let the server's own pages in.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

const port = 20_000 + Math.floor(Math.random() * 20_000);
let proc: ChildProcess;

function get(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Send a raw WebSocket handshake; resolve with the HTTP status code. */
function upgrade(path: string, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
      );
    });
    sock.once('data', (d) => {
      resolve(Number(String(d).split(' ')[1]));
      sock.destroy();
    });
    sock.on('error', reject);
  });
}

beforeAll(async () => {
  proc = spawn(process.execPath, ['server/main.ts'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ALLOWED_ORIGINS: 'https://example.github.io' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await get('/api/health')) === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the server did not start');
});

afterAll(() => {
  proc?.kill();
});

describe('lobby server', () => {
  it('answers malformed paths with 400 and keeps running', async () => {
    expect(await get('/%FF')).toBe(400);
    expect(await get('/%')).toBe(400);
    expect(await get('/%00')).toBe(400);
    expect(await get('//')).not.toBe(500);
    expect(await upgrade('/%FF', `http://127.0.0.1:${port}`)).toBe(403);
    expect(await get('/api/health')).toBe(200);
    expect(proc.exitCode).toBeNull();
  });

  it('refuses paths outside the app folder', async () => {
    expect(await get('/..%2f..%2fetc%2fpasswd')).toBe(403);
  });

  it('accepts WebSockets from its own pages and from allowed origins only', async () => {
    expect(await upgrade('/ws', `http://127.0.0.1:${port}`)).toBe(101);
    expect(await upgrade('/ws', 'https://example.github.io')).toBe(101);
    expect(await upgrade('/ws', 'https://evil.example')).toBe(403);
  });
});
