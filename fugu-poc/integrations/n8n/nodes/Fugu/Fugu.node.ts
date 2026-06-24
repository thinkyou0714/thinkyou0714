import type { INodeType, INodeTypeDescription } from "n8n-workflow";

/**
 * Declarative n8n node for Sakana Fugu. Each operation is wired to an HTTP request via
 * `routing` — no execute() needed. Credentials inject the Bearer header (see FuguApi).
 */
export class Fugu implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Fugu",
    name: "fugu",
    icon: "file:fugu.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: "Call Sakana Fugu — a single endpoint that orchestrates a pool of frontier models",
    defaults: { name: "Fugu" },
    inputs: ["main"],
    outputs: ["main"],
    credentials: [{ name: "fuguApi", required: true }],
    requestDefaults: {
      baseURL: "={{$credentials.baseUrl}}",
      headers: { "Content-Type": "application/json" },
    },
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Respond",
            value: "respond",
            action: "Ask Fugu (Responses API)",
            description: "Single-prompt generation via the Responses API",
            routing: { request: { method: "POST", url: "/responses" } },
          },
          {
            name: "Chat",
            value: "chat",
            action: "Chat with Fugu (Chat Completions)",
            description: "Multi-turn chat via the Chat Completions API",
            routing: { request: { method: "POST", url: "/chat/completions" } },
          },
        ],
        default: "respond",
      },
      {
        displayName: "Model",
        name: "model",
        type: "options",
        options: [
          { name: "Fugu (fast)", value: "fugu" },
          { name: "Fugu Ultra (max quality)", value: "fugu-ultra" },
        ],
        default: "fugu-ultra",
        routing: { request: { body: { model: "={{$value}}" } } },
      },
      {
        displayName: "Input",
        name: "input",
        type: "string",
        typeOptions: { rows: 4 },
        default: "",
        required: true,
        displayOptions: { show: { operation: ["respond"] } },
        routing: { request: { body: { input: "={{$value}}" } } },
      },
      {
        displayName: "Reasoning Effort",
        name: "effort",
        type: "options",
        options: [
          { name: "Model Default", value: "" },
          { name: "High", value: "high" },
          { name: "X-High", value: "xhigh" },
          { name: "Max", value: "max" },
        ],
        default: "",
        description:
          'Reasoning effort. "Model Default" omits it so Fugu uses its own default — matching the core client, which only sends reasoning when set.',
        displayOptions: { show: { operation: ["respond"] } },
        // Omit `reasoning` entirely when unset (undefined is dropped on JSON serialization).
        routing: { request: { body: { reasoning: "={{ $value ? { effort: $value } : undefined }}" } } },
      },
      {
        displayName: "Messages (JSON)",
        name: "messages",
        type: "json",
        default: '[\n  { "role": "user", "content": "Hello, Fugu." }\n]',
        required: true,
        description: "Array of chat messages ({ role, content }).",
        displayOptions: { show: { operation: ["chat"] } },
        routing: { request: { body: { messages: "={{ JSON.parse($value) }}" } } },
      },
    ],
  };
}
