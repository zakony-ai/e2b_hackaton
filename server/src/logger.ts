import type { LogEntry } from '@shared/index';

// Server-side structured logging helper
export function log(entry: Omit<LogEntry, 'timestamp'>): void {
	const logEntry: LogEntry = {
		...entry,
		timestamp: new Date().toISOString(),
	} as LogEntry;
	console.log(JSON.stringify(logEntry));
}
