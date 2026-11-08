import frappe

LOGO_MARK = "/assets/raya_desk/images/raya-mark.png"
LOGO_FULL = "/assets/raya_desk/images/raya-logo-full.png"


def boot_session(bootinfo):
	if frappe.session.user == "Guest":
		return

	settings = frappe.get_cached_doc("Raya Desk Settings")
	bootinfo.raya_desk = {
		"theme_enabled": bool(settings.enable_theme),
		"assistant_enabled": bool(settings.enable_assistant),
		"agent_provider": settings.agent_provider or "mock",
		"stt_provider": settings.stt_provider or "mock",
		"allow_tts": bool(settings.allow_tts),
		"logo_mark": LOGO_MARK,
		"logo_full": LOGO_FULL,
		"timezone": frappe.utils.get_system_timezone(),
		# Records created by raya_desk.dev.seed carry this tag; pages show a "نمونه" badge while any exist
		"sample_data": bool(frappe.db.exists("Tag Link", {"tag": "Raya Sample"})),
	}

	if settings.enable_theme:
		bootinfo.app_logo_url = LOGO_MARK
		# Organisation branding must not replace each application's own launcher icon.
