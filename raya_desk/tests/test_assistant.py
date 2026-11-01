import random
from datetime import date, timedelta
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, add_to_date, getdate, now_datetime, nowdate

from raya_desk.assistant import executor
from raya_desk.assistant.providers import MockAgentProvider
from raya_desk.utils.dates import from_jalali, get_period_range, to_jalali

SALES_USER = "raya-test-sales@example.com"
OTHER_SALES_USER = "raya-test-sales2@example.com"
NO_CRM_USER = "raya-test-viewer@example.com"


def make_user(email, roles):
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": email.split("@")[0],
				"send_welcome_email": 0,
				"roles": [{"role": r} for r in roles],
			}
		).insert(ignore_permissions=True)
	return email


def make_lead(**values):
	return frappe.get_doc(
		{"doctype": "Lead", "first_name": "تست", "last_name": frappe.generate_hash(length=6), **values}
	).insert(ignore_permissions=True)


class TestDates(IntegrationTestCase):
	def test_jalali_round_trip(self):
		self.assertEqual(to_jalali(date(2026, 3, 21)), (1405, 1, 1))
		self.assertEqual(to_jalali(date(2026, 11, 1)), (1405, 8, 10))
		for offset in range(0, 800, 7):
			d = date(2025, 1, 1) + timedelta(days=offset)
			self.assertEqual(from_jalali(*to_jalali(d)), d)

	def test_month_starts_on_jalali_month(self):
		start, end = get_period_range("month", today=date(2026, 11, 1))
		self.assertEqual(start, date(2026, 10, 23))  # 1 Aban 1405
		self.assertEqual(end, date(2026, 11, 1))


class TestRegistry(IntegrationTestCase):
	def test_unknown_action_and_params_are_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			executor.run_read("drop_database", {})
		with self.assertRaises(frappe.ValidationError):
			executor.run_read("search_stale_leads", {"days": 3, "sql": "select 1"})
		with self.assertRaises(frappe.ValidationError):
			executor.run_read("search_stale_leads", {"days": 9999})

	def test_write_action_cannot_run_as_read(self):
		with self.assertRaises(frappe.ValidationError):
			executor.run_read("create_followup", {})

	def test_read_action_respects_role_permissions(self):
		make_user(NO_CRM_USER, ["Accounts User"])
		frappe.set_user(NO_CRM_USER)
		try:
			with self.assertRaises(frappe.PermissionError):
				executor.run_read("search_stale_leads", {"days": 3})
		finally:
			frappe.set_user("Administrator")

	def test_stale_leads_definition(self):
		old = make_lead(status="Open")
		scheduled = make_lead(status="Open")
		for lead in (old, scheduled):
			frappe.db.set_value("Lead", lead.name, "creation", add_days(now_datetime(), -10), update_modified=False)
		frappe.get_doc(
			{
				"doctype": "ToDo",
				"allocated_to": "Administrator",
				"reference_type": "Lead",
				"reference_name": scheduled.name,
				"date": add_days(nowdate(), 1),
				"description": "x",
			}
		).insert()
		# The ToDo counts as activity and as a scheduled follow-up, so only `old` is stale
		names = [r.name for r in executor.run_read("search_stale_leads", {"days": 3, "limit": 100})["data"]["rows"]]
		self.assertIn(old.name, names)
		self.assertNotIn(scheduled.name, names)


class TestConfirmation(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.lead = make_lead()

	def preview_followup(self):
		return executor.preview(
			"create_followup",
			{
				"reference_doctype": "Lead",
				"reference_name": self.lead.name,
				"date": add_days(nowdate(), 1),
				"time": "10:00",
			},
		)

	def test_preview_does_not_write(self):
		before = frappe.db.count("ToDo", {"reference_name": self.lead.name})
		self.preview_followup()
		self.assertEqual(frappe.db.count("ToDo", {"reference_name": self.lead.name}), before)

	def test_confirm_runs_once(self):
		p = self.preview_followup()
		result = executor.confirm(p["token"], p["params_hash"])
		self.assertEqual(result["status"], "Executed")
		self.assertEqual(frappe.db.count("ToDo", {"reference_name": self.lead.name}), 1)
		with self.assertRaises(frappe.ValidationError):
			executor.confirm(p["token"], p["params_hash"])
		self.assertEqual(frappe.db.count("ToDo", {"reference_name": self.lead.name}), 1)

	def test_confirmation_is_bound_to_user(self):
		p = self.preview_followup()
		frappe.set_user(make_user(SALES_USER, ["Sales User"]))
		try:
			with self.assertRaises(frappe.PermissionError):
				executor.confirm(p["token"], p["params_hash"])
		finally:
			frappe.set_user("Administrator")

	def test_confirmation_is_bound_to_parameters(self):
		p = self.preview_followup()
		with self.assertRaises(frappe.ValidationError):
			executor.confirm(p["token"], "0" * 64)

	def test_expired_confirmation(self):
		p = self.preview_followup()
		frappe.db.set_value("Raya Assistant Log", p["token"], "expires_on", add_to_date(now_datetime(), minutes=-1))
		with patch.object(frappe.db, "commit"), self.assertRaises(frappe.ValidationError):
			executor.confirm(p["token"], p["params_hash"])
		self.assertEqual(frappe.db.get_value("Raya Assistant Log", p["token"], "status"), "Expired")

	def test_cancelled_confirmation_cannot_run(self):
		p = self.preview_followup()
		executor.cancel(p["token"])
		with self.assertRaises(frappe.ValidationError):
			executor.confirm(p["token"], p["params_hash"])

	def test_past_followup_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			executor.preview(
				"create_followup",
				{"reference_doctype": "Lead", "reference_name": self.lead.name, "date": add_days(nowdate(), -1)},
			)


class TestAssignment(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.users = [make_user(SALES_USER, ["Sales User"]), make_user(OTHER_SALES_USER, ["Sales User"])]
		self.leads = [make_lead(mobile_no=f"0935{random.randint(1000000, 9999999)}") for _ in range(4)]

	def test_round_robin_and_partial_result(self):
		p = executor.preview("assign_leads", {"leads": [l.name for l in self.leads], "users": self.users})
		counts = [c["value"] for c in p["preview"]["changes"][:2]]
		self.assertEqual(counts, ["2 لید", "2 لید"])

		# Edited after the preview: must be skipped, not overwritten
		changed = frappe.get_doc("Lead", self.leads[0].name)
		changed.job_title = "changed"
		changed.save()

		result = executor.confirm(p["token"], p["params_hash"])
		self.assertEqual(result["status"], "Partially Executed")
		self.assertEqual(len(result["records"]), 3)
		self.assertEqual(result["failed"][0]["name"], self.leads[0].name)
		self.assertEqual(frappe.db.get_value("Lead", self.leads[0].name, "lead_owner"), self.leads[0].lead_owner)
		self.assertIn(frappe.db.get_value("Lead", self.leads[1].name, "lead_owner"), self.users)

	def test_disabled_or_unknown_user_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			executor.preview("assign_leads", {"leads": [self.leads[0].name], "users": ["nobody@example.com"]})

	def test_requires_write_permission(self):
		frappe.set_user(make_user(NO_CRM_USER, ["Accounts User"]))
		try:
			with self.assertRaises(frappe.PermissionError):
				executor.preview("assign_leads", {"leads": [self.leads[0].name], "users": self.users})
		finally:
			frappe.set_user("Administrator")


class TestMockProvider(IntegrationTestCase):
	def interpret(self, text, **ctx):
		return MockAgentProvider().interpret(text, ctx)

	def test_stale_leads_with_persian_number(self):
		r = self.interpret("لیدهایی که سه روز پیگیری نشده‌اند را بیاور")
		self.assertEqual(r["proposal"], {"action": "search_stale_leads", "params": {"days": 3}})
		self.assertTrue(r["demo"])

	def test_followup_needs_open_document_and_date(self):
		self.assertIsNotNone(self.interpret("برای این لید فردا پیگیری ثبت کن")["clarify"])
		ctx = {"view": "form", "doctype": "Lead", "docname": "CRM-LEAD-1"}
		self.assertIsNotNone(self.interpret("برای این لید پیگیری ثبت کن", **ctx)["clarify"])
		r = self.interpret("برای این لید فردا ساعت ده پیگیری ثبت کن", **ctx)
		self.assertEqual(r["proposal"]["action"], "create_followup")
		self.assertEqual(r["proposal"]["params"]["date"], str(getdate(add_days(nowdate(), 1))))
		self.assertEqual(r["proposal"]["params"]["time"], "10:00")

	def test_sales_period_and_branch(self):
		if not frappe.db.exists("Branch", "سعادت‌آباد"):
			frappe.get_doc({"doctype": "Branch", "branch": "سعادت‌آباد"}).insert()
		r = self.interpret("فروش این ماه شعبه سعادت‌آباد را نشان بده")
		self.assertEqual(r["proposal"], {"action": "get_sales_report", "params": {"period": "month", "branch": "سعادت‌آباد"}})

	def test_assignment_needs_selection(self):
		r = self.interpret("این لیدها را تقسیم کن", view="list", doctype="Lead", selected=[])
		self.assertIsNone(r["proposal"])
		self.assertIn("link", r["clarify"])
