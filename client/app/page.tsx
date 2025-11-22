"use client";
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
import { useReducerWithCommands, type Command, type StateWithSideEffects } from "@/lib/react";

interface Conversation {
	id: string;
	first_prompt: string;
	agentUrl?: string;
	sandboxId?: string;
}

interface ToolCall {
	id: string;
	name: string;
	arguments: string;
	result: string | null; // null = waiting for result, string = received
}

type Message =
	| { role: "user"; content: string }
	| {
			role: "assistant";
			content: string;
			tool_calls?: ToolCall[];
			isStreaming: boolean;
	  };

interface LogEntry {
	timestamp: string;
	level: "info" | "warn" | "error";
	message: string;
	[key: string]: unknown;
}

// State
interface State {
	conversations: Conversation[];
	currentConversation: Conversation | null;
	messages: Message[];
	logsDialogOpen: boolean;
	logs: LogEntry[];
	logsLoading: boolean;
	logsError: string | null;
}

// Actions
type Action =
	| { type: "ConversationsLoaded"; conversations: Conversation[] }
	| { type: "SubmitPrompt"; text: string }
	| { type: "SandboxCreated"; agentUrl: string; sandboxId: string }
	| { type: "AssistantMessageStarted" }
	| { type: "TextDelta"; content: string }
	| { type: "ToolCallCompleted"; id: string; name: string; arguments: string }
	| { type: "ToolResultReceived"; id: string; result: string }
	| { type: "StreamingCompleted" }
	| { type: "StreamingError"; error: string }
	| { type: "SelectConversation"; conversation: Conversation }
	| { type: "KillSandbox" }
	| { type: "SandboxKilled" }
	| { type: "SandboxKillError"; error: string }
	| { type: "OpenLogsDialog" }
	| { type: "CloseLogsDialog" }
	| { type: "FetchLogs" }
	| { type: "LogsLoaded"; logs: LogEntry[] }
	| { type: "LogsError"; error: string };

// Initial state
const initialState: State = {
	conversations: [],
	currentConversation: null,
	messages: [],
	logsDialogOpen: false,
	logs: [],
	logsLoading: false,
	logsError: null,
};

// Commands
const loadConversationsFromStorage = (): Command<Action> => async () => {
	const stored = localStorage.getItem("conversations");
	if (stored) {
		try {
			const conversations = JSON.parse(stored);
			return { type: "ConversationsLoaded", conversations };
		} catch {
			return { type: "ConversationsLoaded", conversations: [] };
		}
	}
	return { type: "ConversationsLoaded", conversations: [] };
};

const saveConversationsToStorage = (conversations: Conversation[]): Command<Action> => () => {
	if (conversations.length > 0) {
		localStorage.setItem("conversations", JSON.stringify(conversations));
	}
	return { type: "ConversationsLoaded", conversations };
};

const createSandboxCommand = (): Command<Action> => async () => {
	try {
		const createResponse = await fetch("/api/sandbox/create", {
			method: "POST",
		});

		if (!createResponse.ok) {
			throw new Error("Failed to create sandbox");
		}

		const { agentUrl, sandboxId } = await createResponse.json();
		return { type: "SandboxCreated", agentUrl, sandboxId };
	} catch (error) {
		return {
			type: "StreamingError",
			error: error instanceof Error ? error.message : String(error),
		};
	}
};

const streamSubscription = (agentUrl: string, userPrompt: string) => (dispatch: (action: Action) => void) => {
	(async () => {
		try {
			// Create empty assistant message at start
			dispatch({ type: "AssistantMessageStarted" });

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
							if (parsed.type === "text_delta") {
								dispatch({ type: "TextDelta", content: parsed.content });
							} else if (parsed.type === "tool_call_complete") {
								dispatch({
									type: "ToolCallCompleted",
									id: parsed.call_id || parsed.id,
									name: parsed.name,
									arguments: parsed.arguments,
								});
							} else if (parsed.type === "tool_done") {
								if (parsed.item?.type === "function_call_output") {
									dispatch({
										type: "ToolResultReceived",
										id: parsed.item.call_id,
										result: parsed.item.output,
									});
								}
							} else if (parsed.type === "done") {
								dispatch({ type: "StreamingCompleted" });
							} else if (parsed.type === "error") {
								dispatch({ type: "StreamingError", error: parsed.message });
							}
						} catch {
							// Ignore JSON parse errors
						}
					}
				}
			}
		} catch (error) {
			dispatch({
				type: "StreamingError",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
};

const killSandboxCommand = (sandboxId: string): Command<Action> => async () => {
	try {
		const response = await fetch("/api/sandbox/kill", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sandboxId }),
		});

		if (!response.ok) {
			throw new Error("Failed to kill sandbox");
		}

		return { type: "SandboxKilled" };
	} catch (error) {
		return {
			type: "SandboxKillError",
			error: error instanceof Error ? error.message : String(error),
		};
	}
};

const fetchLogsCommand = (sandboxId: string): Command<Action> => async () => {
	try {
		const response = await fetch(`/api/sandbox/logs?sandboxId=${sandboxId}`);

		if (!response.ok) {
			const errorData = await response.json();
			throw new Error(errorData.error || "Failed to fetch logs");
		}

		const data = await response.json();

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
				} catch {
					console.error("Failed to parse log line:", line);
				}
			}

			return { type: "LogsLoaded", logs: parsedLogs };
		} else {
			return { type: "LogsLoaded", logs: [] };
		}
	} catch (err) {
		return {
			type: "LogsError",
			error: err instanceof Error ? err.message : "Unknown error",
		};
	}
};

// Helper function to find the streaming assistant message
function findStreamingAssistantIndex(messages: Message[]): number {
	return messages.findLastIndex(
		(msg) => msg.role === "assistant" && msg.isStreaming
	);
}

// Reducer
function reducer(state: State, action: Action): StateWithSideEffects<State, Action> {
	switch (action.type) {
		case "ConversationsLoaded":
			return { ...state, conversations: action.conversations };

		case "SubmitPrompt": {
			const userPrompt = action.text.trim();
			if (!userPrompt) return state;

			const userMessage: Message = { role: "user", content: userPrompt };
			const newMessages = [...state.messages, userMessage];

			if (!state.currentConversation) {
				return [
					{
						...state,
						messages: newMessages,
					},
					createSandboxCommand(),
				];
			} else if (state.currentConversation.agentUrl) {
				return [
					{
						...state,
						messages: newMessages,
					},
					[],
					streamSubscription(state.currentConversation.agentUrl, userPrompt),
				];
			}
			return state;
		}

		case "SandboxCreated": {
			if (!state.currentConversation) {
				const conversationId = nanoid();
				const userPrompt = state.messages[state.messages.length - 1]?.content || "";

				const newConversation: Conversation = {
					id: conversationId,
					first_prompt: userPrompt,
					agentUrl: action.agentUrl,
					sandboxId: action.sandboxId,
				};

				const updatedConversations = [...state.conversations, newConversation];

				return [
					{
						...state,
						conversations: updatedConversations,
						currentConversation: newConversation,
					},
					[
						saveConversationsToStorage(updatedConversations),
					],
					streamSubscription(action.agentUrl, userPrompt),
				];
			} else {
				const updatedConversation = {
					...state.currentConversation,
					agentUrl: action.agentUrl,
					sandboxId: action.sandboxId,
				};
				const updatedConversations = state.conversations.map((c) =>
					c.id === updatedConversation.id ? updatedConversation : c
				);

				const userPrompt = state.messages[state.messages.length - 1]?.content || "";

				return [
					{
						...state,
						conversations: updatedConversations,
						currentConversation: updatedConversation,
					},
					[
						saveConversationsToStorage(updatedConversations),
					],
					streamSubscription(action.agentUrl, userPrompt),
				];
			}
		}

		case "AssistantMessageStarted":
			return {
				...state,
				messages: [...state.messages, { role: "assistant", content: "", isStreaming: true }],
			};

		case "TextDelta": {
			const messages = [...state.messages];
			const streamingIdx = findStreamingAssistantIndex(messages);

			if (streamingIdx !== -1) {
				messages[streamingIdx] = {
					...messages[streamingIdx],
					content: messages[streamingIdx].content + action.content,
				};
			}

			return { ...state, messages };
		}

		case "ToolCallCompleted": {
			const messages = [...state.messages];
			const streamingIdx = findStreamingAssistantIndex(messages);

			if (streamingIdx !== -1) {
				const msg = messages[streamingIdx];
				if (msg.role === "assistant") {
					const tool_calls = msg.tool_calls || [];

					messages[streamingIdx] = {
						...msg,
						tool_calls: [
							...tool_calls,
							{
								id: action.id,
								name: action.name,
								arguments: action.arguments,
								result: null,
							},
						],
					};
				}
			}

			return { ...state, messages };
		}

		case "ToolResultReceived": {
			const messages = [...state.messages];
			const streamingIdx = findStreamingAssistantIndex(messages);

			if (streamingIdx !== -1) {
				const msg = messages[streamingIdx];
				if (msg.role === "assistant" && msg.tool_calls) {
					const tool_calls = msg.tool_calls.map((tc: ToolCall) =>
						tc.id === action.id ? { ...tc, result: action.result } : tc,
					);

					messages[streamingIdx] = {
						...msg,
						tool_calls,
					};
				}
			}

			return { ...state, messages };
		}

		case "StreamingCompleted": {
			const messages = [...state.messages];
			const streamingIdx = findStreamingAssistantIndex(messages);

			if (streamingIdx !== -1) {
				const msg = messages[streamingIdx];
				if (msg.role === "assistant") {
					messages[streamingIdx] = {
						...msg,
						isStreaming: false,
					};
				}
			}

			return { ...state, messages };
		}

		case "StreamingError": {
			const messages = [...state.messages];
			const streamingIdx = findStreamingAssistantIndex(messages);

			if (streamingIdx !== -1) {
				const msg = messages[streamingIdx];
				if (msg.role === "assistant") {
					messages[streamingIdx] = {
						...msg,
						content: msg.content + `\n\nError: ${action.error}`,
						isStreaming: false,
					};
				}
			}

			return { ...state, messages };
		}

		case "SelectConversation":
			return {
				...state,
				currentConversation: action.conversation,
				messages: [{ role: "user", content: action.conversation.first_prompt }],
			};

		case "KillSandbox": {
			if (!state.currentConversation?.sandboxId) return state;
			return [
				state,
				killSandboxCommand(state.currentConversation.sandboxId),
			];
		}

		case "SandboxKilled":
			alert(`Sandbox ${state.currentConversation?.sandboxId} killed successfully`);
			return {
				...state,
				currentConversation: null,
				messages: [],
			};

		case "SandboxKillError":
			alert(`Error killing sandbox: ${action.error}`);
			return state;

		case "OpenLogsDialog":
			if (!state.currentConversation?.sandboxId) return state;
			return [
				{
					...state,
					logsDialogOpen: true,
					logsLoading: true,
					logsError: null,
				},
				fetchLogsCommand(state.currentConversation.sandboxId),
			];

		case "CloseLogsDialog":
			return {
				...state,
				logsDialogOpen: false,
			};

		case "FetchLogs":
			if (!state.currentConversation?.sandboxId) return state;
			return [
				{
					...state,
					logsLoading: true,
					logsError: null,
				},
				fetchLogsCommand(state.currentConversation.sandboxId),
			];

		case "LogsLoaded":
			return {
				...state,
				logs: action.logs,
				logsLoading: false,
			};

		case "LogsError":
			return {
				...state,
				logsError: action.error,
				logsLoading: false,
			};

		default:
			return state;
	}
}

export default function Home() {
	const [state, dispatch] = useReducerWithCommands(
		reducer,
		initialState,
		loadConversationsFromStorage()
	);

	const handleSubmit = (promptMessage: { text: string }) => {
		dispatch({ type: "SubmitPrompt", text: promptMessage.text });
	};

	const handleKillSandbox = () => {
		dispatch({ type: "KillSandbox" });
	};

	const handleOpenLogs = () => {
		dispatch({ type: "OpenLogsDialog" });
	};

	const handleRefreshLogs = () => {
		dispatch({ type: "FetchLogs" });
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
		const metadata = Object.fromEntries(
			Object.entries(log).filter(([key]) => !['timestamp', 'level', 'message'].includes(key))
		);
		if (Object.keys(metadata).length === 0) return "";
		return JSON.stringify(metadata, null, 2);
	};

	return (
		<div className="h-screen w-full">
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel defaultSize={10} minSize={5}>
					<div className="h-full p-4">
						<h2 className="font-semibold text-lg">Conversations</h2>
						<div className="mt-4 space-y-2">
							{state.conversations.map((conv) => (
								<div
									key={conv.id}
									className="cursor-pointer rounded border p-2 text-sm hover:bg-accent"
									onClick={() => {
										dispatch({ type: "SelectConversation", conversation: conv });
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
						{state.currentConversation?.sandboxId && (
							<div className="sticky top-0 mb-4 flex items-center justify-between border-b bg-background pb-2">
								<h2 className="font-semibold text-lg">
									Sandbox: {state.currentConversation.sandboxId}
								</h2>
								<div className="flex gap-2">
									<Button variant="outline" onClick={handleOpenLogs}>
										Logs
									</Button>
									<Button variant="destructive" onClick={handleKillSandbox}>
										Kill {state.currentConversation.sandboxId}
									</Button>
								</div>
							</div>
						)}

						<div className="flex-1 space-y-4 overflow-y-auto">
							{state.messages.map((msg, idx) => (
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
										{msg.role === "assistant" && msg.isStreaming && " (streaming...)"}
									</div>

									{/* Text content */}
									{msg.content && (
										<div className="mt-1 whitespace-pre-wrap">{msg.content}</div>
									)}

									{/* Tool calls (assistant only) */}
									{msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0 && (
										<div className="mt-2 space-y-2">
											{msg.tool_calls.map((tool, toolIdx) => (
												<div
													key={toolIdx}
													className="border-l-2 border-purple-500 bg-purple-50 dark:bg-purple-900/20 pl-3 py-2 rounded"
												>
													<div className="font-mono text-sm font-semibold">
														🔧 {tool.name}
													</div>
													<div className="text-xs text-gray-600 dark:text-gray-400 mt-1 font-mono">
														{tool.arguments}
													</div>
													{tool.result === null ? (
														<div className="text-xs text-yellow-600 dark:text-yellow-400 mt-1 font-semibold">
															⏳ Executing...
														</div>
													) : (
														<div className="text-xs text-green-700 dark:text-green-400 mt-1 max-h-32 overflow-auto bg-white dark:bg-gray-800 p-2 rounded border">
															<div className="font-semibold mb-1">✅ Result:</div>
															<pre className="whitespace-pre-wrap">{tool.result}</pre>
														</div>
													)}
												</div>
											))}
										</div>
									)}
								</div>
							))}
						</div>

						<div className="mt-4">
							<PromptInput onSubmit={handleSubmit}>
								<PromptInputBody>
									<PromptInputTextarea
										placeholder="Type your research question..."
										disabled={state.messages.some(
											(m) => m.role === "assistant" && m.isStreaming,
										)}
									/>
								</PromptInputBody>
								<PromptInputFooter>
									<div />
									<PromptInputSubmit
										disabled={state.messages.some(
											(m) => m.role === "assistant" && m.isStreaming,
										)}
									/>
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
							{state.currentConversation ? (
								<>
									<p>
										<strong>Conversation ID:</strong> {state.currentConversation.id}
									</p>
									<p>
										<strong>Sandbox ID:</strong> {state.currentConversation.sandboxId}
									</p>
									<p>
										<strong>Agent URL:</strong> {state.currentConversation.agentUrl}
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
			<Dialog open={state.logsDialogOpen} onOpenChange={(open) => dispatch({ type: open ? "OpenLogsDialog" : "CloseLogsDialog" })}>
				<DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Sandbox Logs</DialogTitle>
						<DialogDescription>
							Sandbox ID: {state.currentConversation?.sandboxId}
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4">
						<Button onClick={handleRefreshLogs} disabled={state.logsLoading} className="mb-4">
							{state.logsLoading ? "Refreshing..." : "Refresh Logs"}
						</Button>

						{state.logsError && (
							<div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
								Error: {state.logsError}
							</div>
						)}

						{state.logs.length === 0 && !state.logsLoading && !state.logsError && (
							<div className="bg-gray-100 border border-gray-300 text-gray-700 px-4 py-3 rounded mb-4">
								No logs available yet. The server may still be starting up.
							</div>
						)}

						{state.logs.length > 0 && (
							<div className="border rounded-lg overflow-hidden">
								<Table>
									<TableCaption>
										Showing {state.logs.length} log {state.logs.length === 1 ? "entry" : "entries"}
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
										{state.logs.map((log, index) => (
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
