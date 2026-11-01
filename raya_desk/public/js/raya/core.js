// Shared helpers for the Raya theme, pages and assistant.

const OFF_KEY = "raya_desk_off";

function storage_get(key) {
	try {
		return window.localStorage.getItem(key);
	} catch (e) {
		return null;
	}
}

function storage_set(key, value) {
	try {
		if (value === null) window.localStorage.removeItem(key);
		else window.localStorage.setItem(key, value);
	} catch (e) {
		// Private windows and blocked storage: the toggle then lasts for the page only
	}
}

export function boot_config() {
	return (window.frappe && frappe.boot && frappe.boot.raya_desk) || {};
}

// ?raya=off|on persists the per-user troubleshooting switch
export function read_url_toggle() {
	const value = new URLSearchParams(window.location.search).get("raya");
	if (value === "off") storage_set(OFF_KEY, "1");
	if (value === "on") storage_set(OFF_KEY, null);
}

export function is_user_disabled() {
	return storage_get(OFF_KEY) === "1";
}

export function set_user_disabled(disabled) {
	storage_set(OFF_KEY, disabled ? "1" : null);
}

export function theme_active() {
	return boot_config().theme_enabled !== false && !is_user_disabled();
}

export function assistant_active() {
	return boot_config().assistant_enabled === true && !is_user_disabled();
}

export function storage(key, value) {
	if (value === undefined) return storage_get("raya_desk_" + key);
	storage_set("raya_desk_" + key, value);
}

export function esc(value) {
	return frappe.utils.escape_html(value == null ? "" : String(value));
}

const fa_number = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
const fa_decimal = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 });

export function num(value) {
	if (value == null || value === "") return "—";
	return fa_number.format(Number(value));
}

export function pct(value) {
	if (value == null) return null;
	return fa_decimal.format(Math.abs(value)) + "٪";
}

export function money(value) {
	if (value == null) return "—";
	const currency = (boot_config().currency || frappe.boot.sysdefaults.currency || "").toUpperCase();
	const suffix = currency === "IRR" ? " ریال" : currency ? ` ${currency}` : "";
	return fa_number.format(Number(value)) + suffix;
}

const jalali_date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
	year: "numeric",
	month: "long",
	day: "numeric",
	timeZone: "UTC",
});
const jalali_short = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

// Dates from the server are system-timezone calendar dates ("2026-11-01"); format them as such
export function jdate(value, short) {
	if (!value) return "—";
	const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
	if (!y) return esc(value);
	const date = new Date(Date.UTC(y, m - 1, d));
	return (short ? jalali_short : jalali_date).format(date);
}

export function fa_digits(text) {
	return String(text).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
}

export function route_url(...parts) {
	return "/desk/" + parts.map((p) => encodeURIComponent(p)).join("/");
}

export function doc_url(doctype, name) {
	return route_url(frappe.router.slug(doctype), name);
}

export function call(method, args) {
	return frappe.call({ method, args, freeze: false }).then((r) => r.message);
}

export const ICONS = {
	mic: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/></svg>',
	stop: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
	send: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 18 9-18 9 4-9z"/><path d="M7 12h14"/></svg>',
	close: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
	volume: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
	trash: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
	inbox: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
	users: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
	phone: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
	clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg>',
	file: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg>',
	refresh: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
};
