// Tracks browser WebSocket connections waiting for agent WS frames
export interface WsConnection {
  connectionId: string;
  accountId: string;
  agentId: string;
  socket: import('net').Socket;
  head: Buffer;
  buffer: Buffer[]; // frames buffered before agent opens backend WS
}

export class WsConnectionRegistry {
  private readonly connections = new Map<string, WsConnection>();

  register(conn: WsConnection): void {
    this.connections.set(conn.connectionId, conn);
  }

  get(connectionId: string): WsConnection | null {
    return this.connections.get(connectionId) ?? null;
  }

  delete(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  size(): number {
    return this.connections.size;
  }
}
