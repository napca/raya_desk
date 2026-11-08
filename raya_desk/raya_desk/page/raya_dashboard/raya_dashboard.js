// Raya dashboard: live ERPNext figures for the chosen period and branch.
// Metric definitions live in raya_desk/api/metrics.py and docs/data-mapping.md.

frappe.pages["raya-dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "داشبورد مدیریت مشتریان",
		single_column: true,
	});
	wrapper.raya_dashboard = new RayaDashboard(page, wrapper);
	window.raya_pages["raya-dashboard"] = wrapper.raya_dashboard;
};

frappe.pages["raya-dashboard"].on_page_show = function (wrapper) {
	const dash = wrapper.raya_dashboard;
	if (!dash) return;
	window.raya_pages["raya-dashboard"] = dash;
	const params = new URLSearchParams(window.location.search);
	if (params.get("period") || params.get("branch")) {
		dash.set_filters({ period: params.get("period"), branch: params.get("branch") });
	}
};

const FUNNEL = [
	{ key: "leads_in", label: "ورودی", icon: "inbox", route: ["List", "Lead"] },
	{ key: "leads_assigned", label: "تخصیص", icon: "users", route: ["List", "Lead"] },
	{ key: "calls", label: "تماس", icon: "phone", route: ["List", "Call Log"], key_step: true },
	{ key: "followups", label: "پیگیری", icon: "clipboard", route: ["List", "ToDo"] },
	{ key: "contracts", label: "قرارداد", icon: "file", route: ["List", "Contract"] },
];

class RayaDashboard {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		const { core } = window.raya;
		const params = new URLSearchParams(window.location.search);
		this.filters = {
			period: params.get("period") || core.storage("dash_period") || "month",
			branch: params.get("branch") || core.storage("dash_branch") || "",
		};
		this.trend_series = "leads";
		this.page.set_secondary_action("بازخوانی", () => this.refresh(), "refresh");
		this.make();
		this.load_filters().then(() => this.refresh());
	}

	get_filters() {
		return { ...this.filters };
	}

	set_filters({ period, branch }) {
		let changed = false;
		if (period && period !== this.filters.period) {
			this.filters.period = period;
			changed = true;
		}
		if (branch !== undefined && branch !== null && (branch || "") !== this.filters.branch) {
			this.filters.branch = branch || "";
			changed = true;
		}
		if (changed) {
			this.render_filters();
			this.refresh();
		}
	}

	make() {
		const { core } = window.raya;
		this.$body = $(`<div class="raya-page">
			<div class="raya-toolbar">
				<div class="raya-toolbar-group raya-period"></div>
				<div class="raya-toolbar-group raya-branch">${
					core.boot_config().sample_data
						? window.raya.ui.badge("نمونه: این سایت داده نمونه توسعه دارد", "sample")
						: ""
				}<span class="raya-branch-select"></span></div>
			</div>
			<div class="raya-card raya-hero-card" style="padding:0">
				<div class="raya-hero-heading"><div><h3 class="raya-card-title">دستیار رایا</h3><p class="raya-card-sub">درخواستتان را بنویسید یا با میکروفن شروع کنید</p></div><span class="raya-hero-status"></span></div>
				<form class="raya-hero" autocomplete="off">
					<button type="button" class="raya-icon-btn raya-hero-mic" title="شروع صحبت با رایا" aria-label="شروع صحبت با رایا">${core.ICONS.mic}</button>
					<input class="raya-hero-input" type="text" aria-label="درخواست از رایا"
						placeholder="درخواستتان را بنویسید…">
					<button type="submit" class="raya-icon-btn raya-icon-btn--ghost" title="ارسال" aria-label="ارسال">${core.ICONS.send}</button>
				</form>
				<div class="raya-chips" style="padding:0 16px 14px">
					${[
						"فروش این ماه را نشان بده",
						"لیدهایی که سه روز پیگیری نشده‌اند را بیاور",
						"آمار امروز را نشان بده",
					]
						.map((t) => `<button type="button" class="raya-chip" data-text="${core.esc(t)}">${core.esc(t)}</button>`)
						.join("")}
				</div>
			</div>
			<section class="raya-card raya-card--dark" aria-labelledby="raya-mkt">
				<div class="raya-card-head">
					<div><h3 class="raya-card-title" id="raya-mkt">مسیر فروش</h3><div class="raya-card-sub">از ورود لید تا ثبت قرارداد</div></div>
					<span class="raya-period-badge"></span>
				</div>
				<div class="raya-funnel-body"></div>
			</section>
			<section class="raya-card raya-card--tint" aria-labelledby="raya-sales">
				<div class="raya-card-head">
					<div><h3 class="raya-card-title" id="raya-sales">فروش</h3><div class="raya-card-sub">فاکتورهای فروش ثبت‌نهایی‌شده، بدون مرجوعی</div></div>
					<span class="raya-period-badge"></span>
				</div>
				<div class="raya-row raya-sales-body" style="--cols:4"></div>
			</section>
			<div class="raya-row raya-row--stack-md" style="--cols:3">
				<section class="raya-card" style="grid-column: span 2" aria-labelledby="raya-trend">
					<div class="raya-card-head">
						<h3 class="raya-card-title" id="raya-trend">روند</h3>
						<div class="raya-trend-switch"></div>
					</div>
					<div class="raya-chart"></div>
				</section>
				<section class="raya-card" aria-labelledby="raya-tasks">
					<div class="raya-card-head">
						<h3 class="raya-card-title" id="raya-tasks">کارهای امروز من</h3>
						<a class="raya-card-sub" href="/desk/todo?status=Open">همه</a>
					</div>
					<div class="raya-tasks-body"></div>
				</section>
			</div>
			<div class="raya-row raya-row--stack-md" style="--cols:2">
				<section class="raya-card" aria-labelledby="raya-stale">
					<div class="raya-card-head">
						<div><h3 class="raya-card-title" id="raya-stale">لیدهای نیازمند پیگیری</h3>
						<div class="raya-card-sub">بیش از ۳ روز بدون فعالیت و بدون پیگیری برنامه‌ریزی‌شده</div></div>
					</div>
					<div class="raya-stale-body"></div>
				</section>
				<section class="raya-card" aria-labelledby="raya-branches">
					<div class="raya-card-head">
						<h3 class="raya-card-title" id="raya-branches">عملکرد شعب</h3>
						<span class="raya-period-badge"></span>
					</div>
					<div class="raya-branches-body"></div>
				</section>
			</div>
		</div>`).appendTo(this.page.main);

		this.$body.find(".raya-hero").on("submit", (e) => {
			e.preventDefault();
			const text = this.$body.find(".raya-hero-input").val().trim();
			this.ask(text);
			this.$body.find(".raya-hero-input").val("");
		});
		this.$body.find(".raya-hero-mic").on("click", () => {
			const a = window.raya.assistant;
			if (!a) return this.no_assistant();
			a.toggle(true);
			a.listen();
		});
		this.$body.on("click", ".raya-chip", (e) => this.ask($(e.currentTarget).data("text")));
		this.$body.on("click", ".raya-funnel-step[data-route]", (e) => {
			frappe.set_route($(e.currentTarget).data("route").split("|"));
		});
		this.$body.on("keydown", ".raya-funnel-step[data-route]", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				$(e.currentTarget).trigger("click");
			}
		});
		this.update_hero_status();
		$(document).off("raya-assistant-state.rayaDashboard").on("raya-assistant-state.rayaDashboard", (_event, label) => this.update_hero_status(label));
	}

	ask(text) {
		const a = window.raya.assistant;
		if (!a) return this.no_assistant();
		a.open_with(text);
	}

	no_assistant() {
		frappe.msgprint("دستیار در تنظیمات Raya Desk غیرفعال است.");
	}

	update_hero_status(label) {
		const { core, ui } = window.raya;
		const cfg = core.boot_config();
		const parts = [];
		if (!window.raya.assistant) parts.push("دستیار غیرفعال");
		else {
			parts.push(label || "دستیار آماده");
			if (cfg.agent_provider === "mock") parts.push(ui.badge("نمایشی", "demo"));
		}
		this.$body.find(".raya-hero-status").html(parts.join(" "));
	}

	async load_filters() {
		try {
			this.options = await window.raya.core.call("raya_desk.api.dashboard.get_filters");
		} catch (e) {
			this.options = { branches: [], periods: [] };
		}
		this.render_filters();
	}

	render_filters() {
		const { ui, core } = window.raya;
		const periods = (this.options && this.options.periods) || [];
		this.$body.find(".raya-period").html(ui.segmented("بازه زمانی", periods, this.filters.period));
		this.$body.find(".raya-branch-select").html(
			ui.select("شعبه", (this.options && this.options.branches) || [], this.filters.branch, "همه شعبه‌ها")
		);
		this.$body.find(".raya-period button").on("click", (e) => {
			this.filters.period = $(e.currentTarget).data("value");
			core.storage("dash_period", this.filters.period);
			this.render_filters();
			this.refresh();
		});
		this.$body.find(".raya-branch select").on("change", (e) => {
			this.filters.branch = e.target.value;
			core.storage("dash_branch", this.filters.branch || null);
			this.refresh();
		});
	}

	async refresh() {
		const { ui } = window.raya;
		this.update_hero_status();
		const loading = ui.state("loading");
		this.$body
			.find(".raya-funnel-body, .raya-sales-body, .raya-chart, .raya-tasks-body, .raya-stale-body, .raya-branches-body")
			.html(loading);
		const seq = (this.seq = (this.seq || 0) + 1);
		try {
			const data = await window.raya.core.call("raya_desk.api.dashboard.get_dashboard", this.filters);
			if (seq !== this.seq) return;
			this.data = data;
			this.render(data);
		} catch (err) {
			if (seq !== this.seq) return;
			const html = ui.error_state(err);
			this.$body
				.find(".raya-funnel-body, .raya-sales-body, .raya-chart, .raya-tasks-body, .raya-stale-body, .raya-branches-body")
				.html(html);
		}
	}

	render(d) {
		const { ui, core } = window.raya;
		const range = d.from_date
			? `${core.jdate(d.from_date, true)} تا ${core.jdate(d.to_date, true)}`
			: `تا ${core.jdate(d.to_date, true)}`;
		this.$body.find(".raya-period-badge").html(ui.badge(`${d.period_label} · ${range}`, "muted"));

		// Funnel
		const permitted = FUNNEL.filter((step) => d.funnel[step.key].permitted);
		const empty = permitted.length > 0 && permitted.every((step) => !d.funnel[step.key].value);
		this.$body.find(".raya-funnel-body").closest("section").toggleClass("raya-funnel-empty", empty);
		this.$body.find(".raya-funnel-body").html(`<div class="raya-funnel">${FUNNEL.map((s) => {
			const m = d.funnel[s.key];
			const note = !m.permitted ? "دسترسی ندارید" : d.branch && !m.branch_applied ? "بدون فیلتر شعبه" : "";
			return `<div class="raya-funnel-step ${s.key_step ? "is-key" : ""}" role="link" tabindex="0"
				data-route="${s.route.join("|")}" style="cursor:pointer">
				<div class="raya-hex" aria-hidden="true">${core.ICONS[s.icon]}</div>
				<div class="raya-funnel-label">${s.label}</div>
				<div class="raya-funnel-value">${m.permitted ? core.num(m.value) : "—"}</div>
				${note ? `<div class="raya-funnel-note">${note}</div>` : ""}
			</div>`;
		}).join("")}</div>${empty ? '<p class="raya-funnel-empty-note">در این بازه فعالیتی ثبت نشده است. بازه یا شعبه را تغییر دهید، یا از فهرست لیدها شروع کنید.</p>' : ""}`);

		// Sales cards
		const s = d.sales;
		const cur = s.current;
		const avg = cur.permitted && cur.count ? cur.total / cur.count : null;
		const currency = core.boot_config().currency || frappe.boot.sysdefaults.currency || "";
		const unit = currency === "IRR" ? "ریال" : currency;
		const unit_label = unit ? ` (${unit})` : "";
		const contracts = d.funnel.contracts;
		this.$body.find(".raya-sales-body").html(
			[
				ui.stat_card({
					label: "تعداد فاکتور",
					value: core.num(cur.count),
					foot: ui.delta(s.count_change),
					permitted: cur.permitted,
				}),
				ui.stat_card({
					label: "مبلغ فروش" + unit_label,
					value: core.num(cur.total),
					foot: ui.delta(s.total_change),
					permitted: cur.permitted,
				}),
				ui.stat_card({
					label: "میانگین هر فاکتور" + unit_label,
					value: avg == null ? "—" : core.num(avg),
					foot: `<span class="raya-stat-foot">مبلغ فروش ÷ تعداد فاکتور</span>`,
					permitted: cur.permitted,
				}),
				ui.stat_card({
					label: "قرارداد جدید",
					value: core.num(contracts.value),
					foot: `<span class="raya-stat-foot">قراردادهای ایجادشده در بازه</span>`,
					permitted: contracts.permitted,
				}),
			].join("")
		);

		this.render_trend(d.trend);
		this.render_tasks(d.tasks);
		this.render_stale(d.stale_leads);
		this.render_branches(d.sales_by_branch);
	}

	render_trend(trend) {
		const { ui, core } = window.raya;
		const series = { leads: { label: "لید", data: trend.leads }, sales: { label: "فروش (مبلغ)", data: trend.sales } };
		const available = Object.entries(series).filter(([, v]) => v.data);
		if (!available.length) return this.$body.find(".raya-chart").html(ui.state("forbidden", "به داده‌های روند دسترسی ندارید."));
		if (!series[this.trend_series].data) this.trend_series = available[0][0];

		const $switch = this.$body.find(".raya-trend-switch");
		$switch.html(
			ui.segmented(
				"سری نمودار",
				available.map(([k, v]) => ({ value: k, label: v.label })),
				this.trend_series
			)
		);
		$switch.find("button").on("click", (e) => {
			this.trend_series = $(e.currentTarget).data("value");
			this.render_trend(trend);
		});

		const values = series[this.trend_series].data;
		const $chart = this.$body.find(".raya-chart").empty();
		if (!values.some((v) => v)) {
			return $chart.html(ui.state("empty", "در این بازه داده‌ای ثبت نشده است."));
		}
		const labels = trend.labels.map((l) => core.fa_digits(trend.by_month ? l : l.slice(5)));
		new frappe.Chart($chart[0], {
			type: this.trend_series === "sales" ? "bar" : "line",
			data: { labels, datasets: [{ name: series[this.trend_series].label, values }] },
			colors: ["#16786F"],
			height: 240,
			axisOptions: { xIsSeries: true, shortenYAxisNumbers: true, xAxisMode: "tick" },
			lineOptions: { regionFill: 1, hideDots: labels.length > 20 },
			barOptions: { spaceRatio: 0.4 },
			tooltipOptions: { formatTooltipY: (v) => (this.trend_series === "sales" ? core.money(v) : core.num(v)) },
		});
	}

	render_tasks(tasks) {
		const { ui, core } = window.raya;
		const $el = this.$body.find(".raya-tasks-body");
		if (!tasks.length) return $el.html(ui.state("empty", "کار باز امروز یا معوقی ندارید."));
		$el.html(`<ul class="raya-list">${tasks
			.map((t) => {
				const text = $("<div>").html(t.description || "").text().slice(0, 80);
				const overdue = t.date < frappe.datetime.get_today();
				return `<li class="raya-list-item">
					<a href="${core.route_url("todo", t.name)}">${core.esc(text || t.name)}</a>
					<span class="meta">${overdue ? ui.badge("معوق", "danger") : ui.badge("امروز")}</span>
				</li>`;
			})
			.join("")}</ul>`);
	}

	render_stale(stale) {
		const { ui, core } = window.raya;
		const $el = this.$body.find(".raya-stale-body");
		if (!stale.permitted) return $el.html(ui.state("forbidden", "به لیدها دسترسی ندارید."));
		if (!stale.rows.length) return $el.html(ui.state("empty", "لید فعالی بدون پیگیری نمانده است."));
		$el.html(
			`<ul class="raya-list">${stale.rows
				.map(
					(r) => `<li class="raya-list-item">
					<a href="${core.doc_url("Lead", r.name)}">${core.esc(r.lead_name || r.company_name || r.name)}</a>
					<span class="meta">${core.num(r.idle_days)} روز · ${core.esc(r.lead_owner ? frappe.user.full_name(r.lead_owner) : "بدون مسئول")}</span>
				</li>`
				)
				.join("")}</ul>
			${stale.total > stale.rows.length ? `<div class="raya-card-sub" style="margin-top:8px">${core.num(stale.total)} لید در مجموع؛ از دستیار بخواهید فهرست کامل را نشان دهد.</div>` : ""}`
		);
	}

	render_branches(by_branch) {
		const { ui, core } = window.raya;
		const $el = this.$body.find(".raya-branches-body");
		if (!by_branch.permitted) return $el.html(ui.state("forbidden", "به فاکتورهای فروش دسترسی ندارید."));
		if (!by_branch.rows.length) return $el.html(ui.state("empty", "در این بازه فاکتوری ثبت نشده است."));
		$el.html(
			ui.table(
				[
					{ label: "شعبه", render: (r) => core.esc(r.branch || "بدون شعبه") },
					{ label: "تعداد فاکتور", render: (r) => core.num(r.count) },
					{ label: "جمع فروش", render: (r) => core.money(r.total) },
				],
				by_branch.rows
			)
		);
	}
}
