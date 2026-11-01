# Copyright (c) 2026, Raya Faraz and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class RayaDeskSettings(Document):
	def on_update(self):
		# The theme and assistant flags travel in bootinfo
		frappe.clear_cache()
