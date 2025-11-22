// Load environment variables from .env file (for local development only)
// In E2B sandbox, GROQ_API_KEY is passed via command line
// Only load dotenv if we're in local dev (not in E2B sandbox)
if (process.env.NODE_ENV !== "production") {
	try {
		await import("dotenv/config");
	} catch {
		// dotenv not available or failed to load - that's ok in sandbox
	}
}

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { cors } from "hono/cors";
import OpenAI from "openai";
import type {
	ResponseCreateParams,
	ResponseStreamEvent,
} from "openai/resources/responses/responses";
import { match } from "ts-pattern";
import * as fs from "fs/promises";
import * as path from "path";
import { log } from "./logger";
import type { Message, StreamAction } from "../../shared/src/index";

// System prompt for the research assistant
const SYSTEM_PROMPT = `You are a research assistant specializing in academic paper analysis. Help users discover and analyze research papers from arXiv, PubMed, bioRxiv, and other sources.

## Critical Tool Usage Rules

IMPORTANT: Only use tools that are provided to you. NEVER invent or hallucinate tool names.
- Tool names do NOT contain special characters like <, >, |, or brackets
- Tool names follow the pattern: paper-search-search_arxiv, paper-search-search_pubmed, etc.
- If you're unsure about a tool name, DO NOT use it

## Workflow

1. Search for papers using search_arxiv or other search tools
2. When you receive search results, extract the "paper_id" field
3. Use read_arxiv_paper with that exact paper_id AND save_path="/tmp"
4. Analyze the paper content and provide a detailed response

## Critical Rule: Use Exact Paper IDs

When calling read_arxiv_paper, you MUST use the exact paper_id from your search results.

Example:
- Search returns: {"paper_id": "2511.06901v1", ...}
- You call: {"paper_id": "2511.06901v1", "save_path": "/tmp"}
- DO NOT use any other paper_id!

## Tool Parameters

- read_arxiv_paper requires: paper_id (from search results) and save_path="/tmp"
- Always use save_path="/tmp" (not "./downloads" or other paths)

## Response Requirements

After reading papers, always provide a text response that:
- Summarizes findings from the papers
- Cites paper titles, authors, and IDs
- Provides links (https://arxiv.org/abs/PAPER_ID)`;

// Using shared Message type for consistency across client/server
// Note: For API compatibility, we still need to convert these to OpenAI format

const app = new Hono();

// Enable CORS for all routes
app.use(
	"*",
	cors({
		origin: "*", // Allow all origins for E2B sandbox access
		allowMethods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
		allowHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
		exposeHeaders: ["Content-Type"],
		credentials: false,
		maxAge: 86400, // Cache preflight for 24 hours
	}),
);

// Explicit OPTIONS handler for all routes
app.options("*", (c) => {
	c.header("Access-Control-Allow-Origin", "*");
	c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
	c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Requested-With");
	c.header("Access-Control-Max-Age", "86400");
	return new Response(null, {
		status: 204,
		headers: c.res.headers,
	});
});

// Server state
let agentStream: AsyncIterable<ResponseStreamEvent> | null = null;
const sseConnections: Set<WritableStreamDefaultWriter> = new Set();

// Helper to check if agent is talking
function isAgentTalking(): boolean {
	return agentStream !== null;
}

// Helper to append message to NDJSON file
async function appendMessageToFile(message: Message): Promise<void> {
	const messagesPath = path.join(process.cwd(), "messages.ndjson");
	const line = JSON.stringify(message) + "\n";
	await fs.appendFile(messagesPath, line, "utf-8");
}

// Helper to read all messages from NDJSON file
async function readMessagesFromFile(): Promise<Message[]> {
	const messagesPath = path.join(process.cwd(), "messages.ndjson");
	try {
		const fileContent = await fs.readFile(messagesPath, "utf-8");
		return fileContent
			.trim()
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as Message);
	} catch {
		// File doesn't exist yet or is empty
		return [];
	}
}

// Helper to log agentStream events to debug file
async function logAgentStreamEvent(event: ResponseStreamEvent): Promise<void> {
	const logsDir = path.join(process.cwd(), "logs");
	const logsPath = path.join(logsDir, "agentStream.ndjson");

	// Ensure logs directory exists
	try {
		await fs.mkdir(logsDir, { recursive: true });
	} catch {
		// Directory already exists or can't be created
	}

	const line = JSON.stringify(event) + "\n";

	try {
		await fs.appendFile(logsPath, line, "utf-8");
	} catch (error) {
		// Log to console if file write fails
		log({
			level: "error",
			message: "Failed to write agentStream event to file",
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

// Helper to reconstruct conversation history as ResponseInput
// Converts our Message format to OpenAI Responses API format
// Prepends the system prompt to guide the LLM's behavior
//
// The input array is FLAT - messages, tool calls, and tool results are all separate items
// at the same level, not nested inside messages.
function reconstructHistory(
	messages: Message[],
): ResponseCreateParams["input"] {
	// Prepend system message with the research assistant prompt
	const systemMessage = {
		type: "message" as const,
		role: "system" as const,
		content: [{ type: "input_text" as const, text: SYSTEM_PROMPT }],
	};

	// Convert our Message format to OpenAI Responses API format
	// For MCP calls, we need to combine tool_call and tool_result into a single mcp_call item
	type InputItem = NonNullable<ResponseCreateParams["input"]>[number];
	const inputItems: InputItem[] = [];

	interface McpCallData {
		call: Message & { role: "tool_call" };
		result?: Message & { role: "tool_result" };
	}
	const mcpCallsMap = new Map<string, McpCallData>();

	// First pass: collect tool calls and results
	for (const msg of messages) {
		if (msg.role === "tool_call") {
			mcpCallsMap.set(msg.id, { call: msg as Message & { role: "tool_call" } });
		} else if (msg.role === "tool_result") {
			const existing = mcpCallsMap.get(msg.id);
			if (existing) {
				existing.result = msg as Message & { role: "tool_result" };
			}
		}
	}

	// Second pass: build input items
	for (const msg of messages) {
		if (msg.role === "user" || msg.role === "prompt") {
			// User message
			inputItems.push({
				type: "message" as const,
				role: "user" as const,
				content: [{ type: "input_text" as const, text: msg.content }],
			});
		} else if (msg.role === "assistant") {
			// Assistant message - include as string content if it has content
			// The Responses API accepts strings for assistant messages in the input
			if (msg.content && msg.content.trim().length > 0) {
				inputItems.push(msg.content);
			}
		} else if (msg.role === "tool_call") {
			// MCP tool call - combine with result if available
			const mcpData = mcpCallsMap.get(msg.id);
			if (mcpData) {
				inputItems.push({
					type: "mcp_call" as const,
					id: msg.id,
					name: msg.name,
					arguments: msg.arguments,
					server_label: "e2b_mcp_gateway", // Match the server label we configured
					status: mcpData.result ? ("completed" as const) : ("in_progress" as const),
					output: mcpData.result?.content,
				});
			}
		}
		// Skip tool_result - already merged into mcp_call
		// Skip error messages - they're for display only, not for LLM context
	}

	return [systemMessage, ...inputItems] as unknown as ResponseCreateParams["input"];
}

app.get("/healthcheck", (c) => {
	log({ level: "info", message: "Healthcheck request" });
	return c.json({ status: "ok", message: "Server is up and running" });
});

app.post("/agent/talk", async (c) => {
	log({ level: "info", message: "Agent talk request received" });

	if (isAgentTalking()) {
		log({ level: "warn", message: "Agent is already talking" });
		return c.json(
			{
				error:
					"Agent is already talking. Use /agent/sorryiwasntlistening to reconnect.",
			},
			{ status: 409 },
		);
	}

	const { user_prompt } = await c.req.json();

	if (!user_prompt) {
		log({ level: "error", message: "Missing user_prompt" });
		return c.json({ error: "user_prompt is required" }, { status: 400 });
	}

	// Read MCP credentials from environment variables (set by sandbox creation)
	const mcp_url = process.env.MCP_URL;
	const mcp_token = process.env.MCP_TOKEN;

	log({
		level: "info",
		message: "Processing user prompt",
		promptLength: user_prompt.length,
		hasMcp: !!mcp_url,
	});

	// Save user message
	await appendMessageToFile({ role: "user", content: user_prompt });

	// Read all messages for context
	const messages = await readMessagesFromFile();

	// Initialize OpenAI client (using Groq endpoint)
	const groqApiKey = process.env.GROQ_API_KEY;
	if (!groqApiKey) {
		log({ level: "error", message: "GROQ_API_KEY not configured" });
		return c.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
	}

	const client = new OpenAI({
		apiKey: groqApiKey,
		baseURL: "https://api.groq.com/openai/v1",
	});

	log({
		level: "info",
		message: "Starting Groq responses API",
		model: "openai/gpt-oss-120b",
		messageCount: messages.length,
		hasMcp: !!mcp_url,
	});

	// Reconstruct conversation history using proper OpenAI types
	const conversationHistory = reconstructHistory(messages);

	// Build tools array using proper OpenAI types
	const tools: ResponseCreateParams["tools"] = [];

	if (mcp_url && mcp_token) {
		tools.push({
			type: "mcp",
			server_label: "e2b_mcp_gateway",
			server_url: mcp_url,
			headers: {
				Authorization: `Bearer ${mcp_token}`,
			},
		});
		log({ level: "info", message: "MCP tools configured", mcpUrl: mcp_url });
	}

	// Start streaming response from Groq using responses API
	agentStream = await client.responses.create({
		model: "openai/gpt-oss-120b",
		input: conversationHistory,
		tools: tools.length > 0 ? tools : undefined,
		stream: true, // Enable streaming!
	});

	// Helper to send StreamAction via SSE
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const sendAction = async (stream: any, action: StreamAction) => {
		await stream.writeSSE({
			data: JSON.stringify(action),
		});
	};

	// Stream SSE to client
	return streamSSE(c, async (sseStream) => {
		// Set CORS headers explicitly for SSE response
		c.header("Access-Control-Allow-Origin", "*");
		c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
		c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Requested-With");
		c.header("Access-Control-Expose-Headers", "Content-Type");

		let hasStartedText = false;
		let currentAssistantText = "";
		// Track MCP call items by ID to get the name later
		const mcpCallItems = new Map<string, { name: string; arguments: string }>();

		try {
			// Iterate through streaming events
			for await (const event of agentStream!) {
				// Log every event to debug file
				await logAgentStreamEvent(event);

				await match(event)
					.with({ type: "response.output_item.added" }, async (e) => {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const item = e.item as any;

						// Track MCP call items to get name later
						if (item.type === "mcp_call" && item.id && item.name) {
							mcpCallItems.set(item.id, {
								name: item.name,
								arguments: item.arguments || "",
							});
						}

						// Check if this is the start of assistant text
						if (item.type === "message" && !hasStartedText) {
							hasStartedText = true;
							await sendAction(sseStream, {
								type: "ASSISTANT_TEXT_STARTED",
							});
						}
					})
					.with({ type: "response.output_text.delta" }, async (e) => {
						// Stream text chunks as they arrive
						currentAssistantText += e.delta;
						await sendAction(sseStream, {
							type: "ASSISTANT_TEXT_DELTA",
							delta: e.delta,
						});
					})
					.with({ type: "response.output_text.done" }, async (_e) => {
						// Assistant text streaming complete - save to messages.ndjson
						if (currentAssistantText) {
							await appendMessageToFile({
								role: "assistant",
								content: currentAssistantText,
							});
						}

						await sendAction(sseStream, {
							type: "ASSISTANT_TEXT_DONE",
						});
					})
					.with(
						{ type: "response.mcp_call_arguments.done" },
						async (e) => {
							// Tool call arguments complete - save and dispatch
							const mcpCall = mcpCallItems.get(e.item_id);
							if (mcpCall) {
								await appendMessageToFile({
									role: "tool_call",
									id: e.item_id,
									name: mcpCall.name,
									arguments: e.arguments,
								});

								await sendAction(sseStream, {
									type: "TOOL_CALL_ARGUMENTS_DONE",
									toolCallId: e.item_id,
									name: mcpCall.name,
									arguments: e.arguments,
								});

								log({
									level: "info",
									message: "Tool call saved",
									toolCallId: e.item_id,
									toolName: mcpCall.name,
								});
							}
						},
					)
					.with({ type: "response.output_item.done" }, async (e) => {
						// Tool execution complete - save result and dispatch
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const item = e.item as any;
						if (item.type === "mcp_call" && item.status === "completed" && item.output) {
							try {
								log({
									level: "info",
									message: "Processing completed MCP call",
									toolCallId: item.id,
									toolName: item.name,
									outputLength: item.output.length,
								});

								await appendMessageToFile({
									role: "tool_result",
									id: item.id,
									content: item.output,
								});

								await sendAction(sseStream, {
									type: "TOOL_RESULT_RECEIVED",
									toolCallId: item.id,
									output: item.output,
								});

								// Send tool call completed event to mark tool as done in UI
								await sendAction(sseStream, {
									type: "TOOL_CALL_COMPLETED",
									toolCallId: item.id,
								});

								log({
									level: "info",
									message: "Tool result saved and sent successfully",
									toolCallId: item.id,
									outputLength: item.output.length,
								});
							} catch (error) {
								log({
									level: "error",
									message: "Failed to save/send tool result",
									toolCallId: item.id,
									error: error instanceof Error ? error.message : String(error),
									stack: error instanceof Error ? error.stack : undefined,
								});
							}
						}
					})
					.with({ type: "response.completed" }, async (e) => {
						// Final response - signal turn completion
						await sendAction(sseStream, {
							type: "LLM_TURN_FINISHED",
						});

						log({
							level: "info",
							message: "Response completed",
							usage: e.response.usage,
						});
					})
					.with({ type: "response.failed" }, async (e) => {
						// Log the error but don't crash - send error to client
						const errorMessage = e.response.error?.message || "Response failed";
						const error = e.response.error as unknown as { type?: string; code?: string };
						log({
							level: "error",
							message: "Response API failed",
							errorMessage,
							errorType: error?.type,
							errorCode: error?.code,
						});

						// Save error message to messages.ndjson
						await appendMessageToFile({
							role: "error",
							content: errorMessage,
						});

						await sendAction(sseStream, {
							type: "ERROR",
							error: errorMessage,
						});

						// Stream is done - the Responses API won't retry
						// This is a limitation of the current implementation
					})
					.otherwise(async (e) => {
						// Log unhandled event types for debugging
						log({
							level: "debug",
							message: "Unhandled event type",
							eventType: e.type,
						});
					});
			}
		} catch (error) {
			log({
				level: "error",
				message: "Response error",
				errorMessage: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
			});
			await sseStream.writeSSE({
				data: JSON.stringify({
					type: "error",
					message: error instanceof Error ? error.message : String(error),
				}),
			});
		} finally {
			// Reset state
			agentStream = null;
		}
	});
});

app.post("/agent/sorryiwasntlistening", async (c) => {
	if (!isAgentTalking()) {
		return c.json(
			{
				error: "Agent is not talking. Use /agent/talk to start a conversation.",
			},
			{ status: 400 },
		);
	}

	// Read current messages and return them along with SSE stream
	const messages = await readMessagesFromFile();

	return c.json({
		messages,
		// Note: In a production app, we'd need to handle reconnecting to the active stream
		// For now, this is a simplified version
	});
});

app.post("/agent/stfu", async (c) => {
	log({ level: "info", message: "Agent stfu request received" });

	if (!isAgentTalking()) {
		log({ level: "warn", message: "Agent is not talking" });
		return c.json({ error: "Agent is not talking." }, { status: 400 });
	}

	// Stop the stream
	agentStream = null;

	// Close all SSE connections
	for (const writer of sseConnections) {
		try {
			await writer.close();
		} catch {
			// Ignore errors when closing
		}
	}
	sseConnections.clear();

	log({ level: "info", message: "Agent stopped successfully" });

	return c.json({ success: true });
});

const port = parseInt(process.env.PORT || "3001");

log({ level: "info", message: "Server starting", port });

serve({
	fetch: app.fetch,
	port,
});

log({
	level: "info",
	message: "Server is running",
	port,
	url: `http://localhost:${port}`,
});
