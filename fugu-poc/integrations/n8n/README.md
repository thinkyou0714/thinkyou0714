# n8n-nodes-fugu

An [n8n](https://n8n.io) **community node** for **Sakana Fugu** — call Fugu's
frontier-model pool from any workflow. Declarative node (routing-based, no custom
`execute()`), with a `Fugu API` credential that injects your key as a Bearer token.

## Node

**Fugu** (group: *transform*) — two operations:

| Operation | Request                       | Key fields                          |
|-----------|-------------------------------|-------------------------------------|
| Respond   | `POST /responses`             | Input, Model, Reasoning Effort      |
| Chat      | `POST /chat/completions`      | Messages (JSON array), Model        |

The node returns Fugu's raw JSON (so `output_text` / `usage` / orchestration tokens are all
available downstream — use a **Set**/**Edit Fields** node to pluck what you need).

## Credential — Fugu API

- **API Key** (stored encrypted) → sent as `Authorization: Bearer <key>`.
- **Base URL** — default `https://api.sakana.ai/v1` (copy the exact value from your console).
- **Test** hits `GET /models`, so the credential's *Test* button validates the key.

## Install (local dev)

n8n loads **compiled** nodes, so unlike the rest of this repo (which runs `.ts` directly)
this package is built with `tsc` to `dist/`.

```bash
cd integrations/n8n
npm install          # pulls n8n-workflow (peer) for types
npm run build        # tsc -> dist/ (+ copies the icon)

# load it into a local n8n via the custom-extensions dir:
mkdir -p ~/.n8n/custom && ln -s "$PWD" ~/.n8n/custom/n8n-nodes-fugu
n8n start            # the "Fugu" node + "Fugu API" credential now appear
```

To publish to the community registry, drop `"private": true`, fill in `author`/`repository`,
run `npm run build`, and `npm publish` (the `n8n` field in `package.json` registers the node
and credential).

## Layout

```
integrations/n8n/
├── credentials/FuguApi.credentials.ts   # ICredentialType: Bearer auth + /models test
├── nodes/Fugu/Fugu.node.ts              # declarative INodeType (routing per operation)
├── nodes/Fugu/fugu.svg                  # node icon
├── package.json                         # n8n: { credentials, nodes }
└── tsconfig.json                        # CJS build -> dist/
```

> Template status: structured to the n8n community-node spec and typechecked against
> `n8n-workflow`. Run `npm run build` then load it into a local n8n to exercise it live.
