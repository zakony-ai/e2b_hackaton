# STEP 2

We want minimal setup for testing the server - groq interaction, and streaming to FE.

Goal is to send user prompt from the nextjs fe using /agent/talk to the hono server, which calls the responses api using groq and kimi-k2 and sends the sse to the FE which shows it above the prompt-input (as conversation), but lets keep it formated vertical list of formated jsons.
Take a look at this example https://github.com/e2b-dev/e2b-cookbook/blob/main/examples/mcp-groq-exa-js/index.ts . one problem is that we are not using sandbox here, so we need to serve the arxiv mcp differently as we cannot use this part of the example
const sandbox = await Sandbox.create({
  mcp: { ..mcp configs.. },
  timeoutMs: 600_000, // 10 minutes
});
So please research a way of how to serve the arxiv mcp (https://hub.docker.com/mcp/server/arxiv-mcp-server/overview) alongside the hono server so that ResponsesAPI have access to it.

## client wiring
1. add NEXT_PUBLIC_USE_WITHOUT_SANDBOX (boolean) and DIRECT_SERVER_URL (string) to /client's .env.local
  - when pnpm dev:without-sandbox is run pass USE_WITHOUT_SANDBOX as true to the nextjs
  - set DIRECT_SERVER_URL as url to localhost with port 3001 (same as /server/a so it works when we run pnpm dev:without-sandbox) 
2. in /client, when prompt is submitted in page.tsx and NEXT_PUBLIC_USE_WITHOUT_SANDBOX is true, call DIRECT_SERVER_URL/agent/talk. if it's false call nextjs be /sandbox/create (which for now jsut returns 404)

## server /talk
Implement `/agent/talk` endpoint as described in [architecture doc](/ai/ARCHITECTIRE.md)

## testing
Ask user to provide necessary api keys into the env files. after provided we will test
