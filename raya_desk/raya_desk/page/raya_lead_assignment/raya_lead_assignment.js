// Lead assignment in three steps: sources → experts and branch → review and confirm.
// The plan and its execution are the assistant's assign_leads action, so the same server-side
// validation, preview binding and duplicate-run protection apply.

frappe.pages["raya-lead-assignment"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: "تخصیص لید و شماره", single_column: true });
	wrapper.raya_assignment = new RayaAssignment(page);
	window.raya_pages["raya-lead-assignment"] = wrapper.raya_assignment;
};

frappe.pages["raya-lead-assignment"].on_page_show = function (wrapper) {
	window.raya_pages["raya-lead-assignment"] = wrapper.raya_assignment;
};

const STEPS = ["انتخاب منبع", "انتخاب شعبه و کارشناس", "بازبینی و تأیید"];

// Channels that need a backend this app does not ship yet; shown as unavailable, never as working
const UNAVAILABLE_CHANNELS = [
	{ label: "ورود از عکس (OCR)", note: "سرویس OCR متصل نیست" },
	{ label: "اینستاگرام", note: "اتصال اینستاگرام پیاده نشده است" },
];

class RayaAssignment {
	constructor(page) {
		this.page = page;
		this.state = { step: 0, sources: [], users: [], branch: "", only_unassigned: 1, leads: [], preview: null };
		this.$body = $(`<div class="raya-page">
			<div class="raya-stepper-wrap"></div>
			<div class="raya-step-body"></div>
		</div>`).appendTo(page.main);
		this.load();
	}

	get_filters() {
		return { branch: this.state.branch, sources: this.state.sources };
	}

	async load() {
		const { ui } = window.raya;
		this.render_stepper();
		this.$body.find(".raya-step-body").html(ui.state("loading"));
		try {
			this.meta = await window.raya.core.call("raya_desk.api.dashboard.get_assignment_sources", {
				branch: this.state.branch,
				only_unassigned: this.state.only_unassigned,
			});
			this.render();
		} catch (err) {
			this.$body.find(".raya-step-body").html(ui.error_state(err));
		}
	}

	render_stepper() {
		this.$body.find(".raya-stepper-wrap").html(window.raya.ui.stepper(STEPS, this.state.step));
	}

	go(step) {
		this.state.step = step;
		if (step < 2 && this.state.preview) this.discard_preview();
		this.render();
	}

	render() {
		this.render_stepper();
		[this.render_sources, this.render_people, this.render_review][this.state.step].call(this);
		this.$body.find(".raya-step-body").find("button:not([disabled]), a, select, input").first().trigger("focus");
	}

	// ------------------------------------------------------------- step 1

	render_sources() {
		const { ui, core } = window.raya;
		const m = this.meta;
		const selected = new Set(this.state.sources);
		const total = m.sources.filter((s) => selected.has(s.source)).reduce((a, s) => a + s.count, 0);
		const $b = this.$body.find(".raya-step-body").html(`
			<section class="raya-card">
				<div class="raya-card-head">
					<div><h3 class="raya-card-title">منابع لید</h3>
					<div class="raya-card-sub">منبع همان «UTM Source» لید در ERPNext است</div></div>
					<div class="raya-toolbar-group">
						${ui.select("شعبه", m.branches, this.state.branch, "همه شعبه‌ها")}
						<label class="raya-card-sub" style="display:flex;gap:6px;align-items:center;margin:0">
							<input type="checkbox" class="raya-unassigned" ${this.state.only_unassigned ? "checked" : ""}> فقط لیدهای بدون مسئول
						</label>
					</div>
				</div>
				${
					m.sources.length
						? `<div class="raya-toolbar" style="margin-bottom:12px">
							<div class="raya-toolbar-group">
								<button type="button" class="btn btn-default btn-xs raya-all">انتخاب همه</button>
								<button type="button" class="btn btn-default btn-xs raya-none">حذف انتخاب</button>
							</div>
							<div class="raya-card-sub">${core.num(selected.size)} منبع، ${core.num(total)} لید انتخاب شده</div>
						</div>
						<div class="raya-source-grid">${m.sources
							.map(
								(s) => `<button type="button" class="raya-source" data-source="${core.esc(s.source)}"
									aria-pressed="${selected.has(s.source)}">
									<span class="raya-check" aria-hidden="true">✓</span>
									<span class="raya-source-count">${core.num(s.count)}</span>
									<span class="raya-source-name">${core.esc(s.label)}</span>
								</button>`
							)
							.join("")}</div>`
						: ui.state("empty", "لیدی با این فیلترها برای تخصیص وجود ندارد.")
				}
			</section>
			<section class="raya-card">
				<div class="raya-card-head"><h3 class="raya-card-title">ورود لید جدید</h3></div>
				<div class="raya-source-grid">
					<a class="raya-source" href="/desk/data-import/new?reference_doctype=Lead" style="text-decoration:none">
						<span class="raya-source-name">ورود فایل (Excel/CSV)</span>
						<span class="raya-card-sub">با ابزار استاندارد Data Import؛ اعتبارسنجی و گزارش خطا در همان صفحه</span>
					</a>
					${UNAVAILABLE_CHANNELS.map(
						(c) => `<button type="button" class="raya-source" disabled aria-disabled="true">
							<span class="raya-source-name">${core.esc(c.label)}</span>
							<span>${ui.badge("در دسترس نیست", "muted")}</span>
							<span class="raya-card-sub">${core.esc(c.note)}</span>
						</button>`
					).join("")}
				</div>
			</section>
			<div class="raya-toolbar">
				<span></span>
				<button type="button" class="btn btn-primary raya-next" ${selected.size ? "" : "disabled"}>ادامه</button>
			</div>`);

		$b.find(".raya-source[data-source]").on("click", (e) => {
			const src = $(e.currentTarget).data("source");
			const set = new Set(this.state.sources);
			set.has(src) ? set.delete(src) : set.add(src);
			this.state.sources = [...set];
			this.render_sources();
		});
		$b.find(".raya-all").on("click", () => {
			this.state.sources = m.sources.map((s) => s.source);
			this.render_sources();
		});
		$b.find(".raya-none").on("click", () => {
			this.state.sources = [];
			this.render_sources();
		});
		$b.find("select").on("change", (e) => {
			this.state.branch = e.target.value;
			this.state.sources = [];
			this.load();
		});
		$b.find(".raya-unassigned").on("change", (e) => {
			this.state.only_unassigned = e.target.checked ? 1 : 0;
			this.state.sources = [];
			this.load();
		});
		$b.find(".raya-next").on("click", () => this.fetch_leads());
	}

	async fetch_leads() {
		const { ui } = window.raya;
		this.$body.find(".raya-step-body").html(ui.state("loading"));
		try {
			const r = await window.raya.core.call("raya_desk.api.dashboard.get_source_leads", {
				sources: this.state.sources,
				branch: this.state.branch,
				only_unassigned: this.state.only_unassigned,
			});
			this.state.leads = r.leads.map((l) => l.name);
			this.state.truncated = r.truncated;
			this.state.limit = r.limit;
			this.go(1);
		} catch (err) {
			this.$body.find(".raya-step-body").html(ui.error_state(err));
		}
	}

	// ------------------------------------------------------------- step 2

	render_people() {
		const { ui, core } = window.raya;
		const m = this.meta;
		const chosen = new Set(this.state.users);
		const per = chosen.size ? Math.ceil(this.state.leads.length / chosen.size) : 0;
		const $b = this.$body.find(".raya-step-body").html(`
			<section class="raya-card">
				<div class="raya-card-head">
					<div><h3 class="raya-card-title">کارشناس‌ها</h3>
					<div class="raya-card-sub">${core.num(this.state.leads.length)} لید به‌صورت نوبتی بین کارشناس‌های انتخاب‌شده تقسیم می‌شود
					${this.state.truncated ? ` (حداکثر ${core.num(this.state.limit)} لید در هر نوبت)` : ""}</div></div>
					${ui.select("شعبه مقصد", m.branches, this.state.branch, "بدون تغییر شعبه")}
				</div>
				${
					m.users.length
						? `<div class="raya-source-grid">${m.users
								.map(
									(u) => `<button type="button" class="raya-source" data-user="${core.esc(u.name)}" aria-pressed="${chosen.has(u.name)}">
										<span class="raya-check" aria-hidden="true">✓</span>
										<span class="raya-source-name">${core.esc(u.full_name || u.name)}</span>
										<span class="raya-card-sub raya-ltr">${core.esc(u.name)}</span>
										${chosen.has(u.name) ? `<span class="raya-badge">حدود ${core.num(per)} لید</span>` : ""}
									</button>`
								)
								.join("")}</div>`
						: ui.state(
								"empty",
								"کاربری با نقش Sales User یا Sales Manager وجود ندارد.",
								`<a class="btn btn-default btn-xs" href="/desk/user">مدیریت کاربران</a>`
						  )
				}
			</section>
			<div class="raya-toolbar">
				<button type="button" class="btn btn-default raya-back">بازگشت</button>
				<button type="button" class="btn btn-primary raya-next" ${chosen.size && m.can_assign ? "" : "disabled"}>پیش‌نمایش تخصیص</button>
			</div>
			${m.can_assign ? "" : ui.state("forbidden", "اجازه ویرایش لید را ندارید؛ تخصیص ممکن نیست.")}`);

		$b.find(".raya-source[data-user]").on("click", (e) => {
			const u = $(e.currentTarget).data("user");
			const set = new Set(this.state.users);
			set.has(u) ? set.delete(u) : set.add(u);
			this.state.users = m.users.map((x) => x.name).filter((n) => set.has(n));
			this.render_people();
		});
		$b.find("select").on("change", (e) => (this.state.branch = e.target.value));
		$b.find(".raya-back").on("click", () => this.go(0));
		$b.find(".raya-next").on("click", () => this.preview());
	}

	async preview() {
		const { ui } = window.raya;
		this.$body.find(".raya-step-body").html(ui.state("loading"));
		try {
			const params = { leads: this.state.leads, users: this.state.users };
			if (this.state.branch) params.branch = this.state.branch;
			this.state.preview = await window.raya.core.call("raya_desk.assistant.api.preview_action", {
				action: "assign_leads",
				params,
			});
			this.go(2);
		} catch (err) {
			this.$body.find(".raya-step-body").html(ui.error_state(err));
			this.$body.find(".raya-step-body").append(`<div class="raya-toolbar"><button class="btn btn-default raya-back">بازگشت</button></div>`);
			this.$body.find(".raya-back").on("click", () => this.go(1));
		}
	}

	discard_preview() {
		const token = this.state.preview && this.state.preview.token;
		this.state.preview = null;
		if (token) window.raya.core.call("raya_desk.assistant.api.cancel_action", { token }).catch(() => {});
	}

	// ------------------------------------------------------------- step 3

	render_review() {
		const { ui, core } = window.raya;
		const pv = this.state.preview;
		const p = pv.preview;
		const users = Object.fromEntries(this.meta.users.map((u) => [u.name, u.full_name || u.name]));
		const $b = this.$body.find(".raya-step-body").html(`
			<section class="raya-card">
				<div class="raya-card-head">
					<div><h3 class="raya-card-title">${core.esc(p.summary)}</h3>
					<div class="raya-card-sub">پیش‌نمایش تا ${core.esc(frappe.datetime.str_to_user(pv.expires_on))} معتبر است. لیدهایی که پس از این پیش‌نمایش ویرایش شوند تغییر نمی‌کنند.</div></div>
				</div>
				<div class="raya-row" style="--cols:4;margin-bottom:16px">
					${p.changes.map((c) => ui.stat_card({ label: c.label, value: core.esc(core.fa_digits(c.value)) })).join("")}
				</div>
				${p.duplicates.length ? `<p>${ui.badge("تکراری", "danger")} ${core.num(p.duplicates.length)} لید شماره تماس یا ایمیل مشترک با لید دیگری دارد. پیش از تأیید بررسی کنید.</p>` : ""}
				${p.skipped.length ? `<p>${ui.badge(core.num(p.skipped.length) + " کنار گذاشته", "muted")} ${p.skipped.slice(0, 8).map((s) => core.esc(s.name)).join("، ")}</p>` : ""}
				${ui.table(
					[
						{ label: "لید", render: (r) => `<a href="${core.doc_url("Lead", r.lead)}" target="_blank">${core.esc(r.lead_name || r.lead)}</a>` },
						{ label: "مسئول فعلی", render: (r) => core.esc(r.current_owner ? frappe.user.full_name(r.current_owner) : "—") },
						{ label: "کارشناس جدید", render: (r) => core.esc(users[r.user] || r.user) },
						{ label: "", render: (r) => (r.duplicate ? ui.badge("تکراری", "danger") : "") },
					],
					p.plan.slice(0, 100)
				)}
				${p.plan.length > 100 ? `<div class="raya-card-sub" style="margin-top:8px">۱۰۰ ردیف اول از ${core.num(p.plan.length)} نمایش داده شده است.</div>` : ""}
			</section>
			<div class="raya-toolbar">
				<button type="button" class="btn btn-default raya-back">بازگشت و تغییر</button>
				<button type="button" class="btn btn-primary raya-confirm" ${p.count ? "" : "disabled"}>تأیید و تخصیص ${core.num(p.count)} لید</button>
			</div>
			<div class="raya-result"></div>`);

		$b.find(".raya-back").on("click", () => this.go(1));
		$b.find(".raya-confirm").on("click", (e) => this.confirm($(e.currentTarget)));
	}

	async confirm($btn) {
		const { ui, core } = window.raya;
		const pv = this.state.preview;
		$btn.prop("disabled", true);
		this.$body.find(".raya-back").prop("disabled", true);
		try {
			const r = await window.raya.core.call("raya_desk.assistant.api.confirm_action", {
				token: pv.token,
				params_hash: pv.params_hash,
			});
			this.state.preview = null;
			const failed = r.failed || [];
			this.$body.find(".raya-result").html(`<section class="raya-card">
				<div class="raya-card-head"><h3 class="raya-card-title">${r.status === "Executed" ? "تخصیص انجام شد" : "تخصیص بخشی از لیدها انجام شد"}</h3></div>
				<p>${core.esc(r.message)}</p>
				${failed.length ? ui.table(
					[{ label: "لید", key: "name" }, { label: "علت", key: "reason" }],
					failed
				) : ""}
				<div class="raya-msg-actions">
					<a class="btn btn-default btn-sm" href="/desk/lead?_assign=%5B%22like%22%2C%22%25${encodeURIComponent(this.state.users[0] || "")}%25%22%5D">مشاهده در فهرست لید</a>
					<button type="button" class="btn btn-primary btn-sm raya-restart">تخصیص جدید</button>
				</div>
			</section>`);
			this.$body.find(".raya-restart").on("click", () => {
				this.state = { step: 0, sources: [], users: [], branch: "", only_unassigned: 1, leads: [], preview: null };
				this.load();
			});
		} catch (err) {
			$btn.prop("disabled", false);
			this.$body.find(".raya-back").prop("disabled", false);
			this.$body.find(".raya-result").html(ui.error_state(err));
		}
	}
}
