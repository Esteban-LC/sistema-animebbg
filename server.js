const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const busboy = require('busboy');

// Global store for pre-parsed upload bodies (bypass Next.js 10MB limit)
global.__uploadBuffers = new Map();

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

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url, true);

      // Intercept upload-redraw POST before Next.js touches the body (bypasses 10MB limit)
      if (req.method === 'POST' && parsedUrl.pathname === '/api/drive/upload-redraw') {
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
          global.__uploadBuffers.set(requestId, {
            assignmentId: Number(assignmentIdRaw),
            uploadFile: fileBuffer !== null ? { buffer: fileBuffer, name: fileName } : null,
          });
          req.headers['x-upload-request-id'] = requestId;
          handle(req, res, parsedUrl);
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
      origin: '*', // Adjust for production if needed
      methods: ['GET', 'POST'],
    },
  });

    io.on('connection', (socket) => {
      // console.log(`Socket connected: ${socket.id}`);
  
      socket.on('content-changed', (data) => {
        // Re-broadcast early to all *other* connected clients
        socket.broadcast.emit('content-changed', data || {});
      });
  
      socket.on('disconnect', () => {
        // console.log(`Socket disconnected: ${socket.id}`);
      });
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
