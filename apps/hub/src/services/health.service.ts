export const HealthService = {
  checkStatus(): {
    status: string;
    message: string;
    uptime: number;
    timestamp: number;
  } {
    return {
      status: 'ok',
      message: 'Welcome to Backend API',
      uptime: process.uptime(),
      timestamp: Date.now(),
    };
  },

  checkHealth(): {
    status: string;
  } {
    return {
      status: 'ok',
    };
  },

  throwError(): never {
    throw new Error('Something went wrong');
  },

  getUptime(): {
    ok: boolean;
    uptime: number;
    timestamp: string;
  } {
    return {
      ok: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  },
};
