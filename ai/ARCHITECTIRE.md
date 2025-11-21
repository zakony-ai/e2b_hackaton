# HIGH LEVEL ARCHITECTURE of Science research collaborator agent

## Tech stack
- typescript
- pnpm
- nextjs
- e2b sandbox (see [example](https://github.com/e2b-dev/e2b-cookbook/blob/main/examples/mcp-groq-exa-js/index.ts))
  - kimi-k2 via groq
  - arXiv docker MCP
  - hono server
  
## Project overview

In this project we will have "multirepo"
- nextjs app
- hono server (this will be built and then executer inside e2b sandbox on creation)

Commands:
  - for client (nextjs):
    - build `pnpm build:client` (next build)
    - dev `pnpm dev:client`
    - dev but using local hono server instead of spinnig it up in a sandbox `pnpm dev:client --without-sandbox`
  - for server (hono):
    - build `pnpm build:server`
    - testing in dev (locally without sandbox) `pnpm dev:server`
  - combined
    - `pnpm build` - builds both
    - `pnpm dev` - runs dev:client (server not needed as that will be ran inside sandbox)
    - `pnpm dev:without-sandbox` - runs dev:client --without-sandbox and dev:server using concurrently
    
### Components overview
NextJS FE
  - stores in localStorage:
    - key: `conversationId`, values: `{agentUrl: string, sandboxId: string}` pairs
  - calls NextJS BE (path: params-return types)
    - `sandbox/create`: `{} => { agentUrl: string}`
      - spins up e2b sandbox and rans the compiled hono server, which is waiting for /talk request
    - `sandbox/kill`: `{ sandboxId: string } => {}`
      - kills the sandbox
    - `sandbox/recreate`: `{ messages: Messages, papers: string[], oldSandboxId: string } => { agentUrl: string, sandboxId }`
      - checks whether the old sandbox exists, if it does, logs a warning with number of SSE connections it has and whether agent was talking or waiting, then kills it
      - spins up the e2b sandvox creates the messages.ndjson in the sandbox and recreates the downloaded papers .md files and run the hono server as in /create
  - calls agentUrl inside sandbox (see. hono server below for details)
    - `agent/talk`: `{ user_prompt: string } => sse-connection-stuff` | busy
    - `agent/sorryiwasntlistening`: `{} => { messages } & see-connection-stuff`
    - `agent/stfu`: `{} => {}`

Hono server
    - uses `openai` package (imports OpenAI and types, etc.)
    - state
      - has `stream: Stream<OpenAI.Responses.ResponseEvent> | null` stored (if null then `AgentWaiting`, otherwise `AgentTalking`)
      - has `connections` which are ongoing SSE connections to clients (FEs) through which is restreams the reponses stream
    - `agent/talk`
      - if AgentWaiting then initiates llm turn (call to kimi-k2 via Resposnes API) and
        - is storing the streamed response to messages.ndjson file
        - returns SSE stream to the FE and streams the response stream throught it
      - if AgentTalking then returns non 200 because it's alredy agent's turn and tells the client to use `agent/sorryiwasntlistening`
    - `agent/sorryiwasntlistening`
      - if AgentTalking then returns the history from messages.ndjson AND return SSE stream for this client (so we can have mutiple SSE connections to the same response api stream, e.g. if user opens the same conversation in two browser tabs.)
      - if AgentWaiting returns response saying that agent is not talking so client should use `agent/talk`
    - `agent/stfu`
      - if AgentTalking
        - stops the agent turn (ResponseAPI stream from groq), so it stops writing to messages.ndjson (messages.ndjson stays valid even if interrupted mid-stream - see Data Format section below)
        - closes the SSE connections clients (FEs)
      - if AgentWaiting
        - returns non 200 saying that agent is waiting, so client can use `agent/talk`

### Data Format: messages.ndjson

We use **NDJSON (Newline Delimited JSON)** format instead of regular JSON for conversation history storage. This provides clean, atomic message persistence.

**Why NDJSON?**
- Each line is a complete, valid JSON object
- File is never left in an invalid state, even if process crashes mid-write
- Easy to append new messages without parsing the entire file
- No duplicates or partial message entries to clean up

**Format:**
```
{"role":"user","content":"What is quantum entanglement?"}
{"role":"assistant","content":"Quantum entanglement is..."}
{"role":"user","content":"Can you search for papers about it?"}
```

**How Responses API streaming works:**
- OpenAI Responses API sends **deltas** (incremental text chunks), NOT progressive snapshots
- Each chunk contains only NEW text: `event.delta = "Hello"`, then `event.delta = " world"`, etc.
- We accumulate these deltas in memory during streaming
- **Only complete messages** are written to messages.ndjson (when stream finishes)

**Writing messages (complete messages only):**
```typescript
// DURING streaming: accumulate in memory
let fullMessage = '';
for await (const event of groqResponse) {
  if (event.type === 'response.output_text.delta') {
    fullMessage += event.delta;  // Accumulate deltas in memory
    // Re-stream to frontend via SSE (but don't write to file yet)
    await streamToClients(event.delta);
  }
  else if (event.type === 'response.completed') {
    // ONLY NOW write the complete message to messages.ndjson
    await fs.appendFile(
      'messages.ndjson',
      JSON.stringify({ role: 'assistant', content: fullMessage }) + '\n'
    );
  }
}
```

**Reading/reconstructing messages:**
```typescript
// Read file and parse each line
const fileContent = await fs.readFile('messages.ndjson', 'utf-8');
const messages = fileContent
  .trim()
  .split('\n')
  .filter(line => line.length > 0)
  .map(line => JSON.parse(line));
// No deduplication needed - each line is a unique complete message
```

**Recovery behavior:**
- If stream crashes mid-message: messages.ndjson won't have the incomplete assistant message
- Frontend will still display what it received via SSE (lives in browser state/localStorage)
- User can continue conversation - next complete message will be saved normally
- Trade-off: Clean storage and simple recovery logic > perfect crash recovery
- For critical use cases, frontend should persist its accumulated content to localStorage

## Interaction overview

### New research & Reconnecting to ongoing research
1. User goes to nextjs FE, where he submits a research question.
  This hits `/sandbox/create` endpoint
  
2. Nextjs BE spinns up e2b sandbox with the hono server and return the agentUrl and sandboxId

3. Nextjs FE stores the agentUrl into localStorage tied to the conversation id. Then it calls `{sandboxedAgentUrl}/agent/talk` with payload 
  ```ts
  {  user_message: string }
  ```
  Hono calls kimi-k2 via groq using OpenAI's compatible Resposnes API with the provided user_message, and
    - streams/stores the messages from Response API into a file messages.ndjson (so we have convo hsitory in sandbox not just FE)
    - return SSE stream to the nextjs FE
  Then it switches state to AgentTalking this locking `/agent/talk` while streaming response in progress, so subsequent calls return non 200 status so that we CANNOT create mutiple parallel streams in one sandbox. After the llm stream finishes, it is unlocked again, so that user may ask another prompt.
  If FE disconnects from the SSE stream, it continues streaming to the messages.ndjson file.

4. Nextjs FE recieves the SSE stream and keeps showing it to the user. User can
  - wait till the agent finshed his turn
  - click "stop" button if he doesn't like what is happening. This calls `/agent/stfu` endpoint. Hono server then
    - stops the Responses API stream to groq
    - ends the SSE connections to clients (FEs)
    - unlocks the `/agent/talk` endpoint
  - close the browser / browser tab / refresh the tab / otherwise interrupt the SSE stream (Hono server keeps saving the into messages.ndjson)
  - open the app in another tab/after some time, click on the ongoign conversation this calls `agent/sorryiwasntlistening` and gets the messages.ndjson to recosntruct the alredy streamed part and also gets SSE stream that restreams the responses api stream. If the agentUrl is not found anymore, this means the sandbox is probably dead, so it needs to call `sandbox/recreate`
