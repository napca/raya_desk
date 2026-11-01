// Small render helpers shared by the Raya pages and the assistant. They return HTML strings;
// every dynamic value goes through esc() or a number/date formatter.

import { esc, num, pct } from "./core";

export function state(kind, message, extra = "") {
	const icons = { loading: "…", empty: "∅", error: "!", forbidden: "🔒", offline: "⚡" };
	if (kind === "loading") {
		return `<div class="raya-state" role="status" aria-live="polite">
			<div class="raya-skeleton" style="width:60%"></div>
			<div class="raya-skeleton" style="width:40%"></div>
			<span class="sr-only">${esc(message || __("Loading..."))}</span>
		</div>`;
	}
	return `<div class="raya-state raya-state--${kind}" role="${kind === "error" ? "alert" : "status"}">
		<div class="raya-state-icon" aria-hidden="true">${icons[kind] || "i"}</div>
		<div>${esc(message)}</div>${extra}
	</div>`;
}

// Classifies a failed frappe.call for the right empty/error/forbidden/offline state
export function error_state(err) {
	if (!navigator.onLine) return state("offline", "اتصال اینترنت برقرار نیست. پس از اتصال دوباره تلاش کنید.");
	const exc = (err && (err.exc_type || (err.responseJSON && err.responseJSON.exc_type))) || "";
	if (exc === "PermissionError" || (err && err.status === 403)) {
		return state("forbidden", "به این داده دسترسی ندارید.");
	}
	return state("error", "بارگذاری ناموفق بود. دوباره تلاش کنید.");
}

export function badge(text, variant = "") {
	return `<span class="raya-badge ${variant ? "raya-badge--" + variant : ""}">${esc(text)}</span>`;
}

export function delta(change, label = "نسبت به دوره قبل") {
	if (change == null) return `<span class="raya-stat-foot">بدون داده دوره قبل</span>`;
	const up = change >= 0;
	return `<span class="raya-stat-foot"><span class="${up ? "raya-delta-up" : "raya-delta-down"}">
		${up ? "▲" : "▼"} ${pct(change)}</span> ${esc(label)}</span>`;
}

export function stat_card({ label, value, foot = "", icon = "", permitted = true }) {
	return `<div class="raya-card raya-stat">
		<div class="raya-stat-label">${icon}${esc(label)}</div>
		<div class="raya-stat-value">${permitted ? value : "—"}</div>
		${permitted ? foot : `<span class="raya-stat-foot">دسترسی ندارید</span>`}
	</div>`;
}

export function segmented(name, options, value) {
	return `<div class="raya-segmented" role="group" aria-label="${esc(name)}">
		${options
			.map(
				(o) =>
					`<button type="button" data-value="${esc(o.value)}" aria-pressed="${
						o.value === value
					}">${esc(o.label)}</button>`
			)
			.join("")}
	</div>`;
}

export function select(name, options, value, placeholder) {
	return `<select class="raya-select" aria-label="${esc(name)}">
		<option value="">${esc(placeholder)}</option>
		${options
			.map((o) => `<option value="${esc(o)}" ${o === value ? "selected" : ""}>${esc(o)}</option>`)
			.join("")}
	</select>`;
}

export function stepper(steps, active) {
	return `<ol class="raya-stepper" aria-label="مراحل">
		${steps
			.map(
				(s, i) =>
					`${i ? '<span class="raya-step-sep" aria-hidden="true"></span>' : ""}
					<li class="raya-step ${i === active ? "is-active" : i < active ? "is-done" : ""}"
						${i === active ? 'aria-current="step"' : ""}>
						<span class="raya-step-num">${num(i + 1)}</span>${esc(s)}
					</li>`
			)
			.join("")}
	</ol>`;
}

export function table(columns, rows) {
	return `<div class="raya-table-wrap"><table class="raya-table">
		<thead><tr>${columns.map((c) => `<th scope="col">${esc(c.label)}</th>`).join("")}</tr></thead>
		<tbody>${rows
			.map((r) => `<tr>${columns.map((c) => `<td>${c.render ? c.render(r) : esc(r[c.key])}</td>`).join("")}</tr>`)
			.join("")}</tbody>
	</table></div>`;
}
