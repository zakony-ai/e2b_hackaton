# Environment Variable Setup Guide

## Overview

This monorepo uses workspace-specific environment files. Understanding where variables are used is crucial for proper configuration.

## Architecture & Environment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Local Development Machine                                       │
│                                                                  │
│  ┌────────────────────┐                                         │
│  │ /client/.env.local │                                         │
│  │                    │                                         │
│  │ E2B_API_KEY ────────┼───► Next.js API Routes                 │
│  │ GROQ_API_KEY       │     (/api/sandbox/create)               │
│  └────────────────────┘          │                              │
│                                   │                              │
│                                   ▼                              │
│                           Creates E2B Sandbox                    │
│                           Passes GROQ_API_KEY ──────────────┐   │
│                                                              │   │
└──────────────────────────────────────────────────────────────┼───┘
                                                               │
                    ┌──────────────────────────────────────────┘
                    │
                    ▼
         ┌─────────────────────────────┐
         │ E2B Sandbox (Remote)        │
         │                             │
         │  ┌────────────────────┐     │
         │  │ Hono Server        │     │
         │  │                    │     │
         │  │ GROQ_API_KEY ◄─────┼─────┼─ Received via env var
         │  │ (from cmd line)    │     │   when process starts
         │  └────────────────────┘     │
         │                             │
         └─────────────────────────────┘
```

## File Locations

### `/client/.env.local` (Git-ignored)
**Used by:** Next.js app (API routes, server components)
**Loaded by:** Next.js automatically
**Contents:**
```bash
E2B_API_KEY=e2b_xxxxx      # Creates/manages E2B sandboxes
GROQ_API_KEY=gsk_xxxxx     # Passed to Hono server in sandbox
```

### `/server/.env` (Git-ignored)
**Used by:** Hono server during local development only
**Loaded by:** `import 'dotenv/config'` in server/src/index.ts
**Contents:**
```bash
PORT=3001                  # Local dev port
GROQ_API_KEY=gsk_xxxxx     # For testing locally
```

**Important:** When running in E2B sandbox, `GROQ_API_KEY` is **NOT** read from this file. It's passed via command line argument from the Next.js API route.

## How Each System Loads Environment Variables

### Next.js (Client Workspace)

Next.js has **built-in dotenv support** - no package needed.

1. Automatically loads from `/client/.env.local`
2. Variables are available in:
   - API Routes (server-side): `process.env.E2B_API_KEY`
   - Server Components: `process.env.E2B_API_KEY`
   - Client Components: Only `NEXT_PUBLIC_*` prefixed vars
3. Loading order (highest to lowest priority):
   - `.env.local` (git-ignored, use this!)
   - `.env.development` or `.env.production`
   - `.env`

### Node.js (Server Workspace)

Requires `dotenv` package.

1. Loads via `import 'dotenv/config'` at top of `server/src/index.ts`
2. Looks for `.env` in `/server/` directory
3. Only used for **local development** (`pnpm dev:server`)
4. In production (E2B sandbox), env vars passed via command line

### E2B Sandbox (Production)

Environment variables are passed when starting the process:

```typescript
// In /client/app/api/sandbox/create/route.ts
sandbox.process.start({
  cmd: `GROQ_API_KEY=${groqApiKey} node index.js`
})
```

The Hono server receives `GROQ_API_KEY` from the command, not from a file.

## Common Questions

### Q: Why not use root `.env`?

**A:** Different workspaces have different needs:
- Next.js needs `E2B_API_KEY` to create sandboxes
- Hono server needs `GROQ_API_KEY` to call LLM
- Hono server runs in a remote sandbox and can't access local files

### Q: Will `import 'dotenv/config'` load root `.env`?

**A:** By default, dotenv looks in the **current working directory**. When you run `pnpm dev:server` from root, it would look for `/e2b_hackaton/.env`. However, we explicitly put it in `/server/.env` to keep things organized.

### Q: Does Next.js load `.env` from parent directories?

**A:** No. Next.js only looks in the directory containing `next.config.js` (i.e., `/client/`).

### Q: Can I use `.env.local` in the server workspace?

**A:** Yes, but Next.js convention is `.env.local` for git-ignored local overrides. For consistency, server uses `.env` (also git-ignored via `.gitignore`).

## Setup Instructions

1. **Copy example files:**
   ```bash
   cp client/.env.local.example client/.env.local
   cp server/.env.example server/.env
   ```

2. **Fill in API keys:**
   - Get E2B key: https://e2b.dev/docs
   - Get Groq key: https://console.groq.com

3. **Update `/client/.env.local`:**
   ```bash
   E2B_API_KEY=e2b_your_actual_key
   GROQ_API_KEY=gsk_your_actual_key
   ```

4. **Update `/server/.env`:** (for local testing only)
   ```bash
   PORT=3001
   GROQ_API_KEY=gsk_your_actual_key
   ```

## Git Ignore Configuration

Both `.env` and `.env.local` files should be git-ignored:

```gitignore
# Environment variables
.env
.env.local
.env*.local
```

Only `.env.example` files are tracked in git.

## Verification

### Test Next.js has access:
```bash
pnpm dev:client
# Visit http://localhost:3000 and submit a prompt
# Check browser console and terminal for errors
```

### Test Hono server locally:
```bash
pnpm dev:server
# curl http://localhost:3001/healthcheck
```

### Test full flow:
```bash
pnpm dev
# Submit prompt → Should create sandbox and stream response
```

## Troubleshooting

### "E2B_API_KEY not configured" error
- Check `/client/.env.local` exists
- Check variable name is exactly `E2B_API_KEY`
- Restart dev server after changing `.env.local`

### "GROQ_API_KEY not configured" error in sandbox
- Check `/client/.env.local` has `GROQ_API_KEY`
- Verify the API route passes it to sandbox (see `sandbox/create/route.ts:56-58`)
- Check sandbox logs in E2B dashboard

### Hono server works locally but not in sandbox
- Remember: Sandbox doesn't have access to local `.env` files
- GROQ_API_KEY must be passed via command line (already implemented)
- Check E2B sandbox logs for environment issues

## Security Notes

1. **Never commit `.env` or `.env.local` files**
2. **Never use `NEXT_PUBLIC_` prefix for secrets** - they're exposed to browser
3. **API keys are only safe in:**
   - Next.js API routes (server-side)
   - Server components
   - Node.js server code
4. **Rotate keys if accidentally committed**

## Best Practices

✅ **DO:**
- Use `.env.local` for local overrides
- Keep workspace-specific vars in workspace `.env` files
- Document required variables in `.env.example`
- Use TypeScript to validate required env vars at runtime

❌ **DON'T:**
- Put all vars in root `.env`
- Mix client and server vars in same file
- Assume sandbox has access to local files
- Forget to pass necessary vars to sandbox
