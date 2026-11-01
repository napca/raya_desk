"""Development sample data. Run with:

    bench --site raya.localhost execute raya_desk.dev.seed.run

Refuses to run unless developer_mode is on. Every record is tagged "Raya Sample" so it can be
told apart (the dashboard shows a "نمونه" badge while tagged data exists) and removed with
`raya_desk.dev.seed.clear`.
"""

import random
from datetime import timedelta

import frappe
from frappe.desk.doctype.tag.tag import add_tag
from frappe.utils import add_days, get_datetime, getdate, now_datetime, nowdate

TAG = "Raya Sample"
BRANCHES = ["سعادت‌آباد", "پیروزی", "درختی"]
SOURCES = ["اینستاگرام", "وب‌سایت", "تماس ورودی", "نمایشگاه"]
FIRST = ["علی", "مریم", "حسین", "زهرا", "محمد", "فاطمه", "رضا", "نرگس", "امیر", "الهام", "مهدی", "سارا"]
LAST = ["محمدی", "حسینی", "رضایی", "کریمی", "موسوی", "احمدی", "جعفری", "صادقی", "رحیمی", "نوری"]
USERS = [
	("sara@raya.localhost", "سارا", "احمدی", ["Sales User"]),
	("reza@raya.localhost", "رضا", "کریمی", ["Sales User"]),
	("manager@raya.localhost", "نیما", "صالحی", ["Sales Manager", "Sales User"]),
	# No CRM roles: used to check that the assistant refuses
	("viewer@raya.localhost", "پویا", "مرادی", ["Accounts User"]),
]
DEV_PASSWORD = "raya-dev-123"


def _tag(doc):
	add_tag(TAG, doc.doctype, doc.name)


def _ensure(doctype, docname, **values):
	if frappe.db.exists(doctype, docname):
		return frappe.get_doc(doctype, docname)
	# __newname covers doctypes named by prompt; others name themselves from their fields
	doc = frappe.get_doc({"doctype": doctype, "__newname": docname, **values}).insert(ignore_permissions=True)
	_tag(doc)
	return doc


def _backdate(doc, dt):
	frappe.db.set_value(doc.doctype, doc.name, {"creation": dt, "modified": dt}, update_modified=False)


def run(seed=1405):
	if not frappe.conf.developer_mode:
		frappe.throw("Sample data is only for developer_mode sites")
	if frappe.db.exists("Tag Link", {"tag": TAG}):
		print("Sample data already present; run raya_desk.dev.seed.clear first to recreate it")
		return

	rnd = random.Random(seed)
	frappe.flags.mute_emails = True
	company = frappe.defaults.get_global_default("company") or frappe.get_all("Company", pluck="name")[0]

	for b in BRANCHES:
		_ensure("Branch", b, branch=b)
	for s in SOURCES:
		_ensure("UTM Source", s)

	for email, first, last, roles in USERS:
		if not frappe.db.exists("User", email):
			user = frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": first,
					"last_name": last,
					"language": "fa",
					"send_welcome_email": 0,
					"new_password": DEV_PASSWORD,
					"roles": [{"role": r} for r in roles],
				}
			).insert(ignore_permissions=True)
			_tag(user)

	sales_users = [u[0] for u in USERS if "Sales User" in u[3]]
	now = now_datetime()
	leads = []
	for i in range(48):
		first, last = rnd.choice(FIRST), rnd.choice(LAST)
		mobile = f"0912{rnd.randint(1000000, 9999999)}"
		if i in (7, 21):  # deliberate duplicates for the assignment preview
			mobile = leads[i - 3].mobile_no
		lead = frappe.get_doc(
			{
				"doctype": "Lead",
				"first_name": first,
				"last_name": last,
				"mobile_no": mobile,
				"utm_source": rnd.choice(SOURCES),
				"raya_branch": rnd.choice(BRANCHES),
				"company": company,
				"status": rnd.choice(["Lead", "Lead", "Open", "Replied", "Interested"]),
				"lead_owner": rnd.choice(sales_users) if i % 3 == 0 else None,
			}
		).insert(ignore_permissions=True)
		_tag(lead)
		_backdate(lead, now - timedelta(days=rnd.randint(0, 75), hours=rnd.randint(0, 10)))
		if not i % 3 == 0:
			# Lead Owner defaults to the creating user; clear it so these show as unassigned
			frappe.db.set_value("Lead", lead.name, "lead_owner", None, update_modified=False)
			lead.lead_owner = None
		leads.append(lead)

	for lead in rnd.sample(leads, 12):
		todo = frappe.get_doc(
			{
				"doctype": "ToDo",
				"allocated_to": lead.lead_owner or "Administrator",
				"reference_type": "Lead",
				"reference_name": lead.name,
				"date": add_days(nowdate(), rnd.randint(-3, 4)),
				"description": f"پیگیری {lead.lead_name}",
			}
		).insert(ignore_permissions=True)
		_tag(todo)
	for text, days in (("تماس با مشتریان نمایشگاه", 0), ("ارسال پیش‌فاکتور شرکت آلفا", -1)):
		todo = frappe.get_doc(
			{"doctype": "ToDo", "allocated_to": "Administrator", "date": add_days(nowdate(), days), "description": text}
		).insert(ignore_permissions=True)
		_tag(todo)

	for lead in rnd.sample(leads, 15):
		call = frappe.get_doc(
			{
				"doctype": "Call Log",
				"id": frappe.generate_hash(length=12),
				"from": lead.mobile_no,
				"to": "02188776655",
				"type": "Incoming",
				"status": "Completed",
				"duration": rnd.randint(30, 600),
				"links": [{"link_doctype": "Lead", "link_name": lead.name}],
			}
		).insert(ignore_permissions=True)
		_tag(call)
		_backdate(call, get_datetime(lead.creation) + timedelta(days=rnd.randint(0, 3)))

	_sales(rnd, company)
	frappe.db.commit()
	print(f"Created {len(leads)} leads, users {', '.join(u[0] for u in USERS)} (password {DEV_PASSWORD})")


def _sales(rnd, company):
	group = frappe.db.get_value("Item Group", {"is_group": 0}, "name") or "All Item Groups"
	item = _ensure(
		"Item",
		"RAYA-CONSULT",
		item_code="RAYA-CONSULT",
		item_name="خدمات مشاوره",
		item_group=group,
		is_stock_item=0,
		stock_uom="Nos",
	)
	customer_group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
	territory = frappe.db.get_value("Territory", {"is_group": 0}, "name")
	customers = [
		_ensure(
			"Customer",
			name,
			customer_name=name,
			customer_type="Company",
			customer_group=customer_group,
			territory=territory,
		)
		for name in ("شرکت آلفا", "فروشگاه پارس", "گروه صنعتی نوین", "کلینیک آرامش")
	]
	for i in range(22):
		posting = getdate(add_days(nowdate(), -rnd.randint(0, 70)))
		inv = frappe.get_doc(
			{
				"doctype": "Sales Invoice",
				"company": company,
				"customer": rnd.choice(customers).name,
				"set_posting_time": 1,
				"posting_date": posting,
				"due_date": add_days(posting, 30),
				"raya_branch": rnd.choice(BRANCHES),
				"items": [{"item_code": item.name, "qty": rnd.randint(1, 5), "rate": rnd.choice([12, 18, 25, 40]) * 1_000_000}],
			}
		)
		inv.insert(ignore_permissions=True)
		if i % 5:
			inv.submit()
		_tag(inv)
	for c in customers[:2]:
		contract = frappe.get_doc(
			{
				"doctype": "Contract",
				"party_type": "Customer",
				"party_name": c.name,
				"start_date": nowdate(),
				"contract_terms": "قرارداد پشتیبانی سالانه",
				"raya_branch": BRANCHES[0],
			}
		).insert(ignore_permissions=True)
		_tag(contract)


def clear():
	if not frappe.conf.developer_mode:
		frappe.throw("Only for developer_mode sites")
	order = ["Contract", "Sales Invoice", "Call Log", "ToDo", "Lead", "Customer", "Item", "User", "UTM Source", "Branch"]
	links = frappe.get_all("Tag Link", filters={"tag": TAG}, fields=["document_type", "document_name"])
	for doctype in order:
		for link in [l for l in links if l.document_type == doctype]:
			if not frappe.db.exists(doctype, link.document_name):
				continue
			doc = frappe.get_doc(doctype, link.document_name)
			if doc.docstatus == 1:
				doc.cancel()
			frappe.delete_doc(doctype, doc.name, force=True, ignore_permissions=True)
	frappe.db.delete("Tag Link", {"tag": TAG})
	frappe.db.commit()
