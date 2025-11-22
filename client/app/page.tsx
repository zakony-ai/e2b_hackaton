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
import type { Message, StreamAction, LogEntry } from "@shared/index";

interface Conversation {
	id: string;
	first_prompt: string;
	agentUrl?: string;
	sandboxId?: string;
}

// State
interface State {
	conversations: Conversation[];
	currentConversation: Conversation | null;
	messages: Message[];
	isAgentTalking: boolean; // Track if we're currently receiving a stream
	logsDialogOpen: boolean;
	logs: LogEntry[];
	logsLoading: boolean;
	logsError: string | null;
}

// Actions - combine StreamAction with app-specific actions
type Action =
	| StreamAction // All stream actions from shared types
	| { type: "ConversationsLoaded"; conversations: Conversation[] }
	| { type: "SubmitPrompt"; text: string }
	| { type: "SandboxCreated"; agentUrl: string; sandboxId: string }
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
	isAgentTalking: false,
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
							const action = JSON.parse(data) as StreamAction | { type: "error"; message: string };

							// Handle error events
							if ("type" in action && action.type === "error") {
								dispatch({ type: "StreamingError", error: (action as { type: "error"; message: string }).message });
							} else {
								// Dispatch StreamAction directly
								dispatch(action as StreamAction);
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
				const lastMessage = state.messages[state.messages.length - 1];
				const userPrompt = (lastMessage?.role === "user" || lastMessage?.role === "assistant") ? lastMessage.content : "";

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

				const lastMessage = state.messages[state.messages.length - 1];
				const userPrompt = (lastMessage?.role === "user" || lastMessage?.role === "assistant") ? lastMessage.content : "";

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

		// StreamAction handlers
		case "ASSISTANT_TEXT_STARTED": {
			// Add new assistant message to messages array
			return {
				...state,
				messages: [...state.messages, { role: "assistant", content: "" }],
				isAgentTalking: true,
			};
		}

		case "ASSISTANT_TEXT_DELTA": {
			// Append delta to the last assistant message
			const messages = [...state.messages];
			const lastIdx = messages.length - 1;

			if (lastIdx >= 0 && messages[lastIdx].role === "assistant") {
				messages[lastIdx] = {
					...messages[lastIdx],
					content: messages[lastIdx].content + action.delta,
				};
			}

			return { ...state, messages };
		}

		case "ASSISTANT_TEXT_DONE": {
			// Text streaming complete, no state change needed (message already added)
			return state;
		}

		case "TOOL_CALL_ARGUMENTS_DONE": {
			// Add tool_call message
			return {
				...state,
				messages: [
					...state.messages,
					{
						role: "tool_call",
						id: action.toolCallId,
						name: action.name,
						arguments: action.arguments,
					},
				],
			};
		}

		case "TOOL_RESULT_RECEIVED": {
			// Add tool_result message
			return {
				...state,
				messages: [
					...state.messages,
					{
						role: "tool_result",
						id: action.toolCallId,
						content: action.output,
					},
				],
			};
		}

		case "LLM_TURN_FINISHED": {
			// Agent turn complete
			return {
				...state,
				isAgentTalking: false,
			};
		}

		case "StreamingError": {
			// Add error message as assistant message
			return {
				...state,
				messages: [
					...state.messages,
					{ role: "assistant", content: `Error: ${action.error}` },
				],
				isAgentTalking: false,
			};
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
							{state.messages.map((msg, idx) => {
								// Render user messages
								if (msg.role === "user") {
									return (
										<div key={idx} className="rounded p-3 bg-blue-100 dark:bg-blue-900">
											<div className="font-semibold text-sm">You</div>
											<div className="mt-1 whitespace-pre-wrap">{msg.content}</div>
										</div>
									);
								}

								// Render assistant messages
								if (msg.role === "assistant") {
									return (
										<div key={idx} className="rounded p-3 bg-gray-100 dark:bg-gray-800">
											<div className="font-semibold text-sm">
												Assistant
												{state.isAgentTalking && idx === state.messages.length - 1 && " (streaming...)"}
											</div>
											{msg.content && (
												<div className="mt-1 whitespace-pre-wrap">{msg.content}</div>
											)}
										</div>
									);
								}

								// Render tool_call messages
								if (msg.role === "tool_call") {
									// Check if we have a corresponding tool_result
									const toolResult = state.messages
										.slice(idx + 1)
										.find((m) => m.role === "tool_result" && m.id === msg.id);

									return (
										<div key={idx} className="rounded p-3 bg-purple-50 dark:bg-purple-900/20">
											<div className="border-l-2 border-purple-500 pl-3 py-2">
												<div className="font-mono text-sm font-semibold">
													🔧 {msg.name}
												</div>
												<div className="text-xs text-gray-600 dark:text-gray-400 mt-1 font-mono">
													{msg.arguments}
												</div>
												{!toolResult || toolResult.role !== "tool_result" ? (
													<div className="text-xs text-yellow-600 dark:text-yellow-400 mt-1 font-semibold">
														⏳ Executing...
													</div>
												) : (
													<div className="text-xs text-green-700 dark:text-green-400 mt-1 max-h-32 overflow-auto bg-white dark:bg-gray-800 p-2 rounded border">
														<div className="font-semibold mb-1">✅ Result:</div>
														<pre className="whitespace-pre-wrap">{toolResult.content}</pre>
													</div>
												)}
											</div>
										</div>
									);
								}

								// Don't render tool_result messages separately (they're shown within tool_call)
								if (msg.role === "tool_result") {
									return null;
								}

								return null;
							})}
						</div>

						<div className="mt-4">
							<PromptInput onSubmit={handleSubmit}>
								<PromptInputBody>
									<PromptInputTextarea
										placeholder="Type your research question..."
										disabled={state.isAgentTalking}
									/>
								</PromptInputBody>
								<PromptInputFooter>
									<div />
									<PromptInputSubmit
										disabled={state.isAgentTalking}
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
