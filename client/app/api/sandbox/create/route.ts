import { Sandbox } from "@e2b/code-interpreter";
import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import * as fs from "fs";
import * as path from "path";

export async function POST() {
	try {
		// Check both env vars upfront before creating sandbox
		const e2bApiKey = process.env.E2B_API_KEY;
		const groqApiKey = process.env.GROQ_API_KEY;

		if (!e2bApiKey) {
			log({ level: "error", message: "E2B_API_KEY not configured" });
			return NextResponse.json(
				{ error: "E2B_API_KEY not configured" },
				{ status: 500 },
			);
		}

		if (!groqApiKey) {
			log({ level: "error", message: "GROQ_API_KEY not configured" });
			return NextResponse.json(
				{ error: "GROQ_API_KEY not configured" },
				{ status: 500 },
			);
		}

		log({ level: "info", message: "Creating E2B sandbox" });

		// Create E2B sandbox with paper-search MCP server
		const sandbox = await Sandbox.create({
			apiKey: e2bApiKey,
			mcp: {
				paperSearch: {},
			},
			timeoutMs: 600_000, // 10 minutes
		});

		log({
			level: "info",
			message: "Sandbox created",
			sandboxId: sandbox.sandboxId,
		});

		// Path to the bundled server (copied during build)
		const serverBundlePath = path.join(
			process.cwd(),
			"server-bundle",
			"server.mjs",
		);

		// Upload the single bundled server file
		await sandbox.files.write(
			"/home/user/server.mjs",
			fs.readFileSync(serverBundlePath, "utf-8"),
		);

		log({
			level: "info",
			message: "Server bundle uploaded",
			sandboxId: sandbox.sandboxId,
		});

		// Create logs directory
		await sandbox.commands.run("mkdir -p /home/user/logs");
		log({
			level: "info",
			message: "Logs directory created",
			sandboxId: sandbox.sandboxId,
		});

		// Get MCP URL and token - pass as environment variables to the server
		const mcpUrl = sandbox.getMcpUrl();
		const mcpToken = await sandbox.getMcpToken();

		// Start the bundled server immediately - no npm install needed!
		// Redirect stdout and stderr to NDJSON log file
		// Pass MCP credentials as environment variables
		log({
			level: "info",
			message: "Starting server in sandbox",
			sandboxId: sandbox.sandboxId,
		});
		sandbox.commands.run(
			`GROQ_API_KEY=${groqApiKey} MCP_URL=${mcpUrl} MCP_TOKEN=${mcpToken} node /home/user/server.mjs >> /home/user/logs/hono.ndjson 2>&1`,
			{
				background: true,
			},
		);

		// The agent URL is the sandbox URL + the agent endpoint
		// E2B exposes services on predictable ports
		const agentUrl = `https://${sandbox.getHost(3001)}`;

		log({
			level: "info",
			message: "Sandbox ready",
			sandboxId: sandbox.sandboxId,
			agentUrl,
		});

		return NextResponse.json({
			agentUrl,
			sandboxId: sandbox.sandboxId,
		});
	} catch (error) {
		log({
			level: "error",
			message: "Failed to create sandbox",
			errorMessage: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
		});
		return NextResponse.json(
			{
				error: "Failed to create sandbox",
				details: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 },
		);
	}
}
