"""Metric definitions shared by the dashboard page, the assistant and the docs.

Every query goes through frappe.get_list so role and user permissions apply. A metric the user may
not read comes back as {"permitted": False} instead of a number.
"""

from collections import OrderedDict
from datetime import timedelta

import frappe
from frappe.utils import add_days, flt, get_datetime, getdate, nowdate

from raya_desk.utils.dates import PERIOD_LABELS, PERIODS, get_period_range, get_previous_range, to_jalali

ACTIVE_LEAD_STATUSES = ("Lead", "Open", "Replied", "Interested")
FOLLOWUP_REFERENCE_DOCTYPES = ("Lead", "Opportunity", "Customer")
# Doctypes that received the raya_branch custom field in install.py
BRANCH_DOCTYPES = ("Lead", "Opportunity", "Sales Invoice", "Contract")


def validate_period(period):
	if period not in PERIODS:
		frappe.throw(frappe._("Invalid period"), frappe.ValidationError)
	return period


def validate_branch(branch):
	if branch and not frappe.db.exists("Branch", branch):
		frappe.throw(frappe._("Branch {0} not found").format(branch), frappe.DoesNotExistError)
	return branch or None


def _date_filters(fieldname, start, end, datetime_field=True):
	if start is None:
		return [[fieldname, "<=", f"{end} 23:59:59.999999" if datetime_field else end]]
	if datetime_field:
		return [[fieldname, "between", [f"{start} 00:00:00", f"{end} 23:59:59.999999"]]]
	return [[fieldname, "between", [start, end]]]


def _branch_filters(doctype, branch):
	return [[doctype, "raya_branch", "=", branch]] if branch and doctype in BRANCH_DOCTYPES else []


def _count(doctype, filters):
	if not frappe.has_permission(doctype, "read"):
		return {"permitted": False}
	rows = frappe.get_list(doctype, filters=filters, fields=[{"COUNT": "*", "as": "count"}])
	return {"permitted": True, "value": rows[0].count if rows else 0}


def _metric(doctype, date_field, start, end, branch, extra=None, datetime_field=True):
	filters = _date_filters(date_field, start, end, datetime_field) + _branch_filters(doctype, branch)
	result = _count(doctype, filters + (extra or []))
	result["branch_applied"] = not branch or doctype in BRANCH_DOCTYPES
	return result


def get_funnel(start, end, branch=None):
	return OrderedDict(
		leads_in=_metric("Lead", "creation", start, end, branch),
		leads_assigned=_metric("Lead", "creation", start, end, branch, [["lead_owner", "is", "set"]]),
		calls=_metric("Call Log", "creation", start, end, branch),
		followups=_metric(
			"ToDo",
			"creation",
			start,
			end,
			branch,
			[["reference_type", "in", FOLLOWUP_REFERENCE_DOCTYPES]],
		),
		contracts=_metric("Contract", "creation", start, end, branch),
	)


def get_sales_totals(start, end, branch=None):
	if not frappe.has_permission("Sales Invoice", "read"):
		return {"permitted": False}
	filters = (
		[["docstatus", "=", 1], ["is_return", "=", 0]]
		+ _date_filters("posting_date", start, end, datetime_field=False)
		+ _branch_filters("Sales Invoice", branch)
	)
	row = frappe.get_list(
		"Sales Invoice",
		filters=filters,
		fields=[{"COUNT": "*", "as": "count"}, {"SUM": "base_grand_total", "as": "total"}],
	)[0]
	return {"permitted": True, "count": row.count or 0, "total": flt(row.total)}


def _change(current, previous):
	if not previous:
		return None
	return round((current - previous) * 100.0 / previous, 1)


def get_sales_summary(period, branch=None):
	start, end = get_period_range(period)
	current = get_sales_totals(start, end, branch)
	summary = {"current": current, "previous": None, "count_change": None, "total_change": None}
	prev_range = get_previous_range(period)
	if current.get("permitted") and prev_range:
		previous = get_sales_totals(*prev_range, branch)
		summary["previous"] = previous
		summary["count_change"] = _change(current["count"], previous["count"])
		summary["total_change"] = _change(current["total"], previous["total"])
	summary["currency"] = frappe.db.get_default("currency")
	return summary


def _bucket_key(d, by_month):
	jy, jm, jd = to_jalali(d)
	return f"{jy}/{jm:02d}" if by_month else f"{jy}/{jm:02d}/{jd:02d}"


def get_trend(period, branch=None, max_rows=5000):
	"""Leads and invoiced amount per Jalali day, or per Jalali month beyond 62 days."""
	start, end = get_period_range(period)
	if start is None:
		start = end - timedelta(days=365)
	by_month = (end - start).days > 62

	buckets = OrderedDict()
	d = start
	while d <= end:
		buckets.setdefault(_bucket_key(d, by_month), {"leads": 0, "sales": 0.0})
		d += timedelta(days=1)

	trend = {"labels": list(buckets), "by_month": by_month, "leads": None, "sales": None}

	if frappe.has_permission("Lead", "read"):
		for row in frappe.get_list(
			"Lead",
			filters=_date_filters("creation", start, end) + _branch_filters("Lead", branch),
			fields=["creation"],
			limit_page_length=max_rows,
			order_by="creation asc",
		):
			buckets[_bucket_key(getdate(row.creation), by_month)]["leads"] += 1
		trend["leads"] = [b["leads"] for b in buckets.values()]

	if frappe.has_permission("Sales Invoice", "read"):
		for row in frappe.get_list(
			"Sales Invoice",
			filters=[["docstatus", "=", 1], ["is_return", "=", 0]]
			+ _date_filters("posting_date", start, end, datetime_field=False)
			+ _branch_filters("Sales Invoice", branch),
			fields=["posting_date", "base_grand_total"],
			limit_page_length=max_rows,
			order_by="posting_date asc",
		):
			buckets[_bucket_key(getdate(row.posting_date), by_month)]["sales"] += flt(row.base_grand_total)
		trend["sales"] = [b["sales"] for b in buckets.values()]

	return trend


def get_sales_by_branch(period):
	if not frappe.has_permission("Sales Invoice", "read"):
		return {"permitted": False}
	start, end = get_period_range(period)
	rows = frappe.get_list(
		"Sales Invoice",
		filters=[["docstatus", "=", 1], ["is_return", "=", 0]]
		+ _date_filters("posting_date", start, end, datetime_field=False),
		fields=["raya_branch", {"COUNT": "*", "as": "count"}, {"SUM": "base_grand_total", "as": "total"}],
		group_by="raya_branch",
		order_by="total desc",
	)
	return {
		"permitted": True,
		"rows": [{"branch": r.raya_branch, "count": r.count, "total": flt(r.total)} for r in rows],
	}


def get_my_tasks(limit=10):
	"""Open ToDos of the current user due today or overdue."""
	return frappe.get_list(
		"ToDo",
		filters=[
			["allocated_to", "=", frappe.session.user],
			["status", "=", "Open"],
			["date", "<=", nowdate()],
		],
		fields=["name", "description", "date", "priority", "reference_type", "reference_name"],
		order_by="date asc, creation asc",
		limit_page_length=limit,
	)


def get_stale_leads(days=3, branch=None, limit=50, candidate_limit=500):
	"""Active leads with no activity in the last `days` days and no open follow-up due from today on.

	Activity is the latest of: the lead's creation, a Communication, a Comment or a ToDo referencing
	it, or a Call Log linked to it.
	"""
	if not frappe.has_permission("Lead", "read"):
		return {"permitted": False}

	days = int(days)
	cutoff = get_datetime(add_days(nowdate(), -days))
	candidates = frappe.get_list(
		"Lead",
		filters=[
			["status", "in", ACTIVE_LEAD_STATUSES],
			["creation", "<", cutoff],
		]
		+ _branch_filters("Lead", branch),
		fields=["name", "lead_name", "company_name", "status", "lead_owner", "creation", "utm_source"],
		order_by="creation asc",
		limit_page_length=candidate_limit,
	)
	if not candidates:
		return {"permitted": True, "days": days, "rows": [], "truncated": False}

	names = [c.name for c in candidates]
	last_activity = {c.name: get_datetime(c.creation) for c in candidates}

	def bump(rows, name_key, ts_key="ts"):
		for r in rows:
			ts = get_datetime(r[ts_key])
			if ts and ts > last_activity[r[name_key]]:
				last_activity[r[name_key]] = ts

	# Timestamps only; the rows themselves never leave this function
	bump(
		frappe.get_all(
			"Communication",
			filters={"reference_doctype": "Lead", "reference_name": ("in", names)},
			fields=["reference_name", {"MAX": "creation", "as": "ts"}],
			group_by="reference_name",
		),
		"reference_name",
	)
	bump(
		frappe.get_all(
			"Comment",
			filters={
				"reference_doctype": "Lead",
				"reference_name": ("in", names),
				"comment_type": ("in", ["Comment", "Info"]),
			},
			fields=["reference_name", {"MAX": "creation", "as": "ts"}],
			group_by="reference_name",
		),
		"reference_name",
	)
	bump(
		frappe.get_all(
			"ToDo",
			filters={"reference_type": "Lead", "reference_name": ("in", names)},
			fields=["reference_name", {"MAX": "modified", "as": "ts"}],
			group_by="reference_name",
		),
		"reference_name",
	)
	bump(
		frappe.get_all(
			"Dynamic Link",
			filters={"parenttype": "Call Log", "link_doctype": "Lead", "link_name": ("in", names)},
			fields=["link_name", {"MAX": "creation", "as": "ts"}],
			group_by="link_name",
		),
		"link_name",
	)

	scheduled = set(
		frappe.get_all(
			"ToDo",
			filters={
				"reference_type": "Lead",
				"reference_name": ("in", names),
				"status": "Open",
				"date": (">=", nowdate()),
			},
			pluck="reference_name",
		)
	)

	rows = []
	for c in candidates:
		if c.name in scheduled or last_activity[c.name] >= cutoff:
			continue
		c.last_activity = last_activity[c.name]
		c.idle_days = (get_datetime() - c.last_activity).days
		rows.append(c)

	rows.sort(key=lambda r: r.last_activity)
	return {
		"permitted": True,
		"days": days,
		"rows": rows[:limit],
		"total": len(rows),
		"truncated": len(candidates) >= candidate_limit,
	}


def get_dashboard(period="month", branch=None):
	validate_period(period)
	branch = validate_branch(branch)
	start, end = get_period_range(period)
	return {
		"period": period,
		"period_label": PERIOD_LABELS[period],
		"from_date": start,
		"to_date": end,
		"branch": branch,
		"funnel": get_funnel(start, end, branch),
		"sales": get_sales_summary(period, branch),
		"trend": get_trend(period, branch),
		"sales_by_branch": get_sales_by_branch(period),
		"tasks": get_my_tasks(),
		"stale_leads": get_stale_leads(3, branch, limit=8),
	}
