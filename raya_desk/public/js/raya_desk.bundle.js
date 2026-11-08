// Raya Desk: theme switch and the global assistant. Pages under raya_desk/raya_desk/page use
// window.raya for the shared helpers.

import * as core from "./raya/core";
import * as ui from "./raya/ui";
import { Assistant } from "./raya/assistant/panel";
import { make_shell } from "./raya/shell";
import { install_date_labels } from "./raya/dates";

window.raya = Object.assign(window.raya || {}, { core, ui });
window.raya_pages = window.raya_pages || {};

core.read_url_toggle();

function apply_theme() {
	document.documentElement.classList.toggle("raya-theme", core.theme_active());
}

function sync_surface() {
	// app_ready fires before the router has populated its first route.
	document.documentElement.dataset.rayaPage = frappe.get_route()?.[0] || "desktop";
}

// Native desktop lifecycle event: no polling or mutation observers.
$(document).on("desktop_screen", (_event, { desktop }) => {
	if (!core.theme_active()) return;
	const $container = $(desktop.wrapper);
	if (!$container.find(".raya-launcher-heading").length) {
		$container.prepend(`<div class="raya-launcher-heading"><h1>${__("Your workspace")}</h1><p>${__("Choose an application to continue")}</p></div>`);
	}
});

// Apply as early as possible to avoid a flash of the stock theme
apply_theme();

$(document).on("app_ready", () => {
	apply_theme();
	sync_surface();
	frappe.router.on("change", sync_surface);
	if (core.is_user_disabled()) {
		frappe.show_alert({
			message: "پوسته و دستیار رایا برای شما خاموش است. برای روشن کردن ?raya=on را به آدرس اضافه کنید.",
			indicator: "orange",
		});
		return;
	}
	if (core.assistant_active() && !window.raya.assistant) {
		window.raya.shell = make_shell();
		window.raya.assistant = new Assistant();
	}
	else if (core.theme_active()) window.raya.shell = make_shell();
	install_date_labels();
});
