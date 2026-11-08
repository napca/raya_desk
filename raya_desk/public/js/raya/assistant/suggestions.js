// Suggest only operations the current provider actually supports in this context.
// Read/write permissions are hints for discovery; the server remains authoritative.
export function suggestions_for(ctx, can_read = () => true, can_write = () => true) {
	if (ctx.view === "form") {
		if (ctx.is_new || !ctx.docname) return [];
		const suggestions = [ctx.doctype === "Sales Invoice" ? "این فاکتور را توضیح بده" : "این سند را خلاصه کن"];
		if (["Lead", "Customer", "Opportunity"].includes(ctx.doctype) && can_write("ToDo")) {
			suggestions.push("برای این مورد فردا ساعت ده پیگیری ثبت کن");
		}
		return can_read(ctx.doctype) ? suggestions : [];
	}
	if (ctx.view === "list") {
		if (!can_read(ctx.doctype)) return [];
		if (ctx.selected?.length) {
			const suggestions = ["ردیف‌های انتخاب‌شده را خلاصه کن"];
			if (ctx.doctype === "Lead" && can_write("Lead")) suggestions.push("این لیدهای انتخاب‌شده را تقسیم کن");
			return suggestions;
		}
		return ctx.doctype === "Lead" ? ["لیدهایی که سه روز پیگیری نشده‌اند را بیاور"] : [];
	}
	const sales_surface = ctx.page === "raya-dashboard" ||
		(ctx.view === "workspace" && ["Selling", "Raya"].includes(ctx.page)) ||
		(ctx.view === "report" && ["Sales Analytics", "Sales Register"].includes(ctx.page));
	if (sales_surface && can_read("Sales Invoice")) return ["فروش این ماه را نشان بده", "فروش امروز را نشان بده"];
	return [];
}
