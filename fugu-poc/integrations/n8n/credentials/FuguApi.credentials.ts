import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

/**
 * Credential for the Sakana Fugu OpenAI-compatible API. The key is injected as a Bearer
 * header on every request; `test` hits `/models` so "Test" in the n8n UI validates it.
 */
export class FuguApi implements ICredentialType {
  name = "fuguApi";

  displayName = "Fugu API";

  documentationUrl = "https://sakana.ai/fugu/";

  properties: INodeProperties[] = [
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description: "Your Sakana API key (https://console.sakana.ai/get-started).",
    },
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      default: "https://api.sakana.ai/v1",
      description: "Fugu API base URL — copy the exact value from your console.",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.baseUrl}}",
      url: "/models",
    },
  };
}
