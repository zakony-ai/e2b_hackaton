// Shared types will go here
export type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  [key: string]: any;
}
