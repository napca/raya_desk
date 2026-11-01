# Data mapping

Before adding any model, each concept from the mockups was mapped to an existing ERPNext v16 DocType.
Only one gap needed a schema change: **branch**.

| Concept (mockup) | ERPNext | Notes |
| --- | --- | --- |
| Lead | `Lead` | |
| Lead source | `Lead.utm_source` → `UTM Source` | v16 replaced the old `source` field with UTM fields |
| Expert / assignee | `Lead.lead_owner` (User) + an assignment (`ToDo` via `assign_to`) | `lead_owner` defaults to the creating user |
| Branch | `Branch` + custom field `raya_branch` | Added by `install.py` to Lead, Opportunity, Sales Invoice and Contract |
| Customer | `Customer` | |
| Opportunity | `Opportunity` | |
| Call | `Call Log` (links to Lead through `Dynamic Link`) | Has no branch, so the branch filter does not apply |
| Follow-up | `ToDo` with `reference_type` ∈ {Lead, Opportunity, Customer} | Has no time field; the time and time zone go in the description |
| Contract | `Contract` | |
| Sales | `Sales Invoice` with `docstatus = 1` and `is_return = 0` | Amount = `base_grand_total` (company currency) |

## Metric definitions (`raya_desk/api/metrics.py`)

All queries go through `frappe.get_list`, so role and user permissions apply. A metric the user may
not read comes back as `{"permitted": false}`, and the UI shows «دسترسی ندارید» instead of zero.

| Metric | Definition |
| --- | --- |
| Incoming leads | Leads with `creation` in the period (and branch) |
| Assigned | Of those, leads with `lead_owner` set |
| Calls | Call Logs with `creation` in the period (no branch filter) |
| Follow-ups | ToDos on a Lead, Opportunity or Customer with `creation` in the period (no branch filter) |
| Contracts | Contracts with `creation` in the period (and branch) |
| Invoice count / sales amount | Submitted non-return Sales Invoices with `posting_date` in the period |
| Change vs. previous period | Same-length window immediately before; no comparison for «همه» (all) |
| Average invoice | Sales amount ÷ invoice count |
| Trend | Leads and sales per Jalali day; per Jalali month for windows over 62 days |
| My tasks today | Open ToDos of the current user with `date ≤ today` |
| Leads needing follow-up | Active leads (Lead, Open, Replied, Interested) whose latest activity (creation, Communication, Comment, ToDo or linked Call Log) is older than N days and that have no open ToDo dated today or later. The 500 oldest candidates are checked |

## Periods and time zone

Boundaries are computed on the server in the system time zone (`Asia/Tehran` on this site):

- `today`: today
- `week`: the last 7 days including today
- `month`: from the 1st of the current **Jalali** month
- `6months`: the last 182 days
- `year`: from 1 Farvardin of the current Jalali year
- `all`: no lower bound

Storage is unchanged: ERPNext stores Gregorian dates and datetimes in the system time zone. Jalali
conversion (`raya_desk/utils/dates.py`, covered by tests) is used only for period boundaries and
display.

## Assignment

- **Sources:** leads not in `Converted` or `Do Not Contact`, optionally only those with an empty `lead_owner`, grouped by `utm_source`.
- **Plan:** round-robin over the selected leads in creation order.
- **Duplicates:** leads that share a mobile number, phone or email inside the batch, or with another Lead.
- **Execution:** each lead in its own savepoint. A lead that changed after the preview (different `modified`) is skipped and reported, not overwritten.
- **Limit:** at most 200 leads per run.
