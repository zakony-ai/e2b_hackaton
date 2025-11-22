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

// Type for messages stored in NDJSON - more flexible than ResponseInputMessageItem
// Supports user, assistant (with optional content and tool_calls), and tool messages
// Note: When tool_calls are present, content may be omitted (following Groq/OpenAI format)
type StoredMessage =
	| { role: "user"; content: string }
	| {
			role: "assistant";
			content?: string;
			tool_calls?: Array<{
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}>;
	  }
	| { role: "tool"; tool_call_id: string; content: string };

const app = new Hono();

// Enable CORS for all routes
app.use(
	"*",
	cors({
		origin: "*", // Allow all origins for E2B sandbox access
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type"],
	}),
);

// Server state
let agentStream: AsyncIterable<ResponseStreamEvent> | null = null;
const sseConnections: Set<WritableStreamDefaultWriter> = new Set();

// Helper to check if agent is talking
function isAgentTalking(): boolean {
	return agentStream !== null;
}

// Helper to append message to NDJSON file
async function appendMessageToFile(message: StoredMessage): Promise<void> {
	const messagesPath = path.join(process.cwd(), "messages.ndjson");
	const line = JSON.stringify(message) + "\n";
	await fs.appendFile(messagesPath, line, "utf-8");
}

// Helper to read all messages from NDJSON file
async function readMessagesFromFile(): Promise<StoredMessage[]> {
	const messagesPath = path.join(process.cwd(), "messages.ndjson");
	try {
		const fileContent = await fs.readFile(messagesPath, "utf-8");
		return fileContent
			.trim()
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as StoredMessage);
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

	const line =
		JSON.stringify({
			timestamp: new Date().toISOString(),
			event,
		}) + "\n";

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
// Cast to unknown then to the target type since our StoredMessage includes assistant/tool messages
// not strictly in ResponseInputMessageItem type (which only has user/system/developer roles)
function reconstructHistory(
	messages: StoredMessage[],
): ResponseCreateParams["input"] {
	return messages as unknown as ResponseCreateParams["input"];
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
		model: "moonshotai/kimi-k2-instruct-0905",
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
			server_label: "e2b-mcp-gateway",
			server_url: mcp_url,
			headers: {
				Authorization: `Bearer ${mcp_token}`,
			},
		});
		log({ level: "info", message: "MCP tools configured", mcpUrl: mcp_url });
	}

	// Start streaming response from Groq using responses API
	agentStream = await client.responses.create({
		model: "moonshotai/kimi-k2-instruct-0905",
		input: conversationHistory,
		tools: tools.length > 0 ? tools : undefined,
		stream: true, // Enable streaming!
	});

	// Stream SSE to client
	return streamSSE(c, async (sseStream) => {
		let assistantMessage = "";
		const toolCalls: Array<{
			id: string;
			type: "function";
			function: { name: string; arguments: string };
		}> = [];
		const toolCallArgsMap = new Map<string, string>();

		try {
			// Iterate through streaming events
			for await (const event of agentStream!) {
				// Log every event to debug file
				await logAgentStreamEvent(event);

				await match(event)
					.with({ type: "response.output_text.delta" }, async (e) => {
						// Stream text chunks as they arrive
						assistantMessage += e.delta;
						await sseStream.writeSSE({
							data: JSON.stringify({
								type: "text_delta",
								content: e.delta,
							}),
						});
					})
					.with({ type: "response.output_item.added" }, async (e) => {
						// Tool call initiated
						const item = e.item;
						if (item.type === "function_call") {
							// Initialize tool call arguments tracking
							toolCallArgsMap.set(item.call_id, "");

							await sseStream.writeSSE({
								data: JSON.stringify({
									type: "tool_call_start",
									tool_name: item.name,
									call_id: item.call_id,
								}),
							});
						}
					})
					.with(
						{ type: "response.function_call_arguments.delta" },
						async (e) => {
							// Stream tool arguments as they're generated
							const currentArgs = toolCallArgsMap.get(e.item_id) || "";
							toolCallArgsMap.set(e.item_id, currentArgs + e.delta);

							await sseStream.writeSSE({
								data: JSON.stringify({
									type: "tool_args_delta",
									delta: e.delta,
									item_id: e.item_id,
								}),
							});
						},
					)
					.with(
						{ type: "response.function_call_arguments.done" },
						async (e) => {
							// Tool arguments complete - save the tool call
							toolCalls.push({
								id: e.item_id,
								type: "function",
								function: {
									name: e.name,
									arguments: e.arguments,
								},
							});

							await sseStream.writeSSE({
								data: JSON.stringify({
									type: "tool_call_complete",
									name: e.name,
									arguments: e.arguments,
								}),
							});
						},
					)
					.with({ type: "response.output_item.done" }, async (e) => {
						// Check if this is a tool result (function_call_output)
						// Note: OpenAI SDK types don't include 'function_call_output' yet,
						// but it's returned by the Responses API when using MCP tools
						const item = e.item as unknown as {
							type: string;
							call_id?: string;
							output?: string;
						};

						if (
							item.type === "function_call_output" &&
							item.call_id &&
							item.output
						) {
							// Save tool result immediately to messages.ndjson
							await appendMessageToFile({
								role: "tool",
								tool_call_id: item.call_id,
								content: item.output,
							});

							log({
								level: "info",
								message: "Tool result saved",
								toolCallId: item.call_id,
								outputLength: item.output.length,
							});
						}

						// Stream event to client
						await sseStream.writeSSE({
							data: JSON.stringify({
								type: "tool_done",
								item: e.item,
							}),
						});
					})
					.with({ type: "response.completed" }, async (e) => {
						// Final response with all data
						// Save assistant message with both content and tool_calls (if any)
						// An assistant message can have both text content AND tool calls
						// Following Groq/OpenAI format: omit content field when it's empty
						if (assistantMessage || toolCalls.length > 0) {
							const message: StoredMessage = {
								role: "assistant",
								...(assistantMessage && { content: assistantMessage }),
								...(toolCalls.length > 0 && { tool_calls: toolCalls }),
							};
							await appendMessageToFile(message);
						}

						log({
							level: "info",
							message: "Response completed",
							messageLength: assistantMessage.length,
							toolCallsCount: toolCalls.length,
						});

						await sseStream.writeSSE({
							data: JSON.stringify({
								type: "done",
								usage: e.response.usage,
							}),
						});
					})
					.with({ type: "response.failed" }, async (e) => {
						throw new Error(e.response.error?.message || "Response failed");
					})
					.otherwise(async (e) => {
						// Log unhandled event types for debugging
						log({
							level: "info",
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
