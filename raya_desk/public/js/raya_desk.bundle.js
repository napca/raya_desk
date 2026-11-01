// Raya Desk: theme switch and the global assistant. Pages under raya_desk/raya_desk/page use
// window.raya for the shared helpers.

import * as core from "./raya/core";
import * as ui from "./raya/ui";
import { Assistant } from "./raya/assistant/panel";

window.raya = Object.assign(window.raya || {}, { core, ui });
window.raya_pages = window.raya_pages || {};

core.read_url_toggle();

function apply_theme() {
	document.documentElement.classList.toggle("raya-theme", core.theme_active());
}

// Apply as early as possible to avoid a flash of the stock theme
apply_theme();

$(document).on("app_ready", () => {
	apply_theme();
	if (core.is_user_disabled()) {
		frappe.show_alert({
			message: "پوسته و دستیار رایا برای شما خاموش است. برای روشن کردن ?raya=on را به آدرس اضافه کنید.",
			indicator: "orange",
		});
		return;
	}
	if (core.assistant_active() && !window.raya.assistant) {
		window.raya.assistant = new Assistant();
	}
});
