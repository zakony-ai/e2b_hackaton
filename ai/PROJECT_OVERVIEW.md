# Science research collaborator

## Architecture
  - typescript
  - pnpm
  - nextjs
  - spinning up kimi-k2 (via groq Responses API) in e2b container
    - using OpenAI SDK with Groq base URL: `https://api.groq.com/openai/v1`
    - model: `moonshotai/kimi-k2-instruct-0905`
    - see [mcp groq exa example](https://github.com/e2b-dev/e2b-cookbook/blob/main/examples/mcp-groq-exa-js/index.ts)
  - mcps to use 
    - for research 
      - start with [arXiv mcp](https://hub.docker.com/mcp/server/arxiv-mcp-server/overview) 
      - later we might to more complex [paper search mcp](https://hub.docker.com/mcp/server/paper-search/overview)

### Need to analyze
  - **e2b containers initiated by nextj server actions**: is this possible via server actions? can the serverless action spin the e2b container with the kimi k2 agent and just pass the UI the connection so the serverless function can die than and agent lives on i nthe container?
  - **when to kill the e2b container**: is there a best practice on how to handle this when building agents inside e2b containers? or multiple ones with trafeoffs? lets research and compare
  - **storing state**: 
    - if user refresehs the UI, we would lose the conenction to the e2b container? Can we store it in the local storage so we dont have to ahve a DB? Can we have DB like experience via local-storage/browswe to also store the conversations and etc. - is this more hussle that hosting a DB or viable solution?
    - would it be better to just kill the e2b container when the FE session disconnects (suer closes/refreshes the browser tab) so we dont have to keep the connection handle somewhere on the FE or db - is this possible - how?
  - **agentic loop**: would it be better to 
    - just user responses api and get agentic loop "for free" and if user has a folow up we spin up a new e2b container while passing the convo history. this means we can kill the e2b container when the responses api responds and we send the info to FE?
    - write or reuse some existing (research what would be good) basic agentic loop that enables user followups and only kill the container. This menas we can kil the e2b container when there is no followup prompt for some time, or only after user closes the broswer - or both?
    
### Proposed architecture

#### Overview
Frontend connects directly to an SSE server running inside an E2B sandbox (using Hono). The Next.js serverless function only handles sandbox creation and setup, then returns the sandbox's public URL. All streaming happens directly between the browser and the sandbox.

**Flow:**
1. Next.js API route creates E2B sandbox and starts Hono SSE server inside it (~1-2s)
2. Returns public sandbox URL to frontend via `getHost(8000)`
3. Frontend connects directly to sandbox via EventSource
4. Streaming happens directly between browser ↔ sandbox

#### Core Principles
1. **Serverless optimization**: Next.js function runs for 1-2s (setup only), then dies
2. **Direct connection**: Frontend connects to sandbox's public URL via `getHost(8000)`
3. **Stream locking**: Hono server prevents duplicate streams (423 Locked status)
4. **Abort detection**: Kimi-K2 API call aborted when client disconnects via `AbortController`
5. **No database required**: Use localStorage for sandbox ID + conversation history
6. **Filesystem persistence**: Sandbox stays alive post-streaming for file access and follow-ups
7. **No timeout limits**: Sandbox can stream for 10+ minutes (configurable via `timeoutMs`)

---

#### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Next.js Frontend                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  React State:                                         │  │
│  │   - sandboxId: string | null                          │  │
│  │   - messages: Message[]                               │  │
│  │   - isStreaming: boolean                              │  │
│  │   - eventSourceRef: EventSource | null               │  │
│  │                                                        │  │
│  │  LocalStorage:                                        │  │
│  │   - sandboxId (after successful completion)           │  │
│  │   - messages (conversation history)                   │  │
│  │                                                        │  │
│  │  Messages sent with EVERY request for context        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────┬───────────────────────────────────────────────────┬───┘
      │                                                   │
      │ 1. POST /api/research                            │ 3. EventSource(streamUrl)
      │    { query, sandboxId, messages }                │    Direct SSE connection
      │    Returns: { sandboxId, streamUrl }             │
      │                                                   │
┌─────▼──────────────────────┐              ┌────────────▼────────────┐
│   Next.js API Routes       │              │   E2B Sandbox           │
│  ┌──────────────────────┐  │              │  ┌──────────────────┐   │
│  │ /api/research:       │  │              │  │ Hono SSE Server  │   │
│  │  1. Create sandbox   │  │              │  │ (Port 8000)      │   │
│  │  2. npm install      │  │              │  │                  │   │
│  │  3. Write server.ts  │  │              │  │ GET /stream:     │   │
│  │  4. Start Hono       │  │              │  │  - Lock check    │   │
│  │  5. getHost(8000)    │  │              │  │  - AbortCtrl     │   │
│  │  6. Return URL       │  │              │  │  - Groq stream   │   │
│  │  Duration: ~2s       │  │              │  │  - onAbort()     │   │
│  └──────────────────────┘  │              │  │                  │   │
│                             │              │  │ GET /health:     │   │
│  ┌──────────────────────┐  │              │  │  - Status check  │   │
│  │ /api/cleanup:        │  │              │  └──────────────────┘   │
│  │  - Kill sandbox      │  │              │                         │
│  │  - Called on unmount │  │              │  ┌──────────────────┐   │
│  └──────────────────────┘  │              │  │ Kimi-K2 Agent    │   │
└─────────────┬───────────────┘              │  │ via Groq API     │   │
              │                              │  └────────┬─────────┘   │
              │ Creates/kills                │           │             │
              │                              │  ┌────────▼─────────┐   │
              │                              │  │ arXiv MCP Server │   │
              └──────────────────────────────┤  │ (Docker)         │   │
                                             │  └──────────────────┘   │
                                             └─────────────────────────┘
                                                      │
                                             Public URL via getHost(8000)
                                             https://8000-xxx.e2b.app
```

---

#### Data Flow

**1. Initial Research Query**
```
User submits query
  ↓
Frontend: POST /api/research { query, sandboxId?: null, messages: [] }
  ↓
Backend (/api/research):
  - Create E2B sandbox:
    * timeoutMs: 10 * 60 * 1000 (10 minutes)
    * mcp: { 'arxiv-mcp-server': {} }
  - Install dependencies: npm install hono openai
  - Write Hono SSE server code to /home/user/server.ts
  - Start Hono server: node --loader ts-node/esm server.ts (background)
  - Get public URL: await sandbox.getHost(8000)
  - Return: { sandboxId, streamUrl, healthUrl }
  - Duration: ~2 seconds
  ↓
Frontend:
  - Receives { sandboxId, streamUrl }
  - Creates EventSource(streamUrl)
  - Connects directly to sandbox (browser → sandbox, no proxy)
  ↓
Sandbox Hono Server (/stream endpoint):
  - Checks if stream already active (isStreamingActive flag)
  - If active: return 423 Locked
  - If not active: start streaming
  - Creates AbortController
  - Calls Groq Responses API with abort signal
  - Streams Kimi-K2 output via SSE to browser
  ↓
Frontend:
  - Receives SSE events (type: 'content')
  - Updates UI in real-time
  - On 'done' event:
    * Close EventSource
    * Save sandboxId to localStorage
    * Mark message as complete
```

**2. Client Disconnect During Streaming**
```
User closes tab / refreshes / network drops
  ↓
Browser closes EventSource connection
  ↓
Sandbox Hono Server detects disconnect:
  - stream.onAbort() callback fires
  - abortController.abort() called
  - Groq Responses API call aborted via signal
  - Kimi-K2 stops processing immediately
  - isStreamingActive = false
  ↓
Sandbox stays alive (within 10 min timeout)
User can reconnect later with same sandboxId
```

**3. Follow-up Query (Reusing Sandbox)**
```
User asks follow-up question
  ↓
Frontend: POST /api/research {
  query: "follow-up question",
  sandboxId: "existing-id",
  messages: [...full conversation history from localStorage]
}
  ↓
Backend:
  - Connect to existing sandbox: await Sandbox.connect(sandboxId)
  - Skip npm install (already installed)
  - Write new server.ts with updated conversation history
  - Restart Hono server
  - Return: { sandboxId, streamUrl }
  ↓
Frontend connects to streamUrl (same flow as initial query)
  ↓
Hono server has full conversation context
Kimi-K2 continues conversation with context
```

**4. Cleanup Triggers**
```
Sandbox is killed when:
  1. User navigates away (useEffect cleanup → POST /api/cleanup)
  2. Inactivity timeout reached (10 min, auto-kill by E2B)
  3. Manual user action ("End Session" button → POST /api/cleanup)

On cleanup:
  - sandboxId removed from localStorage
  - EventSource closed if still open
  - Sandbox terminated via E2B API
```

---

#### Lifecycle Management

**Sandbox States**
```typescript
type SandboxLifecycle =
  | 'creating'     // Spinning up E2B container
  | 'streaming'    // Groq Responses API executing, SSE active
  | 'idle'         // Streaming complete, waiting for follow-up
  | 'killed'       // Terminated (disconnect or timeout)
```

**Timeout Strategy**
```typescript
const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// On sandbox creation
const sandbox = await Sandbox.create({
  timeoutMs: INACTIVITY_TIMEOUT,
  // Auto-kill on timeout (no pause, simple cleanup)
});

// On each interaction (follow-up query)
await sandbox.setTimeout(INACTIVITY_TIMEOUT); // Reset timer
```

**SSE Connection Lifecycle**
```
SSE dies when:
  ✓ User closes browser tab         → req.signal aborts
  ✓ User refreshes page             → req.signal aborts
  ✓ User navigates away             → req.signal aborts
  ✓ Network connection lost         → req.signal aborts (after timeout)
  ✓ Browser/computer sleeps         → req.signal aborts eventually

How req.signal abort detection works:
1. Server returns: new Response(stream, { 'Content-Type': 'text/event-stream' })
2. HTTP connection stays OPEN while stream is active
3. Client disconnect closes HTTP connection
4. req.signal receives 'abort' event
5. Backend checks streamingCompleted flag:
   - false → Kill sandbox (user disconnected mid-stream)
   - true → Keep sandbox (user disconnected after success, might return)

Is this enough to prevent hanging sandboxes?
  → YES for tab close/refresh during streaming (immediate abort + kill)
  → YES for completion (abort doesn't kill, timeout handles cleanup)
  → BACKUP: E2B timeout kills sandbox after INACTIVITY_TIMEOUT anyway

Edge cases:
  - User closes tab AFTER streaming completes:
    → abort fires, but streamingCompleted=true → sandbox stays alive
    → Cleaned up by 10min timeout or user's next visit
  - Network hiccup during streaming:
    → abort fires, streamingCompleted=false → sandbox killed
    → User must retry (safe, prevents orphaned sandboxes)
```

---

#### Implementation Details

**API Route: /api/research**
```typescript
// app/api/research/route.ts
import { Sandbox } from '@e2b/code-interpreter';

export async function POST(req: Request) {
  const { query, sandboxId, messages = [] } = await req.json();

  try {
    // Create or connect to sandbox
    const sandbox = sandboxId
      ? await Sandbox.connect(sandboxId)
      : await Sandbox.create({
          timeoutMs: 10 * 60 * 1000, // 10 min
          mcp: { 'arxiv-mcp-server': {} },
          metadata: { createdAt: Date.now() }
        });

    // Install dependencies in sandbox (if new sandbox)
    if (!sandboxId) {
      await sandbox.commands.run('npm install hono openai');
    }

    // Build conversation history
    const conversationHistory = messages.map((m: any) => ({
      role: m.role,
      content: m.content
    }));

    // Add current query
    conversationHistory.push({
      role: 'user',
      content: query
    });

    // Get MCP credentials
    const mcpUrl = sandbox.getMcpUrl();
    const mcpToken = await sandbox.getMcpToken();

    // Write Hono SSE server code to sandbox
    const serverCode = `
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { cors } from 'hono/cors';
import OpenAI from 'openai';

const app = new Hono();

// Enable CORS for frontend
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

// Shared state
let isStreamingActive = false;
let abortController: AbortController | null = null;

app.get('/health', (c) => {
  return c.json({ status: 'ok', streaming: isStreamingActive });
});

app.get('/stream', async (c) => {
  // Lock: Only allow one active stream at a time
  if (isStreamingActive) {
    return c.json(
      { error: 'Stream already in progress' },
      423 // 423 Locked
    );
  }

  return streamSSE(c, async (stream) => {
    isStreamingActive = true;
    abortController = new AbortController();

    // Handle client disconnect
    stream.onAbort(() => {
      console.log('[SSE] Client disconnected, aborting Kimi-K2...');
      abortController?.abort();
      isStreamingActive = false;
    });

    try {
      // Create Groq client
      const client = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1'
      });

      // Get conversation history from query params (or could be POST body)
      const conversationHistory = ${JSON.stringify(conversationHistory)};

      // Build conversation text
      const conversationText = conversationHistory
        .map((msg: any) => \`\${msg.role}: \${msg.content}\`)
        .join('\\n');

      // Stream from Groq Responses API
      const response = await client.responses.create(
        {
          model: 'moonshotai/kimi-k2-instruct-0905',
          input: conversationText,
          tools: [
            {
              type: 'mcp',
              server_label: 'e2b-mcp-gateway',
              server_url: '${mcpUrl}',
              headers: {
                Authorization: \`Bearer ${mcpToken}\`
              }
            }
          ],
          stream: true
        },
        {
          signal: abortController.signal // Pass abort signal to Groq
        }
      );

      // Stream chunks to SSE
      for await (const chunk of response) {
        // Check if aborted
        if (abortController.signal.aborted) {
          console.log('[SSE] Aborted during streaming');
          break;
        }

        // Extract text from chunk
        let text = '';
        if (chunk.output_text) {
          text = chunk.output_text;
        } else if (chunk.delta) {
          text = chunk.delta;
        }

        if (text) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'content',
              text
            })
          });
        }
      }

      // Send done event if not aborted
      if (!abortController.signal.aborted) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'done'
          })
        });
      }

    } catch (error: any) {
      // Check if error is due to abort
      if (error.name === 'AbortError' || abortController?.signal.aborted) {
        console.log('[SSE] Stream aborted by client');
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'aborted',
            message: 'Stream cancelled by client'
          })
        });
      } else {
        console.error('[SSE] Error:', error);
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'error',
            text: error.message || 'Unknown error'
          })
        });
      }
    } finally {
      isStreamingActive = false;
      abortController = null;
    }
  });
});

// Start server
const port = 8000;
console.log(\`Starting Hono SSE server on port \${port}...\`);
serve({
  fetch: app.fetch,
  port
});
`;

    // Write server code to file
    await sandbox.files.write('/home/user/server.ts', serverCode);

    // Start the server in background
    await sandbox.commands.run(
      'GROQ_API_KEY=' + process.env.GROQ_API_KEY + ' node --loader ts-node/esm server.ts',
      { background: true }
    );

    // Wait a moment for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get public URL
    const streamUrl = await sandbox.getHost(8000);

    // Return sandbox info and stream URL
    // Serverless function dies here!
    return Response.json({
      sandboxId: sandbox.sandboxId,
      streamUrl: streamUrl + '/stream',
      healthUrl: streamUrl + '/health'
    });

  } catch (error: any) {
    console.error('Error setting up sandbox:', error);
    return Response.json(
      { error: error.message || 'Failed to setup sandbox' },
      { status: 500 }
    );
  }
}
```

**API Route: /api/cleanup**
```typescript
// app/api/cleanup/route.ts

export async function POST(req: Request) {
  const { sandboxId } = await req.json();

  if (!sandboxId) {
    return Response.json({ error: 'sandboxId required' }, { status: 400 });
  }

  try {
    const sandbox = await Sandbox.connect(sandboxId);
    await sandbox.kill();

    console.log(`Sandbox ${sandboxId} killed successfully`);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Failed to kill sandbox:', error);
    // Sandbox might already be dead, which is fine
    return Response.json({ success: true }); // Return success anyway
  }
}
```

---

**Frontend Component**
```typescript
// app/components/ResearchChat.tsx
'use client'

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  complete: boolean;
}

export function ResearchChat() {
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('messages');
    return saved ? JSON.parse(saved) : [];
  });

  // Persistent sandboxId (only set after successful streaming completion)
  const [sandboxId, setSandboxId] = useState<string | null>(() =>
    localStorage.getItem('sandboxId')
  );

  // Track if SSE is actively streaming
  const [isStreaming, setIsStreaming] = useState(false);

  // Store EventSource ref for cleanup
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-save messages
  useEffect(() => {
    localStorage.setItem('messages', JSON.stringify(messages));
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Close SSE connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // Kill sandbox
      if (sandboxId) {
        fetch('/api/cleanup', {
          method: 'POST',
          body: JSON.stringify({ sandboxId }),
          keepalive: true // Ensure cleanup runs even during navigation
        });

        // Clear from localStorage
        localStorage.removeItem('sandboxId');
      }
    };
  }, [sandboxId]);

  async function sendMessage(query: string) {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query,
      complete: true
    };

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      complete: false
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    try {
      // Step 1: Call /api/research to setup sandbox (fast, 1-2s)
      const setupResponse = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          sandboxId, // Reuse existing sandbox if available
          messages   // Send conversation history for context
        })
      });

      if (!setupResponse.ok) {
        throw new Error('Failed to setup sandbox');
      }

      const { sandboxId: newSandboxId, streamUrl, healthUrl } = await setupResponse.json();

      console.log('Sandbox ready:', { sandboxId: newSandboxId, streamUrl });

      // Step 2: Connect directly to sandbox SSE endpoint
      const eventSource = new EventSource(streamUrl);
      eventSourceRef.current = eventSource;

      let content = '';

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'content') {
          // Accumulate content
          content += data.text;

          // Update UI
          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id
              ? { ...m, content }
              : m
            )
          );
        }
        else if (data.type === 'done') {
          // Stream completed successfully
          eventSource.close();
          eventSourceRef.current = null;

          // Mark message as complete
          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id
              ? { ...m, complete: true }
              : m
            )
          );

          // Save sandboxId for future queries
          setSandboxId(newSandboxId);
          localStorage.setItem('sandboxId', newSandboxId);

          // Stop streaming state
          setIsStreaming(false);
        }
        else if (data.type === 'aborted') {
          // Stream was aborted
          eventSource.close();
          eventSourceRef.current = null;

          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id
              ? { ...m, content: content || 'Stream cancelled', complete: false }
              : m
            )
          );

          setIsStreaming(false);
        }
        else if (data.type === 'error') {
          // Error occurred
          console.error('Stream error:', data.text);
          eventSource.close();
          eventSourceRef.current = null;

          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id
              ? { ...m, content: content || `Error: ${data.text}`, complete: false }
              : m
            )
          );

          setIsStreaming(false);
        }
      };

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        eventSource.close();
        eventSourceRef.current = null;

        // Check if we got a 423 (stream locked)
        if (eventSource.readyState === EventSource.CLOSED) {
          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id
              ? {
                  ...m,
                  content: content || 'Connection error. The stream may already be in use.',
                  complete: false
                }
              : m
            )
          );
        }

        setIsStreaming(false);
      };

    } catch (error) {
      console.error('Failed to start streaming:', error);

      setMessages(prev =>
        prev.map(m => m.id === assistantMsg.id
          ? { ...m, content: 'Failed to start research session', complete: false }
          : m
        )
      );

      setIsStreaming(false);
    }
  }

  // Manual cleanup function (e.g., "End Session" button)
  async function endSession() {
    if (sandboxId) {
      await fetch('/api/cleanup', {
        method: 'POST',
        body: JSON.stringify({ sandboxId })
      });

      // Clear from state and localStorage
      setSandboxId(null);
      localStorage.removeItem('sandboxId');
    }
  }

  return (
    <div>
      <MessageList messages={messages} />

      <ChatInput
        onSubmit={sendMessage}
        disabled={isStreaming}  // Disable input while streaming
        placeholder={isStreaming ? "Thinking..." : "Ask a research question..."}
      />

      {/* Status indicators */}
      <div className="flex items-center gap-4 text-xs">
        {isStreaming && (
          <div className="text-blue-600 flex items-center gap-2">
            <Spinner />
            <span>Streaming response...</span>
          </div>
        )}

        {sandboxId && !isStreaming && (
          <div className="flex items-center gap-2 text-gray-500">
            <span>Session active • Files available</span>
            <button
              onClick={endSession}
              className="text-red-600 hover:underline"
            >
              End Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

---

#### Edge Cases & Error Handling

**1. User Refreshes/Closes Tab During Streaming**
- EventSource disconnects from sandbox
- `stream.onAbort()` fires inside Hono server
- Groq Responses API call aborted via `abortController.signal`
- Kimi-K2 stops processing immediately
- Sandbox stays alive (user can reconnect with sandboxId if within timeout)
- Frontend can retry by reconnecting to same sandbox

**2. Stream Already In Use (423 Locked)**
- User accidentally tries to stream twice to same sandbox
- Hono server checks `isStreamingActive` flag
- Returns 423 status code: `{ error: 'Stream already in progress' }`
- Frontend displays error to user
- Prevents duplicate Kimi-K2 calls

**3. User Closes Tab After Streaming Completes**
- EventSource closed by browser
- Sandbox remains alive (within 10 min timeout)
- `useEffect` cleanup calls `/api/cleanup` to kill sandbox
- localStorage cleared

**4. Network Hiccup During Streaming**
- EventSource disconnects after ~30-60s
- `stream.onAbort()` fires, Kimi-K2 call aborted
- Sandbox stays alive
- User can retry with same sandboxId (reconnect)

**5. Multiple Tabs**
- Each tab maintains its own sandboxId in localStorage
- No shared state between tabs
- Each tab can have its own active sandbox
- Closing one tab doesn't affect others

**6. Sandbox Hangs/Crashes**
- E2B timeout (10 min) kills it automatically
- No infinite loops or resource leaks
- User sees connection error in frontend
- Can retry with new sandbox

**7. User Refreshes After Successful Completion**
- sandboxId exists in localStorage
- Sandbox is still alive (within 10 min timeout)
- Conversation history restored from localStorage
- User can continue with follow-up queries
- Follow-up requests include full message history for context

**8. Conversation History Management**
- Frontend stores messages in localStorage (always persisted)
- Frontend sends complete message history with EVERY request
- Hono server receives conversation history, passes to Kimi-K2
- E2B sandbox only persists filesystem (papers, data), NOT conversation
- Enables stateless sandbox with stateful conversation UX

---

#### Configuration Constants

```typescript
// lib/config.ts
export const CONFIG = {
  // Sandbox auto-kill after inactivity
  INACTIVITY_TIMEOUT: 10 * 60 * 1000, // 10 minutes

  // Maximum sandbox lifetime (safety limit)
  MAX_SANDBOX_LIFETIME: 30 * 60 * 1000, // 30 minutes

  // Hono SSE server port inside sandbox
  SSE_SERVER_PORT: 8000,

  // E2B template/MCP config
  MCP_SERVERS: {
    'arxiv-mcp-server': {}
  },

  // Groq model (via Responses API)
  MODEL: 'moonshotai/kimi-k2-instruct-0905', // Kimi-K2 on Groq

  // LocalStorage keys
  STORAGE_KEYS: {
    SANDBOX_ID: 'sandboxId',      // Only set when sandbox alive with completed work
    MESSAGES: 'messages',          // Conversation history (always persisted)
  },

  // Environment variables needed
  ENV_VARS: {
    GROQ_API_KEY: 'Get from https://console.groq.com/keys',
    E2B_API_KEY: 'Get from https://e2b.dev/docs',
  }
} as const;
```

---

#### Testing Checklist

**Direct Sandbox SSE Architecture:**

- [ ] Fresh query creates sandbox and starts Hono server (< 3s)
- [ ] Backend returns `sandboxId`, `streamUrl`, `healthUrl`
- [ ] Frontend connects to `streamUrl` via EventSource
- [ ] `isStreaming` becomes true when SSE starts, false when done/error
- [ ] Input disabled while `isStreaming` is true
- [ ] Loading indicator shows while streaming
- [ ] Content streams from Kimi-K2 via Groq Responses API
- [ ] Sandbox ID saved to localStorage ONLY after streaming completes
- [ ] Follow-up query reuses sandbox (sandboxId from localStorage)
- [ ] Follow-up query sends conversation history (messages from localStorage)
- [ ] Agent has context from previous messages in follow-ups
- [ ] **Stream locking works**: Second `/stream` call returns 423 while first is active
- [ ] **Client disconnect aborts Kimi-K2**: Close tab during streaming → check logs for abort
- [ ] Tab close after streaming calls `/api/cleanup` → sandbox killed
- [ ] Page refresh after completion preserves sandboxId + conversation
- [ ] Inactivity timeout (10 min) kills sandbox
- [ ] Manual "End Session" button kills sandbox + clears localStorage
- [ ] "End Session" button hidden while streaming (only shown when idle)
- [ ] Error messages stream correctly
- [ ] Multiple concurrent users don't interfere (each gets own sandbox)
- [ ] Verify Next.js serverless function dies after 1-2s (check Vercel logs)
- [ ] `/health` endpoint works (returns `{ status: 'ok', streaming: true/false }`)

---

#### Future Enhancements

1. **Message Recovery**: Persist messages in DB for cross-device usage + allow FE reconnects to existing streams
2. **Pause/Resume**: Use E2B `betaPause()` for cost optimization during idle periods
3. **Security**: Add authentication to sandbox URL via `allowPublicTraffic: false` + `trafficAccessToken`
4. **Caching**: Store Hono server code in custom E2B template to skip npm install step
5. **Monitoring**: Add telemetry to track sandbox usage, stream duration, costs

---

## Architecture Summary

### Key Components

**1. Next.js API Route (`/api/research`)**
- Creates/connects to E2B sandbox
- Installs Hono + OpenAI SDK in sandbox
- Writes Hono SSE server code to sandbox filesystem
- Starts Hono server on port 8000
- Returns public sandbox URL via `getHost(8000)`
- **Dies after 1-2 seconds** ✅

**2. Hono SSE Server (Inside E2B Sandbox)**
- Runs on port 8000, exposed via E2B public URL
- `/stream` endpoint: Streams Kimi-K2 responses via SSE
- `/health` endpoint: Returns server status
- **Stream locking**: Prevents duplicate active streams (423 status)
- **Abort detection**: Kills Groq API call when client disconnects
- Uses `stream.onAbort()` to detect client disconnect
- Passes `abortController.signal` to Groq Responses API

**3. Frontend (`ResearchChat.tsx`)**
- Calls `/api/research` to setup sandbox
- Receives `streamUrl` from backend
- Connects directly to sandbox via EventSource
- Streams content in real-time
- Handles disconnect, errors, completion
- Stores sandboxId + messages in localStorage

**4. Cleanup API (`/api/cleanup`)**
- Kills sandbox by ID
- Called on unmount or manual "End Session"

### Data Flow

```
User Query
    ↓
[Frontend] POST /api/research { query, sandboxId, messages }
    ↓
[Next.js API] Create/connect sandbox, start Hono server (~1-2s)
    ↓
[Next.js API] Return { sandboxId, streamUrl } ← **Function dies here**
    ↓
[Frontend] Connect to streamUrl via EventSource
    ↓
[E2B Sandbox Hono] Stream Kimi-K2 via Groq Responses API
    ↓
[E2B Sandbox Hono] Send SSE events to browser
    ↓
[Frontend] Update UI in real-time
    ↓
[Frontend] On done: Save sandboxId to localStorage
    ↓
[Frontend] On followup: Reuse sandboxId, send messages history
```

### Key Features Implemented

✅ **Serverless cost optimization**: Next.js function runs 1-2s only
✅ **No timeout limits**: Sandbox streams for 10+ minutes
✅ **Stream locking**: 423 status if stream already active
✅ **Abort detection**: Kimi-K2 aborted on client disconnect
✅ **Direct connection**: Browser ↔ Sandbox (no proxy)
✅ **Conversation history**: Full context passed with every request
✅ **Follow-up queries**: Reuse sandbox for multi-turn conversations
✅ **Graceful cleanup**: Sandbox killed on unmount/timeout
✅ **Error handling**: Network issues, stream errors, locked streams

### Cost & Performance

**Serverless Function:**
- Duration: 1-2 seconds (setup only)
- Cost: Minimal (charged only for setup time)

**Streaming:**
- Duration: 10+ minutes (configurable via `timeoutMs`)
- No serverless timeout limits
- Direct browser → sandbox connection
- Lower latency (no proxy hop)

### Architecture Benefits

1. **Cost-effective**: Minimal serverless usage (1-2s per query)
2. **Scalable**: No platform timeout limits (10+ min streams)
3. **Advanced**: Direct sandbox connection via E2B's `getHost()`
4. **Production-ready**: Stream locking, abort detection, error handling
5. **Simple**: Uses standard SSE (EventSource API), no WebSocket complexity
