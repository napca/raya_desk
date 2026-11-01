// What the assistant knows about the screen: route, open document, list selection and page
// filters. Only identifiers are sent to the server, never field values.

const MAX_SELECTED = 200;

export function get_context() {
	const route = frappe.get_route() || [];
	const ctx = { route: route.slice(0, 3), view: "other", doctype: null, docname: null, selected: [] };

	if (route[0] === "Form" && window.cur_frm && cur_frm.doctype === route[1]) {
		ctx.view = "form";
		ctx.doctype = cur_frm.doctype;
		ctx.docname = cur_frm.docname;
		ctx.is_new = !!cur_frm.is_new();
	} else if (route[0] === "List" && route[1]) {
		ctx.view = "list";
		ctx.doctype = route[1];
		if (window.cur_list && cur_list.doctype === route[1] && cur_list.get_checked_items) {
			ctx.selected = cur_list.get_checked_items(true).slice(0, MAX_SELECTED);
		}
	} else if (route[0] === "query-report" || route[0] === "Report") {
		ctx.view = "report";
		ctx.page = route[1];
	} else if (route[0] === "Workspaces") {
		ctx.view = "workspace";
		ctx.page = route[1];
	} else if (route.length === 1 && frappe.pages && frappe.pages[route[0]]) {
		ctx.view = "page";
		ctx.page = route[0];
		const page_ctx = window.raya_pages && window.raya_pages[route[0]];
		if (page_ctx && page_ctx.get_filters) ctx.filters = page_ctx.get_filters();
	}
	return ctx;
}

export function describe_context(ctx) {
	if (ctx.view === "form") {
		return {
			label: __(ctx.doctype),
			value: ctx.is_new ? "سند جدید (ذخیره‌نشده)" : ctx.docname,
		};
	}
	if (ctx.view === "list") {
		return {
			label: "فهرست " + __(ctx.doctype),
			value: ctx.selected.length ? `${ctx.selected.length.toLocaleString("fa-IR")} ردیف انتخاب‌شده` : "بدون انتخاب",
		};
	}
	if (ctx.view === "page") {
		const wrapper = frappe.pages[ctx.page];
		return { label: "صفحه", value: (wrapper && wrapper.page && wrapper.page.title) || __(ctx.page) };
	}
	if (ctx.view === "workspace" || ctx.view === "report") {
		return { label: ctx.view === "report" ? "گزارش" : "فضای کار", value: __(ctx.page || "") };
	}
	return { label: "صفحه", value: "میز کار" };
}

export function context_key(ctx) {
	return [ctx.view, ctx.doctype, ctx.docname, ctx.page].join("|");
}
