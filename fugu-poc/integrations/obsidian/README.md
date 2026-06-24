# fugu-obsidian

Ask **Sakana Fugu** about your current Obsidian note and append the answer back into the
note — a zero-dependency Node CLI that talks to Obsidian via the
[**Local REST API**](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin.

It reads the target note, sends it (plus your optional question) to Fugu, and appends the
reply under a `## 🐡 Fugu` heading. Appending — never overwriting — keeps it non-destructive.

## Setup

1. In Obsidian, install & enable the **Local REST API** plugin, then copy its **API Key**
   (Settings → Local REST API).
2. The plugin serves HTTPS on `https://127.0.0.1:27124` with a **self-signed** certificate.
   Either trust its certificate (download it from the plugin settings and point Node at it):

   ```bash
   export NODE_EXTRA_CA_CERTS=/path/to/obsidian-local-rest-api.crt
   ```

   …or enable the plugin's non-encrypted HTTP port and set
   `OBSIDIAN_API_URL=http://127.0.0.1:27123`.

## Run

```bash
export SAKANA_API_KEY=...      # https://console.sakana.ai/get-started
export OBSIDIAN_API_KEY=...    # Obsidian → Local REST API → API Key

# ask about the currently-active note:
node integrations/obsidian/src/bin.ts "What's missing from this plan?"

# target a specific note, pick the model/effort:
node integrations/obsidian/src/bin.ts --path "Projects/Fugu.md" --model fugu-ultra --effort high
```

Requires **Node >= 22.9** (runs the `.ts` directly via native type-stripping).

| Flag        | Meaning                                                       |
|-------------|---------------------------------------------------------------|
| `[question]`| Instruction for Fugu (default: "read and respond helpfully"). |
| `--path`    | Vault-relative note path (default: the active note).          |
| `--model`   | `fugu` (fast) or `fugu-ultra` (max quality).                  |
| `--effort`  | `high` / `xhigh` / `max`.                                     |
| `--heading` | Heading the answer is filed under (default `## 🐡 Fugu`).      |

| Env                | Meaning                                              |
|--------------------|------------------------------------------------------|
| `SAKANA_API_KEY`   | Fugu API key (required).                              |
| `OBSIDIAN_API_KEY` | Local REST API key (required).                       |
| `OBSIDIAN_API_URL` | Plugin base URL (default `https://127.0.0.1:27124`). |

## Design

The orchestration (`src/command.ts`, `runFuguOnNote`) is **pure** — it depends only on a
`NoteStore` and a `Responder`, so it is unit-tested from the core suite
(`fugu-poc/test/obsidian.test.ts`) with a mocked Local REST API and a mocked Fugu.
`src/obsidian-api.ts` is the thin fetch wrapper (errors are redacted at the boundary — the
API key never reaches a message or log); `src/bin.ts` wires env + args to a real
`ObsidianClient` + `FuguClient`. No runtime dependencies.
