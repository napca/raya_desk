"""Runs registry actions for the session user and records what happened.

Write actions are two-step. `preview` validates and stores the bound parameters in a
Raya Assistant Log row owned by the user; the row name is the confirmation token. `confirm`
locks that row, checks owner, expiry and parameter hash, re-checks permissions and runs the
action exactly once. Changing any parameter means a new preview.
"""

import hashlib
import json

import frappe
from frappe import _
from frappe.utils import add_to_date, get_datetime, now_datetime

from raya_desk.assistant import actions  # noqa: F401  registers the actions
from raya_desk.assistant.registry import get_action, validate_params


def params_hash(action_name, params, user):
	payload = json.dumps([action_name, params, user], sort_keys=True, default=str)
	return hashlib.sha256(payload.encode()).hexdigest()


def _log(**values):
	doc = frappe.get_doc({"doctype": "Raya Assistant Log", "user": frappe.session.user, **values})
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc


def _ensure_enabled():
	if not frappe.db.get_single_value("Raya Desk Settings", "enable_assistant"):
		frappe.throw(_("The assistant is disabled"), frappe.ValidationError)


def run_read(action_name, params):
	_ensure_enabled()
	action = get_action(action_name)
	if action.kind != "read":
		frappe.throw(_("This action changes data and needs a preview"))
	params = validate_params(action, params)
	action.check_permission(params)
	return action.handler(params)


def preview(action_name, params):
	_ensure_enabled()
	action = get_action(action_name)
	if action.kind != "write":
		frappe.throw(_("This action does not need confirmation"))
	params = validate_params(action, params)
	action.check_permission(params)
	result = action.preview(params)

	ttl = frappe.db.get_single_value("Raya Desk Settings", "preview_ttl_minutes") or 10
	ref = action.reference(params) or (None, None)
	stored = {"params": params, "preview": result}
	log = _log(
		name=frappe.generate_hash(length=24),
		action=action.name,
		kind="write",
		status="Previewed",
		reference_doctype=ref[0],
		reference_name=ref[1],
		summary=result.get("summary"),
		params=json.dumps(stored, default=str, ensure_ascii=False),
		params_hash=params_hash(action.name, params, frappe.session.user),
		expires_on=add_to_date(now_datetime(), minutes=ttl),
	)
	public = {k: v for k, v in result.items() if k != "snapshot"}
	return {
		"token": log.name,
		"params_hash": log.params_hash,
		"expires_on": log.expires_on,
		"action": action.name,
		"label": action.label,
		"params": params,
		"preview": public,
	}


def _locked_log(token):
	row = frappe.db.get_value(
		"Raya Assistant Log",
		token,
		["name", "user", "action", "status", "params", "params_hash", "expires_on"],
		as_dict=True,
		for_update=True,
	)
	# Same message for "missing" and "someone else's" so tokens cannot be probed
	if not row or row.user != frappe.session.user:
		raise frappe.PermissionError(_("This confirmation is not valid"))
	return row


def confirm(token, expected_hash):
	_ensure_enabled()
	row = _locked_log(token)
	if row.status != "Previewed":
		frappe.throw(_("This request was already {0}").format(_(row.status.lower())), frappe.ValidationError)
	if get_datetime(row.expires_on) < now_datetime():
		frappe.db.set_value("Raya Assistant Log", token, "status", "Expired", update_modified=False)
		frappe.db.commit()
		frappe.throw(_("This confirmation expired; ask again for a fresh preview"))

	stored = json.loads(row.params)
	params = stored["params"]
	if expected_hash != row.params_hash or params_hash(row.action, params, row.user) != row.params_hash:
		frappe.throw(_("The request changed after preview; ask again for a fresh preview"))

	action = get_action(row.action)
	action.check_permission(params)

	frappe.db.set_value("Raya Assistant Log", token, "status", "Executing", update_modified=False)
	result = action.handler(params, stored["preview"])
	frappe.db.set_value(
		"Raya Assistant Log",
		token,
		{
			"status": result.get("status", "Executed"),
			"executed_on": now_datetime(),
			"result": json.dumps(
				{k: result.get(k) for k in ("message", "records", "failed")}, default=str, ensure_ascii=False
			),
		},
		update_modified=False,
	)
	return result


def cancel(token):
	row = _locked_log(token)
	if row.status == "Previewed":
		frappe.db.set_value("Raya Assistant Log", token, "status", "Cancelled", update_modified=False)
	return {"status": "Cancelled"}


def expire_previews():
	"""Hourly: previews nobody confirmed or cancelled."""
	frappe.db.set_value(
		"Raya Assistant Log",
		{"status": "Previewed", "expires_on": ("<", now_datetime())},
		"status",
		"Expired",
		update_modified=False,
	)
