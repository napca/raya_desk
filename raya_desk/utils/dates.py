"""Jalali calendar helpers and the reporting periods shared by the dashboard, reports and assistant.

Dates are stored by ERPNext as Gregorian dates and datetimes in the system time zone; only display
and period boundaries are Jalali.
"""

from datetime import date, timedelta

from frappe.utils import getdate, nowdate

PERIODS = ("today", "week", "month", "6months", "year", "all")

PERIOD_LABELS = {
	"today": "امروز",
	"week": "۷ روز اخیر",
	"month": "این ماه",
	"6months": "۶ ماه اخیر",
	"year": "امسال",
	"all": "همه",
}


def gregorian_to_jalali(gy: int, gm: int, gd: int) -> tuple[int, int, int]:
	g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
	gy2 = gy + 1 if gm > 2 else gy
	days = 355666 + (365 * gy) + ((gy2 + 3) // 4) - ((gy2 + 99) // 100) + ((gy2 + 399) // 400) + gd + g_d_m[gm - 1]
	jy = -1595 + (33 * (days // 12053))
	days %= 12053
	jy += 4 * (days // 1461)
	days %= 1461
	if days > 365:
		jy += (days - 1) // 365
		days = (days - 1) % 365
	if days < 186:
		jm = 1 + (days // 31)
		jd = 1 + (days % 31)
	else:
		jm = 7 + ((days - 186) // 30)
		jd = 1 + ((days - 186) % 30)
	return jy, jm, jd


def jalali_to_gregorian(jy: int, jm: int, jd: int) -> tuple[int, int, int]:
	jy += 1595
	days = -355668 + (365 * jy) + ((jy // 33) * 8) + (((jy % 33) + 3) // 4) + jd
	days += (jm - 1) * 31 if jm < 7 else ((jm - 7) * 30) + 186
	gy = 400 * (days // 146097)
	days %= 146097
	if days > 36524:
		days -= 1
		gy += 100 * (days // 36524)
		days %= 36524
		if days >= 365:
			days += 1
	gy += 4 * (days // 1461)
	days %= 1461
	if days > 365:
		gy += (days - 1) // 365
		days = (days - 1) % 365
	gd = days + 1
	leap = (gy % 4 == 0 and gy % 100 != 0) or (gy % 400 == 0)
	month_days = [0, 31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	gm = 0
	for gm in range(1, 13):
		if gd <= month_days[gm]:
			break
		gd -= month_days[gm]
	return gy, gm, gd


def to_jalali(d: date) -> tuple[int, int, int]:
	return gregorian_to_jalali(d.year, d.month, d.day)


def from_jalali(jy: int, jm: int, jd: int) -> date:
	return date(*jalali_to_gregorian(jy, jm, jd))


def get_period_range(period: str, today: date | None = None) -> tuple[date | None, date]:
	"""Inclusive (from, to) dates in the system time zone. `from` is None for "all"."""
	today = getdate(today or nowdate())
	jy, jm, _ = to_jalali(today)
	match period:
		case "today":
			return today, today
		case "week":
			return today - timedelta(days=6), today
		case "month":
			return from_jalali(jy, jm, 1), today
		case "6months":
			return today - timedelta(days=181), today
		case "year":
			return from_jalali(jy, 1, 1), today
		case "all":
			return None, today
	raise ValueError(f"Unknown period {period}")


def get_previous_range(period: str, today: date | None = None) -> tuple[date, date] | None:
	"""The window of equal length right before the period, for comparisons."""
	start, end = get_period_range(period, today)
	if start is None:
		return None
	length = (end - start).days + 1
	return start - timedelta(days=length), start - timedelta(days=1)


def format_jalali(d) -> str:
	"""1405/08/11 in Persian digits, for previews and messages."""
	jy, jm, jd = to_jalali(getdate(d))
	return f"{jy}/{jm:02d}/{jd:02d}".translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
