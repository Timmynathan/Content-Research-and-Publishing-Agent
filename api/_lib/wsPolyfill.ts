import { WebSocket as NodeWebSocket } from "ws";

// supabase-js unconditionally constructs a realtime client (which needs
// a WebSocket constructor) as soon as createClient() runs, even though
// nothing here uses realtime subscriptions. Node < 22 has no native
// global WebSocket, so without this polyfill the first createClient()
// call on this runtime throws immediately. No-op on Node >= 22 and in
// the browser, where a native WebSocket already exists.
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as unknown as { WebSocket: typeof NodeWebSocket }).WebSocket = NodeWebSocket;
}
