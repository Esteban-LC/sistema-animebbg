/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const busboy = require('busboy');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'animebbg-uploads');
if (!fs.existsSync(UPLOAD_TMP_DIR)) fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port: Number(port) });
const handle = app.getRequestHandler();

// Initialize global emitter for the bridge
const { EventEmitter } = require('events');
if (!global.__animebbgRealtimeEmitter) {
  global.__animebbgRealtimeEmitter = new EventEmitter();
  global.__animebbgRealtimeEmitter.setMaxListeners(200);
}

let dbModulePromise = null;

function getCookieValue(header, name) {
  const cookieHeader = String(header || '');
  if (!cookieHeader) return '';

  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.split('=');
    if (String(rawKey || '').trim() !== name) continue;
    return decodeURIComponent(rest.join('=').trim());
  }
  return '';
}

function getAllowedSocketOrigins(hostHeader) {
  const host = String(hostHeader || '').trim();
  const configured = String(process.env.SOCKET_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const appUrl = String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim();

  const defaults = [];
  if (host) {
    defaults.push(`http://${host}`);
    defaults.push(`https://${host}`);
  }
  if (appUrl) {
    defaults.push(appUrl);
  }
  defaults.push(
    'https://www.sistema-gestorbbg.linkpc.net',
    'https://sistema-gestorbbg.linkpc.net'
  );
  defaults.push('http://localhost:3000', 'https://localhost:3000');

  return new Set([...defaults, ...configured]);
}

async function getDbModule() {
  if (!dbModulePromise) {
    dbModulePromise = import('./src/lib/db.js');
  }
  return dbModulePromise;
}

async function validateSocketHandshake(req) {
  const origin = String(req.headers.origin || '').trim();
  const host = String(req.headers.host || '').trim();
  const allowedOrigins = getAllowedSocketOrigins(host);

  if (origin && !allowedOrigins.has(origin)) {
    return false;
  }

  const token = getCookieValue(req.headers.cookie, 'auth_token');
  if (!token || token.length < 32) {
    return false;
  }

  const { getDb } = await getDbModule();
  const db = getDb();
  const session = await db.prepare(`
    SELECT s.usuario_id, u.activo
    FROM sessions s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);

  return Boolean(session?.usuario_id) && Number(session?.activo ?? 1) === 1;
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url, true);

      // Intercept upload-redraw POST before Next.js touches the body (bypasses 10MB limit)
      // Skip if already has _rid (internal request after pre-processing)
      if (req.method === 'POST' && parsedUrl.pathname === '/api/drive/upload-redraw' && !parsedUrl.query._rid) {
        console.log('[upload interceptor] interceptando upload, content-type:', req.headers['content-type']);
        const requestId = `${Date.now()}-${Math.random()}`;
        const bb = busboy({ headers: req.headers, limits: { fileSize: 100 * 1024 * 1024 } });
        let assignmentIdRaw = null;
        let fileBuffer = null;
        let fileName = null;
        bb.on('field', (name, val) => { if (name === 'assignment_id') assignmentIdRaw = val; });
        bb.on('file', (name, stream, info) => {
          if (name === 'zip_file') {
            fileName = info.filename;
            const chunks = [];
            stream.on('data', d => chunks.push(d));
            stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
          } else {
            stream.resume();
          }
        });
        bb.on('finish', () => {
          console.log('[upload interceptor] busboy finish, assignmentId:', assignmentIdRaw, 'fileSize:', fileBuffer?.length);
          const meta = { assignmentId: Number(assignmentIdRaw), fileName };
          const metaPath = path.join(UPLOAD_TMP_DIR, `${requestId}.json`);
          const filePath = path.join(UPLOAD_TMP_DIR, `${requestId}.bin`);
          fs.writeFileSync(metaPath, JSON.stringify(meta));
          if (fileBuffer) fs.writeFileSync(filePath, fileBuffer);

          // Hacer nueva peticion interna con body JSON pequeño (el body original ya fue consumido)
          const body = JSON.stringify({ _rid: requestId });
          const internalReq = require('http').request({
            hostname: '127.0.0.1',
            port: Number(port),
            path: `/api/drive/upload-redraw?_rid=${requestId}`,
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(body),
              'cookie': req.headers['cookie'] || '',
              'x-forwarded-for': req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
            },
          }, (internalRes) => {
            res.writeHead(internalRes.statusCode, internalRes.headers);
            internalRes.pipe(res);
          });
          internalReq.on('error', (err) => {
            console.error('[upload interceptor] internal request error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Error interno al procesar la subida' }));
          });
          internalReq.write(body);
          internalReq.end();
        });
        bb.on('error', (err) => {
          console.error('[upload interceptor] busboy error:', err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Error procesando el archivo' }));
        });
        req.pipe(bb);
        return;
      }

      handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        const allowedOrigins = getAllowedSocketOrigins(process.env.PUBLIC_HOST || '');
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Origin no permitido'));
      },
      methods: ['GET', 'POST'],
    },
    allowRequest: (req, callback) => {
      validateSocketHandshake(req)
        .then((isValid) => callback(null, isValid))
        .catch((error) => {
          console.error('[Socket] Handshake rejected:', error?.message || error);
          callback('Unauthorized', false);
        });
    },
  });

    io.on('connection', (socket) => {
      socket.on('content-changed', (data) => {
        const payload = data && typeof data === 'object' ? data : {};
        const eventNonce = crypto.randomUUID();
        socket.broadcast.emit('content-changed', { ...payload, _eventNonce: eventNonce });
      });

      socket.on('disconnect', () => {});
    });

    // Bridge internal Events to Socket.io
    const emitter = global.__animebbgRealtimeEmitter;
    if (emitter) {
      console.log('[Socket] Bridge active: internal emitter found');
      emitter.on('notification', (payload) => {
        console.log('[Socket] Internal notification ->io.emit', payload?.id);
        io.emit('notification', payload);
      });
      emitter.on('content-changed', (payload) => {
        console.log('[Socket] Internal content-changed -> io.emit');
        io.emit('content-changed', payload || {});
      });
    } else {
      console.warn('[Socket] Bridge WARNING: global.__animebbgRealtimeEmitter NOT FOUND');
    }

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
