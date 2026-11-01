"""Agent providers turn a request plus page context into a reply and at most one proposed action.

A provider never executes anything: proposals go back to the client, which runs reads through
`run_action` and writes through `preview_action` → user confirmation → `confirm_action`, all of
which re-validate on the server. To add a real model, subclass AgentProvider, give it the
registry description as its tool list, read its key with frappe.conf (site_config.json, outside
Git) and add it to PROVIDERS and the Raya Desk Settings `agent_provider` options.
"""

import re
from datetime import timedelta

import frappe
from frappe.utils import getdate, nowdate

from raya_desk.assistant.actions import FOLLOWUP_DOCTYPES, get_assignable_users
from raya_desk.utils.dates import from_jalali

CONTEXT_KEYS = {"route", "view", "doctype", "docname", "is_new", "selected", "page", "filters"}
MAX_SELECTED = 200

DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
NUMBER_WORDS = {
	"یک": 1,
	"دو": 2,
	"سه": 3,
	"چهار": 4,
	"پنج": 5,
	"شش": 6,
	"هفت": 7,
	"هشت": 8,
	"نه": 9,
	"ده": 10,
	"یازده": 11,
	"دوازده": 12,
	"چهارده": 14,
	"پانزده": 15,
	"بیست": 20,
	"سی": 30,
}
NUMBER = r"(\d{1,3}|" + "|".join(sorted(NUMBER_WORDS, key=len, reverse=True)) + r")"


def normalize(text: str) -> str:
	text = (text or "").translate(DIGITS).replace("ي", "ی").replace("ك", "ک").replace("‌", " ")
	return re.sub(r"\s+", " ", text).strip()


def to_number(token):
	return int(token) if token.isdigit() else NUMBER_WORDS.get(token)


def sanitize_context(context):
	context = frappe.parse_json(context) if context else {}
	if not isinstance(context, dict):
		return {}
	clean = {k: context[k] for k in CONTEXT_KEYS if k in context}
	selected = clean.get("selected") or []
	clean["selected"] = [str(s) for s in selected[:MAX_SELECTED]] if isinstance(selected, list) else []
	for key in ("doctype", "docname", "page", "view"):
		if clean.get(key) is not None and not isinstance(clean[key], str):
			clean.pop(key)
	return clean


class AgentProvider:
	name = "base"
	demo = False

	def interpret(self, text: str, context: dict) -> dict:
		raise NotImplementedError


class MockAgentProvider(AgentProvider):
	"""Keyword rules over Persian text. Clearly labelled as a demo in every reply."""

	name = "mock"
	demo = True

	def interpret(self, text, context):
		t = normalize(text)
		for rule in (
			self._followup,
			self._assign,
			self._stale,
			self._explain,
			self._sales,
			self._dashboard,
			self._selection,
		):
			if (result := rule(t, context)) is not None:
				return result
		return self._reply(
			"این درخواست را در حالت نمایشی متوجه نشدم. نمونه‌ها: «این فاکتور را توضیح بده»، "
			"«لیدهایی که سه روز پیگیری نشده‌اند را بیاور»، «فروش این ماه را نشان بده»، "
			"«برای این لید فردا ساعت ده پیگیری ثبت کن»."
		)

	# ------------------------------------------------------------------ helpers

	def _reply(self, reply, proposal=None, clarify=None):
		return {"provider": self.name, "demo": self.demo, "reply": reply, "proposal": proposal, "clarify": clarify}

	def _period(self, t):
		if re.search(r"(6|شش) ?ماه", t):
			return "6months"
		for word, period in (
			("امروز", "today"),
			("هفته", "week"),
			("ماه", "month"),
			("امسال", "year"),
			("سال", "year"),
			("همه", "all"),
			("کل ", "all"),
		):
			if word in t:
				return period
		return "month"

	def _branch(self, t):
		for name in frappe.get_all("Branch", pluck="name"):
			if normalize(name) in t:
				return name
		return None

	def _days(self, t, default=3):
		m = re.search(NUMBER + r" ?روز", t)
		return to_number(m.group(1)) if m else default

	def _date(self, t):
		today = getdate(nowdate())
		if "پس فردا" in t or "پسفردا" in t:
			return today + timedelta(days=2)
		if "فردا" in t:
			return today + timedelta(days=1)
		if "امروز" in t:
			return today
		if m := re.search(NUMBER + r" ?روز (دیگه|دیگر|بعد)", t):
			return today + timedelta(days=to_number(m.group(1)))
		if m := re.search(r"(1[34]\d\d)/(\d{1,2})/(\d{1,2})", t):
			try:
				return from_jalali(int(m.group(1)), int(m.group(2)), int(m.group(3)))
			except ValueError:
				return None
		return None

	def _time(self, t):
		m = re.search(r"ساعت " + NUMBER + r"(?:[:٫.](\d{2}))?( و نیم)?", t)
		if not m:
			return None
		hour = to_number(m.group(1))
		if hour is None or hour > 23:
			return None
		minute = int(m.group(2)) if m.group(2) else (30 if m.group(3) else 0)
		if hour < 12 and any(w in t for w in ("بعدازظهر", "بعد از ظهر", "عصر", "شب")):
			hour += 12
		return f"{hour:02d}:{minute:02d}"

	# -------------------------------------------------------------------- rules

	def _followup(self, t, ctx):
		if not ("پیگیری" in t and re.search(r"ثبت|بذار|بگذار|ایجاد|بساز", t) or "یادآوری" in t):
			return None
		doctype, docname = ctx.get("doctype"), ctx.get("docname")
		if doctype not in FOLLOWUP_DOCTYPES or not docname or ctx.get("is_new") or ctx.get("view") != "form":
			return self._reply(
				"برای ثبت پیگیری ابتدا فرم لید، فرصت یا مشتری موردنظر را باز کنید.",
				clarify={"question": "پیگیری برای کدام سند ثبت شود؟", "choices": []},
			)
		date = self._date(t)
		if not date:
			return self._reply(
				"تاریخ پیگیری را مشخص نکردید.",
				clarify={"question": "پیگیری برای چه روزی باشد؟", "choices": ["امروز", "فردا", "پس فردا"]},
			)
		params = {"reference_doctype": doctype, "reference_name": docname, "date": str(date)}
		if time := self._time(t):
			params["time"] = time
		return self._reply(
			"پیش‌نمایش پیگیری آماده است. پس از بررسی، تأیید کنید.",
			proposal={"action": "create_followup", "params": params},
		)

	def _assign(self, t, ctx):
		if not re.search(r"تقسیم|تخصیص|واگذار", t):
			return None
		selected = ctx.get("selected") if ctx.get("doctype") == "Lead" and ctx.get("view") == "list" else []
		if not selected:
			return self._reply(
				"ابتدا لیدها را در فهرست لید انتخاب کنید یا از صفحه «تخصیص لید» استفاده کنید.",
				clarify={"question": "کدام لیدها تخصیص داده شوند؟", "choices": [], "link": "/desk/raya-lead-assignment"},
			)
		candidates = get_assignable_users()
		users = [
			u.name
			for u in candidates
			if u.full_name and any(part and part in t for part in {normalize(u.full_name), normalize(u.full_name.split()[0])})
		]
		if not users:
			return self._reply(
				f"{len(selected)} لید انتخاب شده است. بین کدام کارشناس‌ها تقسیم شود؟",
				clarify={
					"question": "کارشناس‌ها را نام ببرید.",
					"choices": [u.full_name for u in candidates[:8]],
				},
			)
		return self._reply(
			"طرح تقسیم آماده است. سهم هر کارشناس را بررسی و تأیید کنید.",
			proposal={"action": "assign_leads", "params": {"leads": selected, "users": users}},
		)

	def _stale(self, t, ctx):
		if not re.search(r"پیگیری نشده|بدون پیگیری|پیگیری نکرده|پیگیری‌نشده", t):
			return None
		params = {"days": self._days(t)}
		if branch := self._branch(t):
			params["branch"] = branch
		return self._reply(
			f"لیدهای فعالی که {params['days']} روز فعالیت یا پیگیری ثبت‌شده نداشته‌اند:",
			proposal={"action": "search_stale_leads", "params": params},
		)

	def _explain(self, t, ctx):
		if not re.search(r"توضیح|خلاصه|شرح بده|چیه|چیست", t):
			return None
		if ctx.get("view") == "form" and ctx.get("doctype") and ctx.get("docname") and not ctx.get("is_new"):
			return self._reply(
				"خلاصه سند باز:",
				proposal={"action": "explain_document", "params": {"doctype": ctx["doctype"], "name": ctx["docname"]}},
			)
		if ctx.get("selected") and ctx.get("doctype"):
			return self._selection("انتخاب", ctx)
		return self._reply("سندی باز نیست. ابتدا فرم موردنظر را باز کنید یا ردیف‌هایی را در فهرست انتخاب کنید.")

	def _sales(self, t, ctx):
		if "فروش" not in t and "فاکتور" not in t:
			return None
		params = {"period": self._period(t)}
		if branch := self._branch(t):
			params["branch"] = branch
		return self._reply("گزارش فروش با این فیلترها:", proposal={"action": "get_sales_report", "params": params})

	def _dashboard(self, t, ctx):
		if not re.search(r"آمار|داشبورد|وضعیت|عملکرد", t):
			return None
		params = {"period": self._period(t)}
		if branch := self._branch(t):
			params["branch"] = branch
		return self._reply("آمار داشبورد:", proposal={"action": "get_dashboard_metrics", "params": params})

	def _selection(self, t, ctx):
		if "انتخاب" not in t or not ctx.get("selected") or not ctx.get("doctype"):
			return None
		return self._reply(
			"خلاصه ردیف‌های انتخاب‌شده:",
			proposal={"action": "summarize_selection", "params": {"doctype": ctx["doctype"], "names": ctx["selected"]}},
		)


PROVIDERS = {"mock": MockAgentProvider}


def get_provider() -> AgentProvider:
	name = frappe.db.get_single_value("Raya Desk Settings", "agent_provider") or "mock"
	return PROVIDERS.get(name, MockAgentProvider)()
