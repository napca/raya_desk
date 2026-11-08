import { esc, theme_active } from "./core";

// A shared, permission-aware way back to the same product from any native module.
// Native module sidebars and their permissions remain responsible for module navigation.
export function make_shell() {
	const links = [
		{ label: "All applications", href: "/desk", page: "desktop" },
		{ label: "Raya dashboard", href: "/desk/raya-dashboard", page: "raya-dashboard", permission: "Lead" },
		{ label: "Selling workspace", href: "/desk/selling", page: "Selling", permission: "Sales Invoice" },
		{ label: "Customers", href: "/desk/customer", doctype: "Customer" },
		{ label: "Leads", href: "/desk/lead", doctype: "Lead" },
	].filter((link) => !link.permission && !link.doctype || frappe.model.can_read(link.permission || link.doctype));
	const $nav = $(`<nav class="raya-shell-nav" aria-label="${esc(__("Raya navigation"))}">
		<div class="raya-shell-links">${links.map((link, index) => `<a href="${link.href}" data-raya-link="${index}">${esc(__(link.label))}</a>`).join("")}</div>
		<div class="raya-shell-actions"><button type="button" class="raya-document-info" hidden aria-expanded="false">${esc(__("Document information"))}</button></div>
	</nav>`).insertBefore(".main-section > #body");
	$nav.toggleClass("raya-shell-minimal", !theme_active());
	const $info = $nav.find(".raya-document-info");
	const choices = new WeakMap();
	let current_page;

	function update() {
		const route = frappe.get_route() || [];
		const hidden = ["desktop", "setup-wizard"].includes(route[0]);
		$nav.prop("hidden", hidden);
		document.documentElement.classList.toggle("raya-has-shell", !hidden);
		$nav.find("[data-raya-link]").each((index, el) => {
			const link = links[index];
			const active = link.doctype ? route[1] === link.doctype : route.includes(link.page);
			if (active) el.setAttribute("aria-current", "page");
			else el.removeAttribute("aria-current");
		});
		current_page = frappe.container?.page;
		const form = route[0] === "Form" && current_page;
		$info.prop("hidden", !form);
		if (!form) return;
		const compact = choices.has(current_page) ? choices.get(current_page) : window.innerWidth < 1440 || document.documentElement.classList.contains("raya-assistant-docked");
		$(current_page).toggleClass("raya-meta-collapsed", compact);
		$info.attr("aria-expanded", String(!compact));
	}
	$info.on("click", () => {
		if (!current_page) return;
		const collapsed = !$(current_page).hasClass("raya-meta-collapsed");
		choices.set(current_page, collapsed);
		update();
	});
	$(document).on("page-change.rayaShell form-refresh.rayaShell", update);
	frappe.router.on("change", update);
	window.addEventListener("resize", update);
	update();
	return { $nav, update };
}
