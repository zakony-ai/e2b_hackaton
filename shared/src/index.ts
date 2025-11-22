// Shared types for message handling based on Groq Responses API stream events

// Message types stored in messages.ndjson and displayed in UI
export type Message
  = { role: "prompt"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "tool_call"; id: string; name: string; arguments: string }
  | { role: "tool_result"; id: string; content: string };

// Actions dispatched from stream events to update UI
export type StreamAction =
  // Tool call lifecycle
  | { type: "TOOL_CALL_ARGUMENTS_DONE"; toolCallId: string; name: string; arguments: string }
  | { type: "TOOL_RESULT_RECEIVED"; toolCallId: string; output: string }
  // Assistant text streaming lifecycle
  | { type: "ASSISTANT_TEXT_STARTED" }
  | { type: "ASSISTANT_TEXT_DELTA"; delta: string }
  | { type: "ASSISTANT_TEXT_DONE" }
  // Turn completion
  | { type: "LLM_TURN_FINISHED" }
  // Error handling
  | { type: "ERROR"; error: string };

export type LogEntry = {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
} & Record<string, unknown>;
