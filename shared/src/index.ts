// Shared types will go here
export type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export type LogEntry = {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
} & Record<string, unknown>;
