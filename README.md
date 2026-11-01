# Raya Desk

Raya Faraz theme and a contextual assistant built into ERPNext Desk. This is not a separate CRM:
lists, forms, reports and permissions are the real ERPNext/Frappe ones. The app adds:

- **Theme** using Frappe's own design tokens (Vazirmatn font, navy shell, teal accent, 14px cards, RTL), plus the real Raya Faraz logo on the dock and the apps screen.
- **Desk pages:** «داشبورد رایا» (`/desk/raya-dashboard`) and «تخصیص لید» (`/desk/raya-lead-assignment`), plus the «رایا» workspace.
- **Global assistant** with typed and voice input. It knows the current route, the open document and the rows selected in a list. Write actions only run after a preview and explicit confirmation.
- **Server-side action registry** with schema, permissions, single-use confirmation and an audit log (`Raya Assistant Log`).

Compatibility: Frappe 16.54 and ERPNext 16.53 (`version-16`); Python 3.14.

## Install

```bash
bench get-app <URL of this repo> --branch main
bench --site <site> install-app raya_desk   # also creates the raya_branch custom field and the default settings
bench build --app raya_desk
```

For the full Docker setup (development and production) see `deploy/raya/README.fa.md` in frappe_docker.

## Turning it off for troubleshooting

- Site-wide: in **Raya Desk Settings**, uncheck «فعال‌سازی پوسته رایا» or «فعال‌سازی دستیار».
- For one user in one browser: append `?raya=off` to any URL (back on with `?raya=on`), or use the «خاموش کردن پوسته و دستیار» link in the assistant panel.

## What is live and what is a demo

| Part | Status |
| --- | --- |
| Theme, workspace, standard lists/forms/reports | Live, on real ERPNext |
| Dashboard figures, trend, branch performance, my tasks, leads needing follow-up | Live queries with user permissions ([definitions](docs/data-mapping.md)) |
| Lead assignment (preview, duplicate detection, confirm, partial result) | Live: sets `Lead Owner` and adds an assignment |
| Assistant actions (read and write) | Live, run on the server through the registry |
| Request interpretation (agent) | **Demo**: Persian keyword rules (`MockAgentProvider`), labelled «نمایشی» in the UI |
| Speech-to-text | **Demo** by default (simulated, no microphone); browser Web Speech API selectable in settings |
| Text-to-speech | The browser's `speechSynthesis`, only if the user turns it on |
| OCR and Instagram on the assignment page | Not implemented; shown as «در دسترس نیست» |
| Jalali dates | On Raya pages and in the assistant. Standard ERPNext forms and lists still show Gregorian dates |

To connect a real voice service or agent, see [docs/assistant.md](docs/assistant.md#connecting-a-real-service).

## Development

```bash
bench --site raya.localhost execute raya_desk.dev.seed.run     # sample data (developer_mode only), tagged "Raya Sample"
bench --site raya.localhost execute raya_desk.dev.seed.clear   # removes it
bench --site raya.localhost set-config allow_tests true
bench --site raya.localhost run-tests --app raya_desk
```

Sample users (password `raya-dev-123`, development only): `sara@raya.localhost` and `reza@raya.localhost` (Sales User), `manager@raya.localhost` (Sales Manager), `viewer@raya.localhost` (Accounts User, for permission-denial tests).

Structure:

```text
raya_desk/
├── hooks.py                 # app_include_css/js, boot, apps screen, logo
├── boot.py                  # settings and brand → frappe.boot.raya_desk
├── install.py               # raya_branch custom field, default settings
├── api/metrics.py           # metric definitions (dashboard + assistant)
├── api/dashboard.py         # page endpoints
├── assistant/registry.py    # action contract, schema validation
├── assistant/actions.py     # actions mapped to DocTypes
├── assistant/executor.py    # preview / confirm / cancel with locking and log
├── assistant/providers.py   # agent providers (currently mock)
├── assistant/api.py         # whitelisted, rate-limited endpoints
├── raya_desk/page/          # Desk pages
├── raya_desk/workspace/     # «رایا» workspace
├── raya_desk/doctype/       # Raya Desk Settings, Raya Assistant Log
├── public/css/raya_desk.bundle.css
├── public/js/raya/          # core, ui, assistant (machine, adapters, context, panel)
└── tests/test_assistant.py
```

Docs: [data mapping](docs/data-mapping.md) · [assistant and adapters](docs/assistant.md) · [verification results](docs/verification.md)

Fonts: Vazirmatn under the SIL Open Font License, hosted locally (`public/fonts/vazirmatn/OFL.txt`).
