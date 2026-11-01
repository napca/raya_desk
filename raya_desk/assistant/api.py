"""Whitelisted endpoints of the assistant. All of them act as the session user."""

import frappe
from frappe.rate_limiter import rate_limit

from raya_desk.assistant import executor
from raya_desk.assistant.providers import get_provider, sanitize_context
from raya_desk.assistant.registry import describe

MAX_TEXT = 1000


@frappe.whitelist()
def get_capabilities():
	provider = get_provider()
	return {"provider": provider.name, "demo": provider.demo, "actions": describe()}


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=60, seconds=60)
def interpret(text: str, context: str | dict | None = None):
	executor._ensure_enabled()
	text = (text or "").strip()[:MAX_TEXT]
	if not text:
		frappe.throw(frappe._("Say or type a request"))
	# Only the request and the page context reach the provider; record contents do not
	return get_provider().interpret(text, sanitize_context(context))


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=120, seconds=60)
def run_action(action: str, params: str | dict | None = None):
	return executor.run_read(action, frappe.parse_json(params) if params else {})


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=30, seconds=60)
def preview_action(action: str, params: str | dict | None = None):
	return executor.preview(action, frappe.parse_json(params) if params else {})


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=30, seconds=60)
def confirm_action(token: str, params_hash: str):
	return executor.confirm(token, params_hash)


@frappe.whitelist(methods=["POST"])
def cancel_action(token: str):
	return executor.cancel(token)
