# Copyright (c) 2026, Raya Faraz and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import add_days, now_datetime


class RayaAssistantLog(Document):
	@staticmethod
	def clear_old_logs(days=None):
		days = days or frappe.db.get_single_value("Raya Desk Settings", "log_retention_days") or 90
		frappe.db.delete("Raya Assistant Log", {"creation": ("<", add_days(now_datetime(), -int(days)))})
