"""Assistant actions mapped onto real ERPNext documents. See docs/assistant.md for the contract."""

from collections import Counter

import frappe
from frappe import _
from urllib.parse import urlencode

from frappe.utils import flt, get_fullname, getdate, nowdate

from raya_desk.api import metrics
from raya_desk.assistant.registry import Action, Param, register
from raya_desk.utils.dates import PERIOD_LABELS, PERIODS, format_jalali

FOLLOWUP_DOCTYPES = ("Lead", "Opportunity", "Customer")
CLOSED_LEAD_STATUSES = ("Converted", "Do Not Contact")
SUMMARY_FIELDTYPES = {
	"Data",
	"Select",
	"Link",
	"Date",
	"Datetime",
	"Currency",
	"Float",
	"Int",
	"Percent",
	"Check",
	"Dynamic Link",
}
INVOICE_ITEM_PREVIEW = 5


def _require(doctype, ptype="read", doc=None):
	if not frappe.has_permission(doctype, ptype, doc=doc):
		raise frappe.PermissionError(_("You do not have {0} permission on {1}").format(_(ptype), _(doctype)))


def _link(doctype, name):
	return f"/desk/{frappe.scrub(doctype).replace('_', '-')}/{name}"


# ---------------------------------------------------------------- read actions


def dashboard_metrics(params):
	data = metrics.get_dashboard(params["period"], params.get("branch"))
	return {"type": "dashboard", "data": data, "link": "/desk/raya-dashboard"}


register(
	Action(
		name="get_dashboard_metrics",
		label="آمار داشبورد",
		kind="read",
		params={
			"period": Param("str", choices=PERIODS, default="month", label="بازه"),
			"branch": Param("docname", label="شعبه"),
		},
		handler=dashboard_metrics,
		description="Funnel, sales and tasks for a period, optionally for one Branch",
		examples=("آمار این ماه را نشان بده",),
	)
)


def stale_leads(params):
	data = metrics.get_stale_leads(params["days"], params.get("branch"), limit=params["limit"])
	if not data.get("permitted"):
		raise frappe.PermissionError(_("You cannot read leads"))
	for row in data["rows"]:
		row["link"] = _link("Lead", row.name)
	return {
		"type": "table",
		"doctype": "Lead",
		"definition": _(
			"Active leads (status Lead, Open, Replied or Interested) with no communication, comment, "
			"call or to-do in the last {0} days and no open follow-up scheduled from today on"
		).format(data["days"]),
		"data": data,
		"link": "/desk/lead?status=" + "%2C".join(metrics.ACTIVE_LEAD_STATUSES),
	}


register(
	Action(
		name="search_stale_leads",
		label="لیدهای بدون پیگیری",
		kind="read",
		params={
			"days": Param("int", min=1, max=365, default=3, label="روز"),
			"branch": Param("docname", label="شعبه"),
			"limit": Param("int", min=1, max=100, default=20),
		},
		handler=stale_leads,
		check_permission=lambda p: _require("Lead"),
		description="Leads that were not followed up for N days",
		examples=("لیدهایی که سه روز پیگیری نشده‌اند را بیاور",),
	)
)


def sales_report(params):
	period, branch = params["period"], params.get("branch")
	return {
		"type": "sales",
		"data": {
			"period": period,
			"period_label": PERIOD_LABELS[period],
			"branch": branch,
			"summary": metrics.get_sales_summary(period, branch),
			"trend": metrics.get_trend(period, branch),
			"by_branch": metrics.get_sales_by_branch(period),
		},
		"link": "/desk/raya-dashboard?" + urlencode({"period": period, "branch": branch or ""}),
		"filters": {"period": period, "branch": branch},
	}


register(
	Action(
		name="get_sales_report",
		label="گزارش فروش",
		kind="read",
		params={
			"period": Param("str", choices=PERIODS, default="month", label="بازه"),
			"branch": Param("docname", label="شعبه"),
		},
		handler=sales_report,
		check_permission=lambda p: _require("Sales Invoice"),
		description="Submitted Sales Invoices (excluding returns) for a period and Branch",
		examples=("فروش این ماه شعبه سعادت‌آباد را نشان بده",),
	)
)


def _doc_summary(doc):
	meta = frappe.get_meta(doc.doctype)
	fields = []
	for df in meta.fields:
		if df.fieldtype not in SUMMARY_FIELDTYPES or df.hidden or df.permlevel:
			continue
		if not (df.in_list_view or df.bold or df.in_standard_filter or df.fieldname in ("status", "grand_total")):
			continue
		value = doc.get(df.fieldname)
		if value in (None, "", 0) and df.fieldtype != "Check":
			continue
		fields.append({"label": _(df.label), "fieldname": df.fieldname, "value": frappe.format(value, df, doc=doc)})
	return fields


def explain_document(params):
	doctype, name = params["doctype"], params["name"]
	doc = frappe.get_doc(doctype, name)
	doc.check_permission("read")
	result = {
		"type": "document",
		"doctype": doctype,
		"name": name,
		"title": doc.get_title(),
		"docstatus": doc.docstatus,
		"fields": _doc_summary(doc),
		"link": _link(doctype, name),
	}
	if doctype == "Sales Invoice":
		result["invoice"] = {
			"customer": doc.customer_name,
			"posting_date": str(doc.posting_date),
			"due_date": str(doc.due_date) if doc.due_date else None,
			"status": doc.status,
			"grand_total": frappe.format(doc.grand_total, {"fieldtype": "Currency", "options": "currency"}, doc=doc),
			"outstanding": frappe.format(
				doc.outstanding_amount, {"fieldtype": "Currency", "options": "currency"}, doc=doc
			),
			"items_count": len(doc.items),
			"items": [
				{"item": i.item_name, "qty": flt(i.qty), "amount": frappe.format(i.amount, {"fieldtype": "Currency"})}
				for i in doc.items[:INVOICE_ITEM_PREVIEW]
			],
			"is_overdue": bool(
				doc.docstatus == 1 and flt(doc.outstanding_amount) > 0 and doc.due_date and getdate(doc.due_date) < getdate()
			),
		}
	return result


register(
	Action(
		name="explain_document",
		label="توضیح سند",
		kind="read",
		params={
			"doctype": Param("doctype", required=True),
			"name": Param("docname", required=True),
		},
		handler=explain_document,
		check_permission=lambda p: _require(p["doctype"], doc=p["name"]),
		reference=lambda p: (p["doctype"], p["name"]),
		description="Summarise the open document using fields the user can read",
		examples=("این فاکتور را توضیح بده",),
	)
)


def summarize_selection(params):
	doctype, names = params["doctype"], params["names"]
	meta = frappe.get_meta(doctype)
	fields = ["name"] + [f for f in ("status", "owner") if f == "owner" or meta.has_field(f)]
	rows = frappe.get_list(doctype, filters={"name": ("in", names)}, fields=fields, limit_page_length=len(names))
	return {
		"type": "selection",
		"doctype": doctype,
		"count": len(rows),
		"hidden": len(names) - len(rows),
		"by_status": dict(Counter(r.get("status") or "-" for r in rows)) if meta.has_field("status") else None,
		"names": [r.name for r in rows],
	}


register(
	Action(
		name="summarize_selection",
		label="خلاصه ردیف‌های انتخاب‌شده",
		kind="read",
		params={
			"doctype": Param("doctype", required=True),
			"names": Param("list", required=True, max_items=200),
		},
		handler=summarize_selection,
		check_permission=lambda p: _require(p["doctype"]),
		description="Counts and statuses of the rows selected in the list view",
	)
)


# --------------------------------------------------------------- write actions


def _followup_check(params):
	if params["reference_doctype"] not in FOLLOWUP_DOCTYPES:
		frappe.throw(_("Follow-ups can only be added to {0}").format(", ".join(FOLLOWUP_DOCTYPES)))
	_require(params["reference_doctype"], "read", doc=params["reference_name"])
	_require("ToDo", "create")
	if getdate(params["date"]) < getdate(nowdate()):
		frappe.throw(_("Follow-up date is in the past"))


def _followup_description(params, title):
	time_note = f" — ساعت {params['time']} ({frappe.utils.get_system_timezone()})" if params.get("time") else ""
	note = params.get("note") or f"پیگیری {title}"
	return f"{note}{time_note}"


def followup_preview(params):
	title = frappe.get_doc(params["reference_doctype"], params["reference_name"]).get_title()
	return {
		"summary": _("Create a follow-up for {0} {1}").format(_(params["reference_doctype"]), title),
		"changes": [
			{"label": "نوع سند", "value": "ToDo"},
			{"label": "برای", "value": f"{_(params['reference_doctype'])}: {title}"},
			{"label": "تاریخ", "value": f"{format_jalali(params['date'])} ({params['date']})"},
			{"label": "ساعت", "value": params.get("time") or "—"},
			{"label": "منطقه زمانی", "value": frappe.utils.get_system_timezone()},
			{"label": "مسئول", "value": get_fullname(frappe.session.user)},
			{"label": "شرح", "value": _followup_description(params, title)},
		],
		"count": 1,
	}


def create_followup(params, preview=None):
	title = frappe.get_doc(params["reference_doctype"], params["reference_name"]).get_title()
	todo = frappe.get_doc(
		{
			"doctype": "ToDo",
			"allocated_to": frappe.session.user,
			"assigned_by": frappe.session.user,
			"reference_type": params["reference_doctype"],
			"reference_name": params["reference_name"],
			"date": params["date"],
			"priority": "Medium",
			"description": _followup_description(params, title),
		}
	).insert()
	return {
		"status": "Executed",
		"message": _("Follow-up {0} created").format(todo.name),
		"records": [{"doctype": "ToDo", "name": todo.name, "link": _link("ToDo", todo.name)}],
	}


register(
	Action(
		name="create_followup",
		label="ثبت پیگیری",
		kind="write",
		params={
			"reference_doctype": Param("doctype", required=True, choices=FOLLOWUP_DOCTYPES),
			"reference_name": Param("docname", required=True),
			"date": Param("date", required=True, label="تاریخ"),
			"time": Param("time", label="ساعت"),
			"note": Param("str", max=500, label="شرح"),
		},
		handler=create_followup,
		check_permission=_followup_check,
		preview=followup_preview,
		reference=lambda p: (p["reference_doctype"], p["reference_name"]),
		description="Create a ToDo follow-up on a Lead, Opportunity or Customer for the current user",
		examples=("برای این لید فردا ساعت ده پیگیری ثبت کن",),
	)
)


def _assignable_users(users):
	valid = frappe.get_all(
		"User",
		filters={"name": ("in", users), "enabled": 1, "user_type": "System User"},
		pluck="name",
	)
	missing = set(users) - set(valid)
	if missing:
		frappe.throw(_("These users cannot receive leads: {0}").format(", ".join(sorted(missing))))
	return users


def _assign_check(params):
	_require("Lead", "write")
	_assignable_users(params["users"])
	if params.get("branch") and not frappe.db.exists("Branch", params["branch"]):
		frappe.throw(_("Branch {0} not found").format(params["branch"]))


def _assignment_plan(params):
	leads = frappe.get_list(
		"Lead",
		filters={"name": ("in", params["leads"])},
		fields=["name", "lead_name", "status", "lead_owner", "mobile_no", "phone", "email_id", "modified"],
		limit_page_length=len(params["leads"]),
	)
	visible = {lead.name: lead for lead in leads}
	skipped = [{"name": n, "reason": "not found or no permission"} for n in params["leads"] if n not in visible]

	eligible = []
	for name in params["leads"]:
		lead = visible.get(name)
		if not lead:
			continue
		if lead.status in CLOSED_LEAD_STATUSES:
			skipped.append({"name": name, "reason": f"status {lead.status}"})
		elif not frappe.has_permission("Lead", "write", doc=name):
			skipped.append({"name": name, "reason": "no write permission"})
		else:
			eligible.append(lead)

	# Duplicates by contact detail, within the batch and against other leads
	contacts = Counter()
	for lead in eligible:
		for value in {lead.mobile_no, lead.phone, lead.email_id} - {None, ""}:
			contacts[value] += 1
	duplicates = []
	for lead in eligible:
		keys = {lead.mobile_no, lead.phone, lead.email_id} - {None, ""}
		if any(contacts[k] > 1 for k in keys):
			duplicates.append(lead.name)
			continue
		for fieldname, value in (("mobile_no", lead.mobile_no), ("email_id", lead.email_id)):
			if value and frappe.db.exists("Lead", {fieldname: value, "name": ("!=", lead.name)}):
				duplicates.append(lead.name)
				break

	users = params["users"]
	plan = [
		{
			"lead": lead.name,
			"lead_name": lead.lead_name,
			"current_owner": lead.lead_owner,
			"user": users[i % len(users)],
			"modified": str(lead.modified),
			"duplicate": lead.name in duplicates,
		}
		for i, lead in enumerate(eligible)
	]
	return plan, skipped


def assign_preview(params):
	plan, skipped = _assignment_plan(params)
	per_user = Counter(p["user"] for p in plan)
	reassigned = sum(1 for p in plan if p["current_owner"] and p["current_owner"] != p["user"])
	return {
		"summary": _("Assign {0} leads between {1} users").format(len(plan), len(params["users"])),
		"changes": [
			{"label": get_fullname(u), "value": f"{per_user.get(u, 0)} لید"} for u in params["users"]
		]
		+ ([{"label": "شعبه", "value": params["branch"]}] if params.get("branch") else [])
		+ ([{"label": "تغییر مسئول قبلی", "value": f"{reassigned} لید"}] if reassigned else []),
		"count": len(plan),
		"plan": plan,
		"skipped": skipped,
		"duplicates": [p["lead"] for p in plan if p["duplicate"]],
		# Bound into the confirmation so leads edited after the preview are skipped, not overwritten
		"snapshot": {p["lead"]: p["modified"] for p in plan},
	}


def assign_leads(params, preview):
	from frappe.desk.form.assign_to import _add as add_assignment

	done, failed = [], []
	for row in preview["plan"]:
		lead = row["lead"]
		savepoint = f"raya_assign_{frappe.generate_hash(length=8)}"
		frappe.db.savepoint(savepoint)
		try:
			current = frappe.db.get_value("Lead", lead, ["modified", "status"], as_dict=True, for_update=True)
			if not current or str(current.modified) != preview["snapshot"][lead]:
				failed.append({"name": lead, "reason": "changed after preview"})
				continue
			doc = frappe.get_doc("Lead", lead)
			doc.check_permission("write")
			doc.lead_owner = row["user"]
			if params.get("branch"):
				doc.raya_branch = params["branch"]
			doc.save()
			add_assignment(
				{
					"assign_to": [row["user"]],
					"doctype": "Lead",
					"name": lead,
					"description": "تخصیص از طریق رایا",
				},
				ignore_permissions=False,
			)
			done.append({"doctype": "Lead", "name": lead, "user": row["user"], "link": _link("Lead", lead)})
		except Exception as e:
			frappe.db.rollback(save_point=savepoint)
			failed.append({"name": lead, "reason": str(e)[:200] or e.__class__.__name__})
			frappe.clear_last_message()

	status = "Executed" if not failed else ("Partially Executed" if done else "Failed")
	return {
		"status": status,
		"message": _("{0} of {1} leads assigned").format(len(done), len(preview["plan"])),
		"records": done,
		"failed": failed,
	}


register(
	Action(
		name="assign_leads",
		label="تخصیص لید",
		kind="write",
		params={
			"leads": Param("list", required=True, max_items=200, label="لیدها"),
			"users": Param("list", required=True, max_items=20, label="کارشناسان"),
			"branch": Param("docname", label="شعبه"),
		},
		handler=assign_leads,
		check_permission=_assign_check,
		preview=assign_preview,
		description="Distribute leads round-robin between users (sets Lead Owner and an assignment)",
		examples=("این ۲۰ لید را بین این دو کارشناس تقسیم کن",),
	)
)


def get_assignable_users():
	"""System users holding a selling/CRM role, for the assignment page and clarifying questions."""
	roles = ("Sales User", "Sales Manager")
	users = frappe.get_all(
		"Has Role",
		filters={"role": ("in", roles), "parenttype": "User"},
		pluck="parent",
		distinct=True,
	)
	return frappe.get_all(
		"User",
		filters=[
			["name", "in", users or [""]],
			["name", "not in", ["Administrator", "Guest"]],
			["enabled", "=", 1],
			["user_type", "=", "System User"],
		],
		fields=["name", "full_name", "user_image"],
		order_by="full_name asc",
	)
