import { DurableObject } from "cloudflare:workers";

export class WebSocketServer  extends DurableObject{
  sessions: any;
  state: any
  constructor(state: any, env:any) {
    super(state, env);
    this.state = state;
    this.sessions = new Map(); // Store active connections
  }

  async fetch(request:any) {
    // 1. Create the pair
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // 2. Accept the server-side connection and take ownership
    server.accept()
    const id = crypto.randomUUID();
    // Add the WebSocket connection to the map of active sessions.
    this.sessions.set(server, { id });
    // 3. Set up listeners (Example: Echo and Broadcast)z
    server.addEventListener('message', event => {
      const connection = this.sessions.get(server);

      this.sessions.forEach((k, session) => {
        if (session !== server) {
          session.send(
            `[Durable Object] message: ${event.data}, from: ${connection.id}`,
          );
        }
      });
      server.send(`You sent: ${event.data}`);

    });

    
    server.addEventListener('error', () => this.sessions.delete(server));
    server.addEventListener('close', () => this.sessions.delete(server));
    
    
    return new Response(null, { status: 101, webSocket: client });
  }
}


export default {
  async fetch(request: any, env: any) {
    const url = new URL(request.url);

    // 1. Check for Upgrade Header
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    // 2. Get a Durable Object instance (e.g., a chat room named 'main')
    // Determine room name from the URL subdirectory (e.g. GET /room-name -> "room-name")
    const pathParts = url.pathname.split('/').filter(Boolean);
    const roomName = pathParts[0] ? decodeURIComponent(pathParts[0]) : 'main';
    // Sanitize and limit length to avoid long or invalid names
    const safeRoomName = roomName.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 64) || 'main';
    let id = env.WEBSOCKET_SERVER_DO.idFromName(safeRoomName);
    let stub = env.WEBSOCKET_SERVER_DO.get(id);

    // 3. Proxy the request to the Durable Object
    return stub.fetch(request);
  },
};
