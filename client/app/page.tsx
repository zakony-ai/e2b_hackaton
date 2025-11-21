"use client";
import { useState, useEffect } from "react";
import { nanoid } from "nanoid";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "@/components/ui/resizable";
import {
	PromptInput,
	PromptInputBody,
	PromptInputTextarea,
	PromptInputFooter,
	PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

interface Conversation {
	id: string;
	first_prompt: string;
	agentUrl?: string;
	sandboxId?: string;
}

interface Message {
	role: "user" | "assistant";
	content: string;
}

interface LogEntry {
	timestamp: string;
	level: "info" | "warn" | "error";
	message: string;
	[key: string]: any;
}

export default function Home() {
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [logsDialogOpen, setLogsDialogOpen] = useState(false);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [logsLoading, setLogsLoading] = useState(false);
	const [logsError, setLogsError] = useState<string | null>(null);

	// Load conversations from localStorage on mount
	useEffect(() => {
		const stored = localStorage.getItem("conversations");
		if (stored) {
			try {
				setConversations(JSON.parse(stored));
			} catch (e) {
				console.error("Failed to parse conversations from localStorage", e);
			}
		}
	}, []);

	// Save conversations to localStorage whenever they change
	useEffect(() => {
		if (conversations.length > 0) {
			localStorage.setItem("conversations", JSON.stringify(conversations));
		}
	}, [conversations]);

	const handleSubmit = async (promptMessage: { text: string }) => {
		const userPrompt = promptMessage.text.trim();
		if (!userPrompt) return;

		// Add user message to UI
		const userMessage: Message = { role: "user", content: userPrompt };
		setMessages((prev) => [...prev, userMessage]);

		// If no current conversation, create a new one
		if (!currentConversation) {
			const conversationId = nanoid();
			const newConversation: Conversation = {
				id: conversationId,
				first_prompt: userPrompt,
			};

			// Step 1: Create sandbox
			setIsStreaming(true);
			try {
				const createResponse = await fetch("/api/sandbox/create", {
					method: "POST",
				});

				if (!createResponse.ok) {
					throw new Error("Failed to create sandbox");
				}

				const { agentUrl, sandboxId } = await createResponse.json();

				newConversation.agentUrl = agentUrl;
				newConversation.sandboxId = sandboxId;

				setConversations((prev) => [...prev, newConversation]);
				setCurrentConversation(newConversation);

				// Step 2: Call agent/talk
				await streamAgentResponse(agentUrl, userPrompt);
			} catch (error) {
				console.error("Error:", error);
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: `Error: ${error instanceof Error ? error.message : String(error)}`,
					},
				]);
				setIsStreaming(false);
			}
		} else if (currentConversation.agentUrl) {
			// Use existing conversation
			setIsStreaming(true);
			try {
				await streamAgentResponse(currentConversation.agentUrl, userPrompt);
			} catch (error) {
				console.error("Error:", error);
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: `Error: ${error instanceof Error ? error.message : String(error)}`,
					},
				]);
				setIsStreaming(false);
			}
		}
	};

	const streamAgentResponse = async (agentUrl: string, userPrompt: string) => {
		try {
			const response = await fetch(`${agentUrl}/agent/talk`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ user_prompt: userPrompt }),
			});

			if (!response.ok) {
				throw new Error(`Agent returned ${response.status}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("No response body");
			}

			const decoder = new TextDecoder();
			let assistantMessage = "";

			// Add empty assistant message that we'll update
			setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value, { stream: true });
				const lines = chunk.split("\n");

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6);
						try {
							const parsed = JSON.parse(data);
							if (parsed.type === "delta") {
								assistantMessage += parsed.content;
								// Update the last message
								setMessages((prev) => {
									const updated = [...prev];
									updated[updated.length - 1] = {
										role: "assistant",
										content: assistantMessage,
									};
									return updated;
								});
							} else if (parsed.type === "done") {
								setIsStreaming(false);
							} else if (parsed.type === "error") {
								console.error("Stream error:", parsed.message);
								setIsStreaming(false);
							}
						} catch (e) {
							// Ignore JSON parse errors for non-JSON lines
						}
					}
				}
			}

			setIsStreaming(false);
		} catch (error) {
			console.error("Streaming error:", error);
			setIsStreaming(false);
			throw error;
		}
	};

	const handleKillSandbox = async () => {
		if (!currentConversation?.sandboxId) return;

		try {
			const response = await fetch("/api/sandbox/kill", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sandboxId: currentConversation.sandboxId }),
			});

			if (!response.ok) {
				throw new Error("Failed to kill sandbox");
			}

			// Clear current conversation
			setCurrentConversation(null);
			setMessages([]);
			alert(`Sandbox ${currentConversation.sandboxId} killed successfully`);
		} catch (error) {
			console.error("Error killing sandbox:", error);
			alert(`Error killing sandbox: ${error instanceof Error ? error.message : String(error)}`);
		}
	};

	const fetchLogs = async () => {
		if (!currentConversation?.sandboxId) return;

		setLogsLoading(true);
		setLogsError(null);

		try {
			const response = await fetch(`/api/sandbox/logs?sandboxId=${currentConversation.sandboxId}`);

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || "Failed to fetch logs");
			}

			const data = await response.json();

			// Parse NDJSON logs
			if (data.logs) {
				const logLines = data.logs
					.trim()
					.split("\n")
					.filter((line: string) => line.length > 0);

				const parsedLogs: LogEntry[] = [];

				for (const line of logLines) {
					try {
						const logEntry = JSON.parse(line);
						parsedLogs.push(logEntry);
					} catch (e) {
						console.error("Failed to parse log line:", line);
					}
				}

				setLogs(parsedLogs);
			} else {
				setLogs([]);
			}
		} catch (err) {
			setLogsError(err instanceof Error ? err.message : "Unknown error");
		} finally {
			setLogsLoading(false);
		}
	};

	const formatTimestamp = (timestamp: string) => {
		return new Date(timestamp).toLocaleString();
	};

	const getLevelColor = (level: string) => {
		switch (level) {
			case "error":
				return "text-red-600 font-semibold";
			case "warn":
				return "text-yellow-600 font-semibold";
			case "info":
				return "text-blue-600";
			default:
				return "";
		}
	};

	const formatMetadata = (log: LogEntry) => {
		const { timestamp, level, message, ...metadata } = log;
		if (Object.keys(metadata).length === 0) return "";
		return JSON.stringify(metadata, null, 2);
	};

	const handleOpenLogs = () => {
		setLogsDialogOpen(true);
		fetchLogs();
	};

	return (
		<div className="h-screen w-full">
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel defaultSize={10} minSize={5}>
					<div className="h-full p-4">
						<h2 className="font-semibold text-lg">Conversations</h2>
						<div className="mt-4 space-y-2">
							{conversations.map((conv) => (
								<div
									key={conv.id}
									className="cursor-pointer rounded border p-2 text-sm hover:bg-accent"
									onClick={() => {
										setCurrentConversation(conv);
										setMessages([{ role: "user", content: conv.first_prompt }]);
									}}
								>
									{conv.first_prompt.slice(0, 30)}...
								</div>
							))}
						</div>
					</div>
				</ResizablePanel>

				<ResizableHandle />

				<ResizablePanel defaultSize={60} minSize={30}>
					<div className="flex h-full flex-col p-4">
						{currentConversation?.sandboxId && (
							<div className="sticky top-0 mb-4 flex items-center justify-between border-b bg-background pb-2">
								<h2 className="font-semibold text-lg">
									Sandbox: {currentConversation.sandboxId}
								</h2>
								<div className="flex gap-2">
									<Button variant="outline" onClick={handleOpenLogs}>
										Logs
									</Button>
									<Button variant="destructive" onClick={handleKillSandbox}>
										Kill {currentConversation.sandboxId}
									</Button>
								</div>
							</div>
						)}

						<div className="flex-1 space-y-4 overflow-y-auto">
							{messages.map((msg, idx) => (
								<div
									key={idx}
									className={`rounded p-3 ${
										msg.role === "user"
											? "bg-blue-100 dark:bg-blue-900"
											: "bg-gray-100 dark:bg-gray-800"
									}`}
								>
									<div className="font-semibold text-sm">
										{msg.role === "user" ? "You" : "Assistant"}
									</div>
									<div className="mt-1 whitespace-pre-wrap">{msg.content}</div>
								</div>
							))}
						</div>

						<div className="mt-4">
							<PromptInput onSubmit={handleSubmit}>
								<PromptInputBody>
									<PromptInputTextarea
										placeholder="Type your research question..."
										disabled={isStreaming}
									/>
								</PromptInputBody>
								<PromptInputFooter>
									<div />
									<PromptInputSubmit disabled={isStreaming} />
								</PromptInputFooter>
							</PromptInput>
						</div>
					</div>
				</ResizablePanel>

				<ResizableHandle />

				<ResizablePanel defaultSize={30} minSize={15}>
					<div className="h-full p-4">
						<h2 className="font-semibold text-lg">Info</h2>
						<div className="mt-4 text-sm">
							{currentConversation ? (
								<>
									<p>
										<strong>Conversation ID:</strong> {currentConversation.id}
									</p>
									<p>
										<strong>Sandbox ID:</strong> {currentConversation.sandboxId}
									</p>
									<p>
										<strong>Agent URL:</strong> {currentConversation.agentUrl}
									</p>
								</>
							) : (
								<p>No active conversation</p>
							)}
						</div>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>

			{/* Logs Dialog */}
			<Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
				<DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Sandbox Logs</DialogTitle>
						<DialogDescription>
							Sandbox ID: {currentConversation?.sandboxId}
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4">
						<Button onClick={fetchLogs} disabled={logsLoading} className="mb-4">
							{logsLoading ? "Refreshing..." : "Refresh Logs"}
						</Button>

						{logsError && (
							<div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
								Error: {logsError}
							</div>
						)}

						{logs.length === 0 && !logsLoading && !logsError && (
							<div className="bg-gray-100 border border-gray-300 text-gray-700 px-4 py-3 rounded mb-4">
								No logs available yet. The server may still be starting up.
							</div>
						)}

						{logs.length > 0 && (
							<div className="border rounded-lg overflow-hidden">
								<Table>
									<TableCaption>
										Showing {logs.length} log {logs.length === 1 ? "entry" : "entries"}
									</TableCaption>
									<TableHeader>
										<TableRow>
											<TableHead className="w-[180px]">Timestamp</TableHead>
											<TableHead className="w-[80px]">Level</TableHead>
											<TableHead>Message</TableHead>
											<TableHead className="w-[200px]">Metadata</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{logs.map((log, index) => (
											<TableRow key={index}>
												<TableCell className="font-mono text-sm">
													{formatTimestamp(log.timestamp)}
												</TableCell>
												<TableCell>
													<span className={getLevelColor(log.level)}>
														{log.level.toUpperCase()}
													</span>
												</TableCell>
												<TableCell className="font-medium">{log.message}</TableCell>
												<TableCell>
													{formatMetadata(log) && (
														<pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto max-w-[200px]">
															{formatMetadata(log)}
														</pre>
													)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
