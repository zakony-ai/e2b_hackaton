import { Sandbox } from "@e2b/code-interpreter";
import { NextRequest, NextResponse } from "next/server";
import { log } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const sandboxId = request.nextUrl.searchParams.get("sandboxId");

    if (!sandboxId) {
      log({ level: "error", message: "sandboxId is required" });
      return NextResponse.json(
        { error: "sandboxId is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.E2B_API_KEY;

    if (!apiKey) {
      log({ level: "error", message: "E2B_API_KEY not configured" });
      return NextResponse.json(
        { error: "E2B_API_KEY not configured" },
        { status: 500 }
      );
    }

    log({ level: "info", message: "Fetching logs", sandboxId });

    // Connect to the existing sandbox
    const sandbox = await Sandbox.connect(sandboxId, { apiKey });

    // Read the log file
    let logsContent = "";
    try {
      logsContent = await sandbox.files.read("/home/user/logs/hono.ndjson");
    } catch {
      // If file doesn't exist yet, return empty string
      log({ level: "warn", message: "Log file not found or empty", sandboxId });
      logsContent = "";
    }

    log({
      level: "info",
      message: "Logs fetched successfully",
      sandboxId,
      logSize: logsContent.length,
    });

    return NextResponse.json({
      logs: logsContent,
      sandboxId,
    });
  } catch (error) {
    log({
      level: "error",
      message: "Failed to fetch logs",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error: "Failed to fetch logs",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
