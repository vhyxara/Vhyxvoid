// import { createServer } from 'http';
// import { Server as SocketIOServer } from 'socket.io';
// import { env } from '@/config/env';
// import { logger } from '@/config/logger';
// import app from '@/app';
// import { registerSocketHandlers } from '@/ws/handlers';
// import { socketAuth } from './ws/middleware/auth';
// import { connectDB } from '@/config/db';

// const startSocketServer = () => {
//   const httpServer = createServer(app);
//   const io = new SocketIOServer(httpServer, {
//     cors: {
//       origin: '*',
//     },
//   });
//   io.use(socketAuth);

//   io.on('connection', (socket) => {
//     logger.info(`Socket connected: ${socket.id}`);
//     registerSocketHandlers(socket);

//     socket.on('disconnect', () => {
//       logger.info(`Socket disconnected: ${socket.id}`);
//     });

//     socket.on('error', (error) => {
//       logger.error(`Socket error: ${error}`);
//     });
//     socket.on('ping', () => {
//       socket.emit('pong');
//     });
//   });

//   httpServer.listen(env.PORT, () => {
//     logger.info(`WebSocket server listening on port ${env.PORT}`);
//   });
// };

// startSocketServer();
