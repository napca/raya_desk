# Assistant: architecture, adapters and actions

## Layers

```text
UI (panel.js) ── state machine (machine.js)
   │
   ├─ SpeechToText adapter ── MockSpeechToText | BrowserSpeechToText
   ├─ TextToSpeech adapter ── BrowserTextToSpeech (opt-in per user)
   ├─ Agent adapter ───────── ServerAgent → assistant.api.interpret → provider (MockAgentProvider)
   └─ Executor ────────────── assistant.api.run_action / preview_action / confirm_action / cancel_action
                                   │
                                   └─ registry (schema, permission, read/write, preview) → actions → ERPNext
```

- The provider only **proposes**: `{reply, proposal: {action, params} | null, clarify: {question, choices, link?} | null, demo}`.
- Execution is always separate and re-validated on the server. Model output cannot run SQL, code or an action outside the registry.
- What reaches the provider: the request text, plus a sanitized context (route, view, doctype, docname, `is_new`, up to 200 selected names, page filters). No field values.

## State machine

`idle → requesting-permission → listening → transcribing → idle` (the recognised text stays editable in the box)

`idle → thinking → (idle | awaiting-confirmation | speaking | error | cancelled)`

`awaiting-confirmation → executing → idle | speaking | error`

Each turn has a number. A cancelled or stale turn ignores late responses. Stop recording, cancel the
request, stop playback and fall back to typing are all available. Closing the panel stops the
microphone, and it is never left on in the background.

## Adapter contracts (`public/js/raya/assistant/adapters.js`)

```text
SpeechToText  { id, label, demo, available(), start({ on_partial }) → Promise, stop() → Promise<text>, cancel() }
Agent         { id, interpret(text, context) → Promise<{ reply, proposal?, clarify?, demo }> }
TextToSpeech  { id, label, demo, available(), speak(text) → Promise, stop() }
Executor      { run, preview, confirm(token, params_hash), cancel(token), capabilities }
```

A streaming provider can implement the same interfaces: `on_partial` for interim transcripts, and
the Agent can buffer its output until the final result.

## Action registry

| Action | Type | Permission | Maps to |
| --- | --- | --- | --- |
| `get_dashboard_metrics` | read | per metric | dashboard metrics |
| `search_stale_leads` | read | Lead read | leads needing follow-up |
| `get_sales_report` | read | Sales Invoice read | sales, trend, per branch |
| `explain_document` | read | read on that document | key fields; invoice summary and items |
| `summarize_selection` | read | doctype read | count and statuses of the selected rows |
| `create_followup` | **write** | read on the reference + ToDo create | a ToDo for the current user |
| `assign_leads` | **write** | Lead write + assignable users | `lead_owner`, `raya_branch`, assignment |

Each action declares a schema (`Param`: type, required, choices, range, item count). Unknown
parameters are rejected. `GET /api/method/raya_desk.assistant.api.get_capabilities` returns this
contract.

## Confirmation protocol for writes

1. `preview_action(action, params)`: validates and checks permissions, builds a preview, and creates a `Raya Assistant Log` row (status `Previewed`) holding the bound parameters, their hash, the user and an expiry (`preview_ttl_minutes`, default 10). The row name is the token.
2. The UI shows the exact scope (counts, people, dates and time zone, skipped items, duplicates).
3. `confirm_action(token, params_hash)`: locks the row (`SELECT … FOR UPDATE`) and checks user, status, expiry and hash. It re-checks permissions, runs the action once and records the result. A second confirmation returns «قبلاً اجرا شده».
4. Changing parameters, changing route or cancelling discards the preview (`Cancelled`); a new request needs a new preview.

The `interpret`, `run_action`, `preview_action` and `confirm_action` endpoints are POST-only and
rate-limited (Frappe CSRF applies). Log rows keep the bound parameters and result, never transcripts
or conversation text. Retention follows Log Settings (`default_log_clearing_doctypes`, 90 days).

## Connecting a real service

1. **Agent:** subclass `AgentProvider` in `assistant/providers.py`. Feed `registry.describe()` to the model as its tool list and return the same output shape. Read the key from `site_config.json`, e.g. `frappe.conf.get("raya_agent_api_key")`, never from Git or the browser. Add it to `PROVIDERS` and to the `agent_provider` options in Raya Desk Settings.
2. **Speech-to-text:** for the browser engine, set Raya Desk Settings → `stt_provider = browser` (requires HTTPS on the real domain; Chrome sends audio to its own service). For a server-side service, add a whitelisted audio endpoint and a new adapter with the same contract.
3. **Text-to-speech:** for a server voice, add a `TextToSpeech` adapter that plays the audio the server returns.
4. Turn off the «نمایشی» badges once a real provider is selected (they come from `boot_config()` values).

Remaining work before going live: choose the providers and their keys, write a retention and
privacy policy for audio if it is ever stored (today it is not stored), and run permission tests for
the real roles of the organisation.
