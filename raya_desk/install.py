import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

# ERPNext has a Branch master but no branch on CRM or selling documents; the dashboard,
# assignment and reports filter on this field.
BRANCH_FIELD_TARGETS = {
	"Lead": "lead_owner",
	"Opportunity": "opportunity_owner",
	"Sales Invoice": "company",
	"Contract": "party_name",
}


def after_install():
	after_migrate()


def after_migrate():
	create_branch_fields()
	set_default_settings()


def create_branch_fields():
	create_custom_fields(
		{
			doctype: [
				{
					"fieldname": "raya_branch",
					"label": "Branch",
					"fieldtype": "Link",
					"options": "Branch",
					"insert_after": insert_after,
					"in_standard_filter": 1,
					"module": "Raya Desk",
				}
			]
			for doctype, insert_after in BRANCH_FIELD_TARGETS.items()
		},
		update=True,
	)


def set_default_settings():
	# Defaults of a Single only reach the database once it is saved
	if frappe.db.sql("select 1 from `tabSingles` where doctype=%s limit 1", "Raya Desk Settings"):
		return
	settings = frappe.get_single("Raya Desk Settings")
	settings.update(
		{
			"enable_theme": 1,
			"enable_assistant": 1,
			"agent_provider": "mock",
			"stt_provider": "mock",
			"allow_tts": 1,
			"preview_ttl_minutes": 10,
			"log_retention_days": 90,
		}
	)
	settings.save(ignore_permissions=True)
