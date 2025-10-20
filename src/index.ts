// Durable Objects in Workers are instantiated by the runtime. You don't import/extend
// a DurableObject base class from "cloudflare:workers" in normal Worker TypeScript.
// Instead, implement a class that accepts state and env in the constructor.

export class WebSocketServer {
  state: DurableObjectState;
  env: any;
  sessions: Map<WebSocket, any>;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // Store active connections
  }

  // Handle fetch requests proxied to this Durable Object
  async fetch(request: Request): Promise<Response> {
    // Ensure this is a websocket upgrade
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    // Optional: you can inspect URL or headers for auth/room info. For
    // simplicity this DO will just accept the socket and let the client send
    // a join message if needed.

    // 1. Create the pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // 2. Accept the server-side connection and take ownership of the socket
    // DurableObjectState.acceptWebSocket is available on the state object
    // and will migrate the server socket into the DO instance.
    this.state.acceptWebSocket(server as any);

    // 3. Set up listeners (Echo & Broadcast example)
    server.addEventListener('message', (evt: MessageEvent) => {
      try {
        const text = evt.data?.toString?.() ?? String(evt.data);
        // simple protocol: JSON messages with {type: 'msg'|'join'|'leave', body}
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch (e) { /* not JSON - treat as plain msg */ }

        // If parsed and type is 'msg', broadcast; otherwise echo.
        if (parsed && parsed.type === 'msg') {
          const out = parsed.body ?? '';
          this.sessions.forEach((meta, ws) => {
            if (ws !== server && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ from: meta.id, body: out }));
            }
          });
        } else {
          // non-JSON or untyped messages: echo and also broadcast raw text
          this.sessions.forEach((meta, ws) => {
            if (ws !== server && ws.readyState === WebSocket.OPEN) {
              ws.send(`[Broadcast] ${text}`);
            }
          });
          if (server.readyState === WebSocket.OPEN) {
            server.send(`You sent: ${text}`);
          }
        }
      } catch (err) {
        // avoid crashing the DO on bad messages
        console.error('ws message handler error', err);
      }
    });

    server.addEventListener('close', () => this.sessions.delete(server));
    server.addEventListener('error', () => this.sessions.delete(server));

    // 4. Store the new connection with a small session id
    const sessionId = `${Date.now()}-${Math.floor(Math.random()*10000)}`;
    this.sessions.set(server, { id: sessionId, connectedAt: Date.now() });

    // Optionally persist a small counter in durable storage (non-critical)
    try {
      const count = (await this.state.storage.get<number>('count')) || 0;
      await this.state.storage.put('count', count + 1);
    } catch (e) {
      // ignore storage errors for now
    }

    // 5. Return the client-side WebSocket with the 101 Switching Protocols response
    return new Response(null, { status: 101, webSocket: client });
  }
}


export default {
  async fetch(request: Request, env: any) {
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
