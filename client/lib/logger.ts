import type { LogEntry } from '@shared/index';

// Client-side structured logging helper for Vercel console
export function log(entry: Omit<LogEntry, 'timestamp'>): void {
	const logEntry: LogEntry = {
		...entry,
		timestamp: new Date().toISOString(),
	} as LogEntry;
	console.log(JSON.stringify(logEntry));
}
