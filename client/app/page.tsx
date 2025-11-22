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

interface Message {
	role: "user" | "assistant";
	content: string;
}

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
	isStreaming: boolean;
	logsDialogOpen: boolean;
	logs: LogEntry[];
	logsLoading: boolean;
	logsError: string | null;
	currentAssistantMessage: string;
}

// Actions
type Action =
	| { type: "ConversationsLoaded"; conversations: Conversation[] }
	| { type: "SubmitPrompt"; text: string }
	| { type: "UserMessageAdded"; message: Message }
	| { type: "NewConversationCreated"; conversation: Conversation }
	| { type: "SandboxCreated"; agentUrl: string; sandboxId: string }
	| { type: "StreamingStarted" }
	| { type: "AssistantMessageStarted" }
	| { type: "StreamingDelta"; content: string }
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
	isStreaming: false,
	logsDialogOpen: false,
	logs: [],
	logsLoading: false,
	logsError: null,
	currentAssistantMessage: "",
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
							const parsed = JSON.parse(data);
							if (parsed.type === "delta") {
								dispatch({ type: "StreamingDelta", content: parsed.content });
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
						isStreaming: true,
					},
					createSandboxCommand(),
				];
			} else if (state.currentConversation.agentUrl) {
				return [
					{
						...state,
						messages: newMessages,
						isStreaming: true,
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
				messages: [...state.messages, { role: "assistant", content: "" }],
				currentAssistantMessage: "",
			};

		case "StreamingDelta": {
			const newAssistantMessage = state.currentAssistantMessage + action.content;
			const updatedMessages = [...state.messages];
			if (updatedMessages.length > 0 && updatedMessages[updatedMessages.length - 1].role === "assistant") {
				updatedMessages[updatedMessages.length - 1] = {
					role: "assistant",
					content: newAssistantMessage,
				};
			} else {
				updatedMessages.push({ role: "assistant", content: newAssistantMessage });
			}

			return {
				...state,
				messages: updatedMessages,
				currentAssistantMessage: newAssistantMessage,
			};
		}

		case "StreamingCompleted":
			return {
				...state,
				isStreaming: false,
				currentAssistantMessage: "",
			};

		case "StreamingError": {
			const errorMessage: Message = {
				role: "assistant",
				content: `Error: ${action.error}`,
			};
			return {
				...state,
				messages: [...state.messages, errorMessage],
				isStreaming: false,
				currentAssistantMessage: "",
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
										disabled={state.isStreaming}
									/>
								</PromptInputBody>
								<PromptInputFooter>
									<div />
									<PromptInputSubmit disabled={state.isStreaming} />
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
