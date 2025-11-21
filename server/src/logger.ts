// Server-side structured logging helper
export function log(
	level: "info" | "warn" | "error",
	message: string,
	metadata?: Record<string, any>,
) {
	console.log(
		JSON.stringify({
			timestamp: new Date().toISOString(),
			level,
			message,
			...metadata,
		}),
	);
}
