# Additional Desk fixes — 2026-11-08

This pass extends the local `raya_desk` app. ERPNext and Frappe core source files are unchanged. See also [the first UI pass](ui-refresh.md).

## Changes

- Shared permission-aware navigation across modules, using native routes for customers and leads. The assistant launcher now lives in the toolbar instead of covering page content.
- At 1280px and above, the assistant reserves a 384px area. Below that breakpoint it becomes an explicit modal, with a backdrop, focus containment and an inert background. Closing restores background interaction. Resizing switches between those modes.
- Form columns adapt to the available content width. Document metadata can be expanded with “اطلاعات سند”; it starts collapsed on narrower screens and when the assistant is docked.
- Suggestions follow the current document, list selection and read/write permissions. Unsaved documents and unsupported reports do not advertise unavailable operations. Route and selection changes invalidate pending context; in-flight interpretation is cancelled when its context changes.
- Persian Date displays have a Jalali label. Editable Date fields retain native Gregorian input/parsing and explicitly show their Jalali equivalent below. Fixed-height report cells show one line, with the Gregorian equivalent in the title tooltip. This does not implement a Jalali input calendar or change storage, sorting, exports or financial values. Datetime controls retain native behavior.
- Dark surfaces use the host theme's text, border and card palette. More visible user-menu and appearance-setting strings are translated.
- Small-screen report tables scroll within their own area. Horizontal pinning is visually released below 768px so pinned columns cannot obscure the entire phone viewport. Native report/table data remains intact.

## Verification

- Production asset build completed, including RTL and translations. Existing Browserslist age warning remains nonblocking.
- All 20 existing backend integration tests passed on `raya.localhost`.
- All 6 new frontend tests passed using Node in the development container: document/list suggestions, permissions, unsupported reports, and strict ISO date validation.
- Translation CSV has valid column counts and no duplicate translation/context keys. `git diff --check` passed.
- Browser review used actual local development sample data at 1440×1000 and 390×844. Checked invoice date hints, dock bounds, mobile modal/inert restoration, document metadata, Lead selection-dependent suggestions, Lead form context, unsupported General Ledger suggestions, report date height, and both light/dark appearance. The original Light appearance was restored.
- On the desktop invoice, the dock ended at x=372 and content began at x=384. On mobile, the modal filled 390×844; after closing, the document width remained 390px. Report dates now fit inside fixed-height cells.

Screenshots are in [screenshots/ui-polish](screenshots/ui-polish/). These are browser captures, not generated mockups.

## Delivery scope

Changes are built on the local development site at port 8000. They have not been committed, pushed, packaged into a release image or deployed to staging/production. The app is a separate nested Git repository under the development bench; the outer Docker repository ignores that directory.

Real microphone/STT and LLM providers remain unconnected. Native Gregorian calendar internals, all ERPNext DocTypes, every report and financial workflows have not been fully exercised. No financial documents were submitted during visual verification. A full translation of upstream ERPNext is outside this pass.
