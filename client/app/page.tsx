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
import {
	useReducerWithCommands,
	type Command,
	type StateWithSideEffects,
} from "@/lib/react";
import type { Message, StreamAction, LogEntry } from "@shared/index";
import {
	Markdown,
	getReadingList,
	removeFromReadingList,
	type ReadingListItem,
} from "@/components/ui/markdown";
import {
	Tool,
	ToolHeader,
	ToolContent,
	ToolInput,
	ToolOutput,
} from "@/components/ai-elements/tool";
import { useEffect, useState } from "react";

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
	| { type: "NewResearch" }
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

const IS_DEV = false;

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

const saveConversationsToStorage =
	(conversations: Conversation[]): Command<Action> =>
	() => {
		if (conversations.length > 0) {
			localStorage.setItem("conversations", JSON.stringify(conversations));
		}
		return { type: "ConversationsLoaded", conversations };
	};

const saveMessagesToStorage =
	(conversationId: string, messages: Message[]): Command<Action> =>
	async () => {
		const key = `messages_${conversationId}`;
		localStorage.setItem(key, JSON.stringify(messages));
		// No action needed, this is a side effect only
		// Return a no-op action by reloading current conversations
		const stored = localStorage.getItem("conversations");
		const conversations = stored ? JSON.parse(stored) : [];
		return { type: "ConversationsLoaded", conversations };
	};

const loadMessagesFromStorage = (conversationId: string): Message[] => {
	const key = `messages_${conversationId}`;
	const stored = localStorage.getItem(key);
	if (stored) {
		try {
			return JSON.parse(stored);
		} catch {
			return [];
		}
	}
	return [];
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

const streamSubscription =
	(agentUrl: string, userPrompt: string) =>
	(dispatch: (action: Action) => void) => {
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
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value, { stream: true });
					buffer += chunk;

					const lines = buffer.split("\n");
					// Keep the last potentially incomplete line in the buffer
					buffer = lines.pop() || "";

					for (const line of lines) {
						if (line.startsWith("data: ")) {
							const data = line.slice(6);
							try {
								const action = JSON.parse(data) as
									| StreamAction
									| { type: "error"; message: string };

								// Handle error events
								if ("type" in action && action.type === "error") {
									dispatch({
										type: "StreamingError",
										error: (action as { type: "error"; message: string })
											.message,
									});
								} else {
									// Dispatch StreamAction directly
									console.log("[SSE] Dispatching action:", action.type, action);
									dispatch(action as StreamAction);
								}
							} catch (error) {
								// Log JSON parse errors to debug
								console.error("[SSE] JSON parse error for line:", {
									linePreview:
										data.substring(0, 100) + (data.length > 100 ? "..." : ""),
									lineLength: data.length,
									error: error instanceof Error ? error.message : String(error),
								});
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

const killSandboxCommand =
	(sandboxId: string): Command<Action> =>
	async () => {
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

const fetchLogsCommand =
	(sandboxId: string): Command<Action> =>
	async () => {
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
function reducer(
	state: State,
	action: Action,
): StateWithSideEffects<State, Action> {
	switch (action.type) {
		case "ConversationsLoaded":
			return { ...state, conversations: action.conversations };

		case "SubmitPrompt": {
			const userPrompt = action.text.trim();
			if (!userPrompt) return state;

			const userMessage: Message = { role: "user", content: userPrompt };
			const newMessages = [...state.messages, userMessage];

			if (!state.currentConversation) {
				// Create a temporary conversation object immediately
				const conversationId = nanoid();
				const tempConversation: Conversation = {
					id: conversationId,
					first_prompt: userPrompt,
				};

				return [
					{
						...state,
						messages: newMessages,
						currentConversation: tempConversation,
					},
					createSandboxCommand(),
				];
			} else if (state.currentConversation.agentUrl) {
				return [
					{
						...state,
						messages: newMessages,
					},
					[saveMessagesToStorage(state.currentConversation.id, newMessages)],
					streamSubscription(state.currentConversation.agentUrl, userPrompt),
				];
			}
			return state;
		}

		case "SandboxCreated": {
			const lastMessage = state.messages[state.messages.length - 1];
			const userPrompt =
				lastMessage?.role === "user" || lastMessage?.role === "assistant"
					? lastMessage.content
					: "";

			if (!state.currentConversation) {
				// Fallback: create conversation if somehow we don't have one
				const conversationId = nanoid();
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
						saveMessagesToStorage(conversationId, state.messages),
					],
					streamSubscription(action.agentUrl, userPrompt),
				];
			} else {
				// Update existing conversation with sandbox details
				const updatedConversation = {
					...state.currentConversation,
					agentUrl: action.agentUrl,
					sandboxId: action.sandboxId,
				};

				// Check if conversation is already in the list
				const existingIndex = state.conversations.findIndex(
					(c) => c.id === updatedConversation.id,
				);
				const updatedConversations =
					existingIndex >= 0
						? state.conversations.map((c) =>
								c.id === updatedConversation.id ? updatedConversation : c,
							)
						: [...state.conversations, updatedConversation];

				return [
					{
						...state,
						conversations: updatedConversations,
						currentConversation: updatedConversation,
					},
					[
						saveConversationsToStorage(updatedConversations),
						saveMessagesToStorage(updatedConversation.id, state.messages),
					],
					streamSubscription(action.agentUrl, userPrompt),
				];
			}
		}

		// StreamAction handlers
		case "ASSISTANT_TEXT_STARTED": {
			// Add new assistant message to messages array
			const newMessages: Message[] = [
				...state.messages,
				{ role: "assistant", content: "" },
			];
			return [
				{
					...state,
					messages: newMessages,
					isAgentTalking: true,
				},
				state.currentConversation
					? [saveMessagesToStorage(state.currentConversation.id, newMessages)]
					: [],
			];
		}

		case "ASSISTANT_TEXT_DELTA": {
			// Append delta to the last assistant message
			const messages: Message[] = [...state.messages];
			const lastIdx = messages.length - 1;

			if (lastIdx >= 0 && messages[lastIdx].role === "assistant") {
				messages[lastIdx] = {
					...messages[lastIdx],
					content: messages[lastIdx].content + action.delta,
				};
			}

			return [
				{ ...state, messages },
				state.currentConversation
					? [saveMessagesToStorage(state.currentConversation.id, messages)]
					: [],
			];
		}

		case "ASSISTANT_TEXT_DONE": {
			// Text streaming complete, no state change needed (message already added)
			return state;
		}

		case "TOOL_CALL_ARGUMENTS_DONE": {
			// Add tool_call message
			const newMessages: Message[] = [
				...state.messages,
				{
					role: "tool_call" as const,
					id: action.toolCallId,
					name: action.name,
					arguments: action.arguments,
				},
			];
			return [
				{
					...state,
					messages: newMessages,
				},
				state.currentConversation
					? [saveMessagesToStorage(state.currentConversation.id, newMessages)]
					: [],
			];
		}

		case "TOOL_RESULT_RECEIVED": {
			// Add tool_result message
			const newMessages: Message[] = [
				...state.messages,
				{
					role: "tool_result" as const,
					id: action.toolCallId,
					content: action.output,
				},
			];
			return [
				{
					...state,
					messages: newMessages,
				},
				state.currentConversation
					? [saveMessagesToStorage(state.currentConversation.id, newMessages)]
					: [],
			];
		}

		case "LLM_TURN_FINISHED": {
			// Agent turn complete
			return {
				...state,
				isAgentTalking: false,
			};
		}

		case "ERROR": {
			// Add error message with error role
			const newMessages: Message[] = [
				...state.messages,
				{ role: "error" as const, content: action.error },
			];
			return [
				{
					...state,
					messages: newMessages,
					isAgentTalking: false,
				},
				state.currentConversation
					? [saveMessagesToStorage(state.currentConversation.id, newMessages)]
					: [],
			];
		}

		case "StreamingError": {
			// Add error message with error role
			const newMessages: Message[] = [
				...state.messages,
				{ role: "error" as const, content: action.error },
			];
			return [
				{
					...state,
					messages: newMessages,
					isAgentTalking: false,
				},
				state.currentConversation
					? [saveMessagesToStorage(state.currentConversation.id, newMessages)]
					: [],
			];
		}

		case "SelectConversation": {
			const loadedMessages = loadMessagesFromStorage(action.conversation.id);
			return {
				...state,
				currentConversation: action.conversation,
				messages:
					loadedMessages.length > 0
						? loadedMessages
						: [{ role: "user", content: action.conversation.first_prompt }],
			};
		}

		case "NewResearch": {
			return {
				...state,
				currentConversation: null,
				messages: [],
			};
		}

		case "KillSandbox": {
			if (!state.currentConversation?.sandboxId) return state;
			return [state, killSandboxCommand(state.currentConversation.sandboxId)];
		}

		case "SandboxKilled":
			alert(
				`Sandbox ${state.currentConversation?.sandboxId} killed successfully`,
			);
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
		loadConversationsFromStorage(),
	);

	const [readingList, setReadingList] = useState<ReadingListItem[]>([]);

	// Load reading list on mount and listen for updates
	useEffect(() => {
		setReadingList(getReadingList());

		const handleReadingListUpdate = () => {
			setReadingList(getReadingList());
		};

		window.addEventListener("readingListUpdated", handleReadingListUpdate);
		return () => {
			window.removeEventListener("readingListUpdated", handleReadingListUpdate);
		};
	}, []);

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
			Object.entries(log).filter(
				([key]) => !["timestamp", "level", "message"].includes(key),
			),
		);
		if (Object.keys(metadata).length === 0) return "";
		return JSON.stringify(metadata, null, 2);
	};

	return (
		<div className="h-screen w-full">
			<ResizablePanelGroup direction="horizontal">
				<ResizablePanel defaultSize={15} minSize={10}>
					<div className="h-full p-4 flex flex-col">
						<Button
							variant="secondary"
							className="w-full mt-4"
							onClick={() => {
								dispatch({ type: "NewResearch" });
							}}
						>
							+ New research
						</Button>
						<div className="mt-4 space-y-2 overflow-y-auto flex-1">
							{state.conversations.map((conv) => (
								<Button
									key={conv.id}
									variant="ghost"
									className={`w-full justify-start text-left overflow-hidden ${
										state.currentConversation?.id === conv.id ? "bg-accent" : ""
									}`}
									onClick={() => {
										dispatch({
											type: "SelectConversation",
											conversation: conv,
										});
									}}
								>
									<span className="truncate">{conv.first_prompt}</span>
								</Button>
							))}
						</div>
					</div>
				</ResizablePanel>

				<ResizableHandle />

				<ResizablePanel defaultSize={60} minSize={30}>
					<div className="flex h-full flex-col relative overflow-hidden">
						{IS_DEV && state.currentConversation?.sandboxId && (
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

						<div className="flex-1 overflow-y-auto flex justify-center relative">
							<div className="w-full max-w-[800px] p-4">
								<div className="space-y-4 pb-40">
									{state.messages.map((msg, idx) => {
										// Generate a stable key for each message type
										const messageKey =
											msg.role === "tool_call" || msg.role === "tool_result"
												? `${msg.role}-${msg.id}`
												: `${msg.role}-${idx}`;

										// Render user messages
										if (msg.role === "user") {
											return (
												<div key={messageKey} className="flex justify-end">
													<div className="rounded-2xl p-3 bg-gray-100 dark:bg-gray-100 max-w-[500px]">
														<div className="whitespace-pre-wrap">
															{msg.content}
														</div>
													</div>
												</div>
											);
										}

										// Render assistant messages
										if (msg.role === "assistant") {
											return (
												<div key={messageKey} className="rounded p-3">
													<div className="font-semibold text-sm">
														{state.isAgentTalking &&
															idx === state.messages.length - 1 &&
															" (streaming...)"}
													</div>
													{msg.content && (
														<div className="mt-1">
															<Markdown>{msg.content}</Markdown>
														</div>
													)}
												</div>
											);
										}

										// Render tool_call messages
										if (msg.role === "tool_call") {
											// Check if we have a corresponding tool_result
											const toolResult = state.messages.find(
												(m) => m.role === "tool_result" && m.id === msg.id,
											);

											// Determine the state based on whether we have a result
											const toolState = toolResult
												? "output-available"
												: "input-available";

											// Parse arguments for display
											let parsedArgs: Record<string, unknown> = {};
											try {
												parsedArgs = JSON.parse(msg.arguments);
											} catch {
												parsedArgs = { raw: msg.arguments };
											}

											return (
												<Tool key={messageKey}>
													<ToolHeader
														title={msg.name}
														type={`tool-${msg.name}`}
														state={toolState}
													/>
													<ToolContent>
														<ToolInput input={parsedArgs} />
														{toolResult &&
															toolResult.role === "tool_result" && (
																<ToolOutput
																	output={toolResult.content}
																	errorText={undefined}
																/>
															)}
													</ToolContent>
												</Tool>
											);
										}

										// Don't render tool_result messages separately (they're shown within tool_call)
										if (msg.role === "tool_result") {
											return null;
										}

										// Render error messages
										if (msg.role === "error") {
											return (
												<div key={messageKey} className="text-red-600">
													Error: {msg.content}
												</div>
											);
										}

										return null;
									})}
								</div>
							</div>
						</div>
						<div className="absolute bottom-0 left-0 right-0 flex justify-center pointer-events-none p-4">
							<div className="w-full max-w-[800px] bg-white dark:bg-background pointer-events-auto">
								<PromptInput onSubmit={handleSubmit}>
									<PromptInputBody>
										<PromptInputTextarea
											placeholder="Type your research question..."
											disabled={state.isAgentTalking}
										/>
									</PromptInputBody>
									<PromptInputFooter>
										<div />
										<PromptInputSubmit disabled={state.isAgentTalking} />
									</PromptInputFooter>
								</PromptInput>
							</div>
						</div>
					</div>
				</ResizablePanel>

				<ResizableHandle />

				<ResizablePanel defaultSize={30} minSize={15}>
					<div className="h-full p-4 flex flex-col">
						<h2 className="font-semibold text-lg mb-4">Reading List</h2>
						<div className="flex-1 overflow-y-auto space-y-2">
							{readingList.length === 0 ? (
								<p className="text-sm text-gray-500 dark:text-gray-400">
									No papers saved yet. Hover over paper citations in assistant
									responses to save them.
								</p>
							) : (
								readingList.map((item, index) => (
									<div
										key={index}
										className="group relative flex items-start justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
									>
										<div className="flex-1 min-w-0">
											<a
												href={item.link}
												target="_blank"
												rel="noopener noreferrer"
												className="block"
											>
												<p className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
													{item.name}
												</p>
												<p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1">
													{item.link}
												</p>
											</a>
										</div>
										<Button
											size="sm"
											variant="ghost"
											className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
											onClick={() => {
												removeFromReadingList(item.link);
											}}
										>
											×
										</Button>
									</div>
								))
							)}
						</div>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>

			{/* Logs Dialog */}
			<Dialog
				open={state.logsDialogOpen}
				onOpenChange={(open) =>
					dispatch({ type: open ? "OpenLogsDialog" : "CloseLogsDialog" })
				}
			>
				<DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Sandbox Logs</DialogTitle>
						<DialogDescription>
							Sandbox ID: {state.currentConversation?.sandboxId}
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4">
						<Button
							onClick={handleRefreshLogs}
							disabled={state.logsLoading}
							className="mb-4"
						>
							{state.logsLoading ? "Refreshing..." : "Refresh Logs"}
						</Button>

						{state.logsError && (
							<div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
								Error: {state.logsError}
							</div>
						)}

						{state.logs.length === 0 &&
							!state.logsLoading &&
							!state.logsError && (
								<div className="bg-gray-100 border border-gray-300 text-gray-700 px-4 py-3 rounded mb-4">
									No logs available yet. The server may still be starting up.
								</div>
							)}

						{state.logs.length > 0 && (
							<div className="border rounded-lg overflow-hidden">
								<Table>
									<TableCaption>
										Showing {state.logs.length} log{" "}
										{state.logs.length === 1 ? "entry" : "entries"}
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
												<TableCell className="font-medium">
													{log.message}
												</TableCell>
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
