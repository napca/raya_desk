"""Data endpoints for the Raya dashboard and lead assignment pages."""

import frappe
from frappe import _

from raya_desk.api import metrics
from raya_desk.assistant.actions import CLOSED_LEAD_STATUSES, get_assignable_users

NO_SOURCE = "__none__"
MAX_SOURCE_LEADS = 200


@frappe.whitelist()
def get_dashboard(period: str = "month", branch: str | None = None):
	return metrics.get_dashboard(period, branch)


@frappe.whitelist()
def get_filters():
	return {
		"branches": frappe.get_list("Branch", pluck="name", order_by="name asc"),
		"periods": [{"value": k, "label": v} for k, v in metrics.PERIOD_LABELS.items()],
	}


def _source_filters(branch, only_unassigned):
	filters = [["status", "not in", CLOSED_LEAD_STATUSES]]
	if only_unassigned:
		filters.append(["lead_owner", "is", "not set"])
	if branch:
		filters.append(["raya_branch", "=", branch])
	return filters


@frappe.whitelist()
def get_assignment_sources(branch: str | None = None, only_unassigned: int = 1):
	if not frappe.has_permission("Lead", "read"):
		raise frappe.PermissionError(_("You cannot read leads"))
	metrics.validate_branch(branch)
	rows = frappe.get_list(
		"Lead",
		filters=_source_filters(branch, int(only_unassigned)),
		fields=["utm_source", {"COUNT": "*", "as": "count"}],
		group_by="utm_source",
		order_by="count desc",
	)
	return {
		"sources": [
			{"source": r.utm_source or NO_SOURCE, "label": r.utm_source or _("No source"), "count": r.count}
			for r in rows
		],
		"users": get_assignable_users(),
		"can_assign": bool(frappe.has_permission("Lead", "write")),
		"branches": frappe.get_list("Branch", pluck="name", order_by="name asc"),
	}


@frappe.whitelist()
def get_source_leads(sources: str | list, branch: str | None = None, only_unassigned: int = 1):
	sources = frappe.parse_json(sources) if isinstance(sources, str) else sources
	if not isinstance(sources, list) or not sources:
		frappe.throw(_("Select at least one source"))
	metrics.validate_branch(branch)
	filters = _source_filters(branch, int(only_unassigned))
	named = [s for s in sources if s != NO_SOURCE]
	or_filters = []
	if named:
		or_filters.append(["utm_source", "in", named])
	if NO_SOURCE in sources:
		or_filters.append(["utm_source", "is", "not set"])
	leads = frappe.get_list(
		"Lead",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "lead_name", "utm_source", "status", "lead_owner", "creation"],
		order_by="creation asc",
		limit_page_length=MAX_SOURCE_LEADS + 1,
	)
	return {"leads": leads[:MAX_SOURCE_LEADS], "truncated": len(leads) > MAX_SOURCE_LEADS, "limit": MAX_SOURCE_LEADS}
