import { logger } from './logger';
import { prisma } from '@/config/prisma';

export const connectDB = async () => {
  logger.info('Connected to Database to prisma');
};

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  logger.info('SIGINT received. Shutting down...');
  process.exit(0);
});
