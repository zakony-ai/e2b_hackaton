# Science Research Collaborator Agent

> An AI-powered research assistant that helps you discover, analyze, and organize academic papers through natural conversation.

Built for the E2B Hackathon, this agent combines the power of E2B sandboxes with Docker MCP servers to create a secure, scalable research tool that feels like having a knowledgeable research partner at your fingertips.

## What It Does

**Ask. Discover. Research.**

The Science Research Collaborator transforms how you explore academic literature:

- **🔍 Intelligent Paper Search**: Ask questions in natural language, and the agent searches across arXiv, PubMed, bioRxiv, and other academic databases to find relevant papers
- **💬 Conversational Research**: Have extended, multi-turn conversations that build on previous context—refine your queries, ask follow-ups, and dive deeper into topics
- **📚 Reading List Management**: Save interesting papers to your reading list with one click, organized and ready for later review
- **🔄 Session Persistence**: Switch between multiple research conversations, reconnect to ongoing sessions if you lose connection
- **⚡ Real-time Streaming**: Get instant feedback as the agent processes your questions and searches for papers
- **📊 Transparent Execution**: View sandbox logs and understand how the agent is working behind the scenes

## Why It Matters

Academic research is overwhelming. Thousands of papers are published daily, and finding the right ones requires expertise, time, and access to multiple databases.

This agent changes that by:
- **Democratizing Research**: No need to master complex database query languages or navigate dozens of academic portals
- **Saving Time**: Get relevant papers in seconds instead of hours of manual searching
- **Building Context**: The agent remembers your conversation, so you don't have to repeat yourself
- **Ensuring Safety**: All AI execution happens in isolated E2B sandboxes, protecting your system and data

## Tech Stack

### Frontend
- **Next.js 16** + **React 19** - Modern, performant web framework with streaming SSR
- **TypeScript 5** - Type-safe development
- **Tailwind CSS 4** - Utility-first styling
- **Radix UI** - Accessible, unstyled component primitives (Dialog, Select, Dropdown, etc.)
- **react-markdown** + **Shiki** - Beautiful Markdown rendering with syntax highlighting
- **react-resizable-panels** - Responsive 3-panel layout

### Backend & Infrastructure
- **Hono 4.7** - Lightweight, ultra-fast web framework (runs in E2B sandbox)
- **E2B Code Interpreter SDK** - Secure sandbox creation and management
- **Docker MCP Gateway** - Isolated MCP server execution
- **Groq API (GPT-OSS-120B)** - Lightning-fast LLM inference via OpenAI-compatible API
- **Paper-search MCP** - Multi-source academic paper search (arXiv, PubMed, bioRxiv)

### Development Tools
- **pnpm 10** - Fast, disk-efficient monorepo package manager
- **TypeScript** + **ESLint** - Code quality and consistency
- **Server-Sent Events (SSE)** - Real-time streaming communication

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Browser                            │
│                   (Next.js 16 + React 19)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ Conversations│  │   Messages   │  │ Reading List │        │
│  │   Sidebar    │  │     View     │  │   Panel      │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└─────────────────────────────┬───────────────────────────────────┘
                              │ HTTP/SSE
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js API Routes                           │
│              (/api/sandbox/create, /kill, /logs)                │
└─────────────────────────────┬───────────────────────────────────┘
                              │ E2B SDK
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      E2B Sandbox (Secure)                       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Hono Server (Node.js)                       │  │
│  │  - Agent endpoints (/agent/talk, /stfu, etc.)           │  │
│  │  - Message persistence (NDJSON)                         │  │
│  │  - SSE streaming to client                              │  │
│  └────────────────────┬─────────────────────────────────────┘  │
│                       │                                         │
│  ┌────────────────────▼─────────────────────────────────────┐  │
│  │        Paper-search MCP Server (Docker)                  │  │
│  │  - search_arxiv, search_pubmed, read_arxiv_paper        │  │
│  │  - Tool execution in isolated environment               │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────┘
                              │ OpenAI-compatible API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Groq API (GPT-OSS-120B Model)                     │
│           - Tool calling support (OpenAI Responses API)         │
│           - Ultra-fast inference                                │
└─────────────────────────────────────────────────────────────────┘
```

### How It Works

1. **User Submits a Question**: The frontend sends a research question via the Next.js API
2. **Sandbox Creation**: On first request, an E2B sandbox is created with:
   - Pre-bundled Hono server
   - Paper-search MCP server configured via Docker
   - 10-minute timeout for cost efficiency
3. **AI Processing**: The Hono server:
   - Loads conversation history from NDJSON
   - Sends context + new question to Groq API
   - Streams response chunks back via SSE
4. **Tool Execution**: When the AI needs to search papers:
   - Groq returns tool calls (e.g., `search_arxiv`)
   - Hono executes tools via MCP server
   - Results are fed back to the AI for synthesis
5. **Real-time Updates**: The frontend receives:
   - Text chunks as the AI generates responses
   - Tool call events showing what's being searched
   - Final synthesized answer with paper citations
6. **Persistence**: All messages (including tool calls) are saved to NDJSON for session recovery

### Monorepo Structure

```
e2b_hackaton/
├── client/              # Next.js frontend application
│   ├── app/
│   │   ├── page.tsx    # Main research interface
│   │   └── api/sandbox # Sandbox management endpoints
│   ├── components/     # UI components (Conversation, ReadingList, etc.)
│   └── lib/            # Utilities (React hooks, logger)
│
├── server/              # Hono backend (runs in E2B sandbox)
│   └── src/
│       └── index.ts    # Agent endpoints + MCP integration
│
├── shared/              # Shared TypeScript types
│   └── src/index.ts    # Message and StreamAction types
│
└── ai/                  # Architecture documentation
    └── ARCHITECTURE.md  # Detailed design docs
```

## Key Features in Detail

### 🔐 Secure Execution with E2B
All AI code execution happens in isolated E2B sandboxes—no risk to your local machine. Each sandbox is automatically cleaned up after 10 minutes of inactivity.

### 🛠️ MCP Server Integration
The agent uses the paper-search MCP server running in Docker, demonstrating the power of the E2B + Docker MCP partnership announced in January 2025.

### 📡 Streaming Architecture
Server-Sent Events (SSE) provide real-time feedback as the agent:
- Thinks through your question
- Searches databases
- Synthesizes findings

### 💾 Robust Persistence
Conversations are stored in NDJSON format, allowing:
- Session recovery after disconnection
- Full conversation replay
- Efficient append-only storage

### 🎨 Modern UI/UX
Three-panel layout with:
- **Left**: Conversation history and navigation
- **Center**: Active research conversation with Markdown rendering
- **Right**: Reading list for saved papers

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm 10+
- E2B API key ([get one here](https://e2b.dev/docs))
- Groq API key ([get one here](https://console.groq.com))

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd e2b_hackaton

# Install dependencies
pnpm install

# Set up environment variables
cp client/.env.example client/.env.local
# Add your E2B_API_KEY and GROQ_API_KEY

# Build the server bundle
pnpm build:server

# Start the development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and start researching!

## Example Usage

**User**: "What are the latest advances in quantum error correction?"

**Agent**: *Searches arXiv and PubMed, finds relevant papers, synthesizes findings...*

> Based on recent publications, there are several exciting advances in quantum error correction:
>
> 1. **Surface Code Improvements** - [Paper Title] (arXiv:2024.12345) demonstrates a 40% reduction in qubit overhead...
> 2. **Topological Methods** - [Another Paper] (PubMed ID: 98765432) introduces a novel approach using...
>
> Would you like me to dive deeper into any of these areas?

**User**: "Yes, tell me more about the topological methods"

**Agent**: *Retrieves full paper, analyzes content...*

> The topological approach is particularly interesting because...

## Project Constraints & Design Decisions

- **NDJSON for messages**: Chosen for append-only efficiency and easy recovery
- **Groq over OpenAI**: Much faster inference for real-time conversational experience
- **Monorepo with workspaces**: Shared types between client/server prevent drift

## Future Enhancements

- [ ] Support for more academic databases (Semantic Scholar, Google Scholar)
- [ ] PDF annotation and highlighting
- [ ] Export reading lists to BibTeX, Zotero, Mendeley
- [ ] Collaborative research sessions (multiple users)
- [ ] Citation graph visualization
- [ ] Paper summarization with custom prompts

## Acknowledgments

Built for the E2B Hackathon using:
- [E2B Sandbox Platform](https://e2b.dev)
- [Docker MCP Hub](https://hub.docker.com/mcp)
- [Groq API](https://console.groq.com)
- [Paper-search MCP Server](https://hub.docker.com/mcp)

---
