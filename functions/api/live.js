export async function onRequest({ request, env }) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }

  const apiKey = env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return new Response("Missing TWELVE_DATA_API_KEY secret", { status: 500 });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept({ allowHalfOpen: true });

  let upstream;

  try {
    const upstreamResponse = await fetch(
      "https://ws.twelvedata.com/v1/quotes/price?apikey=" + encodeURIComponent(apiKey),
      { headers: { Upgrade: "websocket" } }
    );

    upstream = upstreamResponse.webSocket;
    if (!upstream) {
      server.send(JSON.stringify({
        event: "proxy-error",
        message: "Twelve Data did not accept the WebSocket connection (HTTP " + upstreamResponse.status + ")."
      }));
      server.close(1011, "Upstream WebSocket unavailable");
      return new Response(null, { status: 101, webSocket: client });
    }

    upstream.accept({ allowHalfOpen: true });

    upstream.addEventListener("message", event => {
      try {
        server.send(typeof event.data === "string" ? event.data : event.data);
      } catch {
        // The browser may have disconnected.
      }
    });

    upstream.addEventListener("close", event => {
      try {
        if (server.readyState === WebSocket.OPEN) {
          server.send(JSON.stringify({
            event: "proxy-closed",
            code: event.code,
            reason: event.reason || "Twelve Data connection closed"
          }));
          server.close(event.code || 1011, "Twelve Data connection closed");
        }
      } catch {
        // The browser may have disconnected.
      }
    });

    upstream.addEventListener("error", () => {
      try {
        if (server.readyState === WebSocket.OPEN) {
          server.send(JSON.stringify({
            event: "proxy-error",
            message: "Connection to Twelve Data failed."
          }));
        }
      } catch {
        // The browser may have disconnected.
      }
    });

    server.addEventListener("message", event => {
      try {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(event.data);
        }
      } catch {
        // Ignore messages after upstream disconnect.
      }
    });

    server.addEventListener("close", event => {
      try {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.close(event.code || 1000, event.reason || "Browser disconnected");
        }
      } catch {
        // Already closed.
      }
    });

    server.send(JSON.stringify({ event: "proxy-connected" }));
    upstream.send(JSON.stringify({
      action: "subscribe",
      params: { symbols: "XAU/USD,BTC/USD" }
    }));
  } catch (error) {
    try {
      server.send(JSON.stringify({
        event: "proxy-error",
        message: "Could not connect to Twelve Data: " + (error?.message || "unknown error")
      }));
      server.close(1011, "Upstream connection failed");
    } catch {
      // Connection already closed.
    }
  }

  return new Response(null, { status: 101, webSocket: client });
}
