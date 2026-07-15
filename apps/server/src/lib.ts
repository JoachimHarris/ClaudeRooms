// Library entry point: the desktop app embeds the collaboration server by
// importing from here and running it in its own engine process.
export { buildServer, type BuiltServer } from "./server.js";
export { loadConfig, type ServerConfig } from "./config.js";
export { FakeClaudeAdapter } from "./claude/fake-adapter.js";
export type {
  ClaudeAdapter,
  ClaudeAdapterEvent,
  ClaudeRequestInput,
} from "./claude/adapter.js";
