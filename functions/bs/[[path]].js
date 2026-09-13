// Production replacement for the Vite dev `/bs` proxy (see vite.config.ts).
// Robinhood Chain's Blockscout sits behind a Cloudflare UA gate and blocks
// cross-origin browser reads, so the app calls same-origin `/bs/...` and this
// Pages Function forwards to the explorer with a browser User-Agent.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ORIGIN = "https://robinhoodchain.blockscout.com";

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/bs/, "");
  const target = ORIGIN + path + url.search;

  const init = {
    method: request.method,
    headers: { "User-Agent": UA, Accept: "application/json" },
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }

  try {
    const upstream = await fetch(target, init);
    const body = await upstream.arrayBuffer();
    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") || "application/json");
    // Short cache so a room full of testers doesn't hammer the explorer.
    headers.set("cache-control", "public, max-age=15");
    return new Response(body, { status: upstream.status, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: "blockscout_proxy_failed", detail: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
