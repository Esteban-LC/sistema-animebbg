const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port: Number(port) });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
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
      emitter.on('notification', (payload) => {
        io.emit('notification', payload);
      });
      emitter.on('content-changed', (payload) => {
        io.emit('content-changed', payload);
      });
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
