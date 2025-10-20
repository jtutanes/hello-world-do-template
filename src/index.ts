import { DurableObject } from "cloudflare:workers";

export class WebSocketServer  extends DurableObject{
  
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
    this.state.acceptWebSocket(server);

    // 3. Set up listeners (Example: Echo and Broadcast)
    server.addEventListener('message', event => {
      // Broadcast the received message to all other connected clients
      this.sessions.forEach((ws, id) => {
        if (ws !== server) {
          ws.send(`[Broadcast] ${event.data}`);
        }
      });
      // Send a direct reply/echo back to the sender
      server.send(`You sent: ${event.data}`);
    });

    server.addEventListener('close', () => this.sessions.delete(server));
    server.addEventListener('error', () => this.sessions.delete(server));
    
    // 4. Store the new connection
    this.sessions.set(server, { /* custom session data here */ });

    // 5. Return the client-side WebSocket with the 101 status
    return new Response(null, { status: 101, webSocket: client });
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Check for Upgrade Header
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    // 2. Get a Durable Object instance (e.g., a chat room named 'main')
    let id = env.WEBSOCKET_SERVER_DO.idFromName('main');
    let stub = env.WEBSOCKET_SERVER_DO.get(id);

    // 3. Proxy the request to the Durable Object
    return stub.fetch(request);
  },
};
