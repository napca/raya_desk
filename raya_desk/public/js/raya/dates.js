import { esc, jdate, theme_active } from "./core";
import { valid_iso_date } from "./calendar";

function enabled() {
	return theme_active() && document.documentElement.lang === "fa";
}

// A display-only extension. Native parsing, ISO values, sorting and the calendar
// remain Gregorian. Never feed a Jalali string back into the Date control.
export function install_date_labels() {
	const native_format = frappe.form.formatters.Date;
	frappe.form.formatters.Date = function (value, ...args) {
		const original = native_format.call(this, value, ...args);
		if (!enabled() || !valid_iso_date(value)) return original;
		return `<span class="raya-dual-date" title="${esc(`${jdate(value)} · ${original} میلادی`)}"><span>${esc(jdate(value))}</span><small dir="ltr">${esc(original)} <span dir="rtl">میلادی</span></small></span>`;
	};
	const NativeDate = frappe.ui.form.ControlDate;
	let hint_id = 0;
	frappe.ui.form.ControlDate = class RayaDate extends NativeDate {
		refresh_input() {
			super.refresh_input();
			this.update_raya_hint(this.value);
		}
		set_formatted_input(value) {
			super.set_formatted_input(value);
			this.update_raya_hint(value);
		}
		update_raya_hint(value) {
			if (!this.$input_wrapper || this.only_input) return;
			if (!this.$raya_hint) {
				const id = `raya-date-hint-${++hint_id}`;
				this.$raya_hint = $(`<small class="raya-date-hint" id="${id}" aria-live="polite"></small>`).appendTo(this.$input_wrapper);
				if (this.$input) this.$input.attr("aria-describedby", [this.$input.attr("aria-describedby"), id].filter(Boolean).join(" "));
			}
			const show = enabled() && this.disp_status === "Write";
			this.$raya_hint.prop("hidden", !show).text(valid_iso_date(value)
				? `شمسی: ${jdate(value)} · ورودی بالا میلادی است`
				: "ورود به میلادی؛ معادل شمسی پس از انتخاب نمایش داده می‌شود");
		}
	};
}
