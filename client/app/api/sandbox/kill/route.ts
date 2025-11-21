import { Sandbox } from '@e2b/code-interpreter';
import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const { sandboxId } = await request.json();

    if (!sandboxId) {
      log('error', 'sandboxId is required');
      return NextResponse.json(
        { error: 'sandboxId is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.E2B_API_KEY;

    if (!apiKey) {
      log('error', 'E2B_API_KEY not configured');
      return NextResponse.json(
        { error: 'E2B_API_KEY not configured' },
        { status: 500 }
      );
    }

    log('info', 'Killing sandbox', { sandboxId });

    // Connect to the existing sandbox and kill it
    const sandbox = await Sandbox.connect(sandboxId, { apiKey });
    await sandbox.kill();

    log('info', 'Sandbox killed successfully', { sandboxId });

    return NextResponse.json({ success: true });

  } catch (error) {
    log('error', 'Failed to kill sandbox', {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to kill sandbox', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
