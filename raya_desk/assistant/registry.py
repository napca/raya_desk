"""The only operations the assistant can run.

The agent layer (a model or the demo provider) may only *propose* one of these by name with
parameters. Parameters are validated against the schema here, permissions are checked against the
session user, and write actions run only through preview → explicit confirmation.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import frappe
from frappe import _
from frappe.utils import getdate

DOCNAME_RE = re.compile(r"^[^\x00-\x1f%<>]{1,140}$")


@dataclass(frozen=True)
class Param:
	type: Literal["str", "int", "date", "time", "docname", "doctype", "list"]
	required: bool = False
	choices: tuple | None = None
	min: int | None = None
	max: int | None = None
	max_items: int | None = None
	default: Any = None
	label: str = ""


@dataclass(frozen=True)
class Action:
	name: str
	label: str
	kind: Literal["read", "write"]
	params: dict[str, Param]
	handler: Callable[[dict], dict]
	# Raises frappe.PermissionError when the session user may not run it with these params
	check_permission: Callable[[dict], None] = lambda params: None
	# Write actions only: returns the exact scope and effect to show before confirmation
	preview: Callable[[dict], dict] | None = None
	reference: Callable[[dict], tuple[str, str] | None] = lambda params: None
	description: str = ""
	examples: tuple[str, ...] = field(default_factory=tuple)

	@property
	def requires_confirmation(self):
		return self.kind == "write"


REGISTRY: dict[str, Action] = {}


def register(action: Action):
	if action.kind == "write" and not action.preview:
		raise ValueError(f"Write action {action.name} needs a preview")
	REGISTRY[action.name] = action
	return action


def get_action(name: str) -> Action:
	if name not in REGISTRY:
		frappe.throw(_("Unknown assistant action"), frappe.ValidationError)
	return REGISTRY[name]


def _coerce(name: str, spec: Param, value):
	if spec.type == "int":
		try:
			value = int(value)
		except (TypeError, ValueError):
			frappe.throw(_("{0} must be a number").format(name))
		if spec.min is not None and value < spec.min or spec.max is not None and value > spec.max:
			frappe.throw(_("{0} is out of range").format(name))
		return value
	if spec.type == "date":
		try:
			return str(getdate(value))
		except Exception:
			frappe.throw(_("{0} must be a date").format(name))
	if spec.type == "time":
		if not isinstance(value, str) or not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value):
			frappe.throw(_("{0} must be a time like 10:00").format(name))
		return value
	if spec.type == "list":
		if not isinstance(value, list | tuple):
			frappe.throw(_("{0} must be a list").format(name))
		if spec.max_items and len(value) > spec.max_items:
			frappe.throw(_("{0} accepts at most {1} items").format(name, spec.max_items))
		value = list(dict.fromkeys(str(v) for v in value))
		for v in value:
			if not DOCNAME_RE.match(v):
				frappe.throw(_("Invalid value in {0}").format(name))
		return value
	if not isinstance(value, str):
		frappe.throw(_("{0} must be text").format(name))
	value = value.strip()
	if spec.max and len(value) > spec.max:
		frappe.throw(_("{0} is too long").format(name))
	if spec.type == "doctype" and not frappe.db.exists("DocType", value):
		frappe.throw(_("Unknown document type"))
	if spec.type == "docname" and not DOCNAME_RE.match(value):
		frappe.throw(_("Invalid document name"))
	return value


def validate_params(action: Action, params: dict | None) -> dict:
	params = params or {}
	if not isinstance(params, dict):
		frappe.throw(_("Parameters must be an object"))
	unknown = set(params) - set(action.params)
	if unknown:
		frappe.throw(_("Unknown parameters: {0}").format(", ".join(sorted(unknown))))

	clean = {}
	for name, spec in action.params.items():
		value = params.get(name)
		if value in (None, "", []):
			if spec.required:
				frappe.throw(_("{0} is required").format(spec.label or name))
			if spec.default is not None:
				clean[name] = spec.default
			continue
		value = _coerce(name, spec, value)
		if spec.choices and value not in spec.choices:
			frappe.throw(_("Invalid value for {0}").format(spec.label or name))
		clean[name] = value
	return clean


def describe():
	"""Public contract of the registry, for the client and future agent providers."""
	return [
		{
			"name": a.name,
			"label": a.label,
			"kind": a.kind,
			"requires_confirmation": a.requires_confirmation,
			"description": a.description,
			"examples": list(a.examples),
			"params": {
				k: {
					"type": p.type,
					"required": p.required,
					"choices": list(p.choices) if p.choices else None,
					"label": p.label,
				}
				for k, p in a.params.items()
			},
		}
		for a in REGISTRY.values()
	]
