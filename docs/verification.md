# Verification (2026-11-01)

Environment: `deploy/raya/dev.compose.yaml` (frappe/bench `sha256:1594a840…`, MariaDB 11.8,
Redis 8.6), Frappe 16.54.0, ERPNext 16.53.0, site `raya.localhost`, Persian language, time zone
Asia/Tehran. Data: sample data from `raya_desk.dev.seed`, tagged «Raya Sample».

## Automated (`bench run-tests --app raya_desk`): 20 tests, all passing

- Jalali conversion: known dates and a round trip over 800 days; the start of «this month» is 1 Aban 1405.
- Registry: rejects unknown actions, unknown parameters (e.g. `sql`) and out-of-range values; a write action cannot run as a read.
- Permissions: a user with only `Accounts User` is refused on stale-lead search and on assignment.
- The stale-lead definition with a scheduled ToDo.
- Confirmation: preview does not write; confirm runs exactly once (a second confirm is refused); confirmation is bound to the user, the parameter hash and the expiry; a cancelled preview cannot run; past dates are rejected.
- Assignment: round-robin distribution; a lead edited after preview is skipped (partial result); invalid users are rejected.
- Demo provider: Persian number words, «فردا ساعت ده» → tomorrow at 10:00, clarifying question when the document or date is missing, period and branch detection, assignment requires a selection.

## Manual in a browser (headless Chromium at 1440×900 and 390×844)

| Check | Result | Screenshot |
| --- | --- | --- |
| Assets load (`app_include_css/js`), RTL, Vazirmatn font, real logo on the dock | ✓ | `dashboard.png` |
| «فروش» (Selling) workspace, Customer list, Sales Invoice list and form with item table | ✓ standard behaviour, theme applied | `workspace-selling.png`, `list-customer.png`, `before-sales-invoice.png` |
| Dashboard: live figures, period and branch filters, «نمونه» badge, empty and forbidden states | ✓ | `dashboard.png` |
| Assistant on a Sales Invoice: context shows the document; summary with Jalali dates and items | ✓ | `form-sales-invoice-assistant.png` |
| Follow-up on a Lead: preview → confirm → a real ToDo created | ✓ | `lead-followup-confirmed.png` |
| Selecting 4 rows in the Lead list → assistant splits them between two experts (preview) | ✓ | `lead-list-assignment-preview.png` |
| Demo voice loop: listening state, partial text, stop/cancel controls | ✓ | `voice-demo-listening.png` |
| Assignment page: sources, experts, preview with duplicates, unavailable channels labelled | ✓ | `assignment-step1.png`, `assignment-step3.png` |
| Phone width: no horizontal scroll, closed drawer hidden, form reflows | ✓ after fixing the drawer background | `mobile.png` |

## Not checked or out of scope

- A real microphone and the browser Web Speech API (headless has no microphone; real use needs HTTPS).
- A real voice service or LLM: none is connected; the agent is the labelled demo.
- Production image build and server deployment (needs the app's Git repository URL, a registry and a server).
- Full regression of every ERPNext DocType under the theme: only the screens above were checked. Submit, cancel, print and attachment were not exercised end to end in the browser; the theme touches only tokens and appearance, not their behaviour.
- Dark mode: only the accent changes; it was not reviewed visually.
- Jalali dates in standard ERPNext forms and lists: not implemented (Gregorian), to avoid diverging from the date picker and from storage.
