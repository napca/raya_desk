// The global assistant: a floating button and a conversation panel available on every Desk page.
// Conversation text lives in memory only and is dropped on reload.

import { boot_config, esc, ICONS, jdate, money, num, pct, set_user_disabled, storage } from "../core";
import { badge, table } from "../ui";
import { BrowserTextToSpeech, executor, make_stt, ServerAgent } from "./adapters";
import { context_key, describe_context, get_context } from "./context";
import { LABELS, Machine } from "./machine";

export class Assistant {
	constructor() {
		const config = boot_config();
		this.config = config;
		this.machine = new Machine((to, from) => this.on_state(to, from));
		this.stt = make_stt(config.stt_provider, get_context);
		this.agent = new ServerAgent();
		this.tts = new BrowserTextToSpeech();
		this.tts_on = config.allow_tts && storage("tts") === "1" && this.tts.available();
		this.pending = null; // { token, params_hash }
		this.last_request = "";
		this.ctx_key = null;
		this.make();
		this.bind();
		this.refresh_context(true);
	}

	// ---------------------------------------------------------------- render

	make() {
		const logo = esc(this.config.logo_mark);
		this.$fab = $(`<button type="button" class="raya-fab" aria-haspopup="dialog" aria-expanded="false"
				aria-label="دستیار رایا" title="دستیار رایا (Ctrl+Shift+K)">
				<img src="${logo}" alt="">
			</button>`).appendTo(document.body);

		this.$panel = $(`<section class="raya-panel" role="dialog" aria-modal="false" aria-labelledby="raya-panel-title" hidden>
			<header class="raya-panel-head">
				<img src="${logo}" alt="">
				<div>
					<div class="raya-panel-title" id="raya-panel-title">دستیار رایا</div>
					<div class="raya-panel-state" aria-live="polite"></div>
				</div>
				<span class="spacer"></span>
				<button type="button" class="raya-tts" aria-pressed="false" title="پخش صوتی پاسخ‌ها">${ICONS.volume}</button>
				<button type="button" class="raya-clear" title="پاک کردن گفتگو">${ICONS.trash}</button>
				<button type="button" class="raya-close" title="بستن">${ICONS.close}</button>
			</header>
			<div class="raya-context" aria-live="polite"></div>
			<div class="raya-messages" role="log" aria-live="polite"></div>
			<div class="raya-composer">
				<div class="raya-listening" hidden>
					<span class="raya-wave" aria-hidden="true"><i></i><i></i><i></i></span>
					<span class="raya-listening-text">در حال شنیدن…</span>
					<span class="spacer" style="flex:1"></span>
					<button type="button" class="raya-link-btn raya-cancel">لغو</button>
				</div>
				<div class="raya-composer-row">
					<textarea rows="1" aria-label="درخواست خود را بنویسید"
						placeholder="با رایا صحبت کنید یا درخواستتان را بنویسید"></textarea>
					<button type="button" class="raya-icon-btn raya-icon-btn--ghost raya-mic" title="شروع صحبت">${ICONS.mic}</button>
					<button type="button" class="raya-icon-btn raya-send" title="ارسال">${ICONS.send}</button>
				</div>
				<div class="raya-composer-foot">
					<span class="raya-provider"></span>
					<button type="button" class="raya-link-btn raya-theme-off" title="برای عیب‌یابی؛ با ?raya=on برمی‌گردد">خاموش کردن پوسته و دستیار</button>
				</div>
			</div>
		</section>`).appendTo(document.body);

		this.$state = this.$panel.find(".raya-panel-state");
		this.$context = this.$panel.find(".raya-context");
		this.$messages = this.$panel.find(".raya-messages");
		this.$input = this.$panel.find("textarea");
		this.$mic = this.$panel.find(".raya-mic");
		this.$send = this.$panel.find(".raya-send");
		this.$listening = this.$panel.find(".raya-listening");
		this.$panel.find(".raya-tts").attr("aria-pressed", String(!!this.tts_on)).toggle(!!this.config.allow_tts);

		const provider_badges = [];
		if (this.stt.demo) provider_badges.push(badge("گفتار: نمایشی", "demo"));
		if (this.config.agent_provider === "mock") provider_badges.push(badge("ایجنت: نمایشی", "demo"));
		this.$panel.find(".raya-provider").html(provider_badges.join(" "));

		this.welcome();
		this.on_state("idle");
	}

	welcome() {
		this.add(
			"assistant",
			`<div>سلام! درباره صفحه‌ای که باز است بپرسید یا درخواستتان را بگویید.</div>
			${this.config.agent_provider === "mock" ? `<div class="raya-confirm-meta">${badge("نمایشی", "demo")} پاسخ‌ها از قواعد ساده نمایشی می‌آیند، نه از مدل زبانی. داده‌ها و عملیات واقعی هستند و تغییرات فقط پس از تأیید شما انجام می‌شوند.</div>` : ""}
			<div class="raya-chips" style="margin-top:8px">
				${["این فاکتور را توضیح بده", "لیدهایی که سه روز پیگیری نشده‌اند را بیاور", "فروش این ماه را نشان بده"]
					.map((t) => `<button type="button" class="raya-chip" data-text="${esc(t)}">${esc(t)}</button>`)
					.join("")}
			</div>`
		);
	}

	add(kind, html) {
		const $m = $(`<div class="raya-msg raya-msg--${kind}"></div>`).html(html);
		this.$messages.append($m);
		this.scroll();
		return $m;
	}

	scroll() {
		this.$messages.scrollTop(this.$messages[0].scrollHeight);
	}

	on_state(to) {
		if (!this.$panel) return;
		this.$state.text(LABELS[to] || to);
		this.$fab.attr("data-state", to);
		this.$mic.attr("data-state", to);
		const listening = to === "listening" || to === "requesting-permission" || to === "transcribing";
		this.$listening.prop("hidden", !listening && to !== "thinking" && to !== "executing");
		this.$listening.find(".raya-listening-text").text(
			to === "thinking" || to === "executing" ? LABELS[to] + "…" : LABELS[to] + "…"
		);
		this.$listening.find(".raya-cancel").toggle(to !== "executing");
		this.$mic
			.html(to === "listening" ? ICONS.stop : ICONS.mic)
			.attr("title", to === "listening" ? "پایان صحبت" : "شروع صحبت")
			.attr("aria-label", to === "listening" ? "پایان صحبت" : "شروع صحبت")
			.prop("disabled", ["thinking", "executing", "transcribing", "requesting-permission"].includes(to));
		this.$send.prop("disabled", this.machine.is_busy());
		if (to === "cancelled") setTimeout(() => this.machine.state === "cancelled" && this.machine.to("idle"), 600);
	}

	// ----------------------------------------------------------------- events

	bind() {
		this.$fab.on("click", () => this.toggle());
		this.$panel.find(".raya-close").on("click", () => this.toggle(false));
		this.$panel.find(".raya-clear").on("click", () => this.clear());
		this.$panel.find(".raya-cancel").on("click", () => this.cancel("لغو شد."));
		this.$panel.find(".raya-tts").on("click", (e) => {
			this.tts_on = !this.tts_on;
			storage("tts", this.tts_on ? "1" : null);
			$(e.currentTarget).attr("aria-pressed", String(this.tts_on));
			if (!this.tts_on) this.stop_speaking();
		});
		this.$panel.find(".raya-theme-off").on("click", () => {
			set_user_disabled(true);
			window.location.reload();
		});
		this.$mic.on("click", () => (this.machine.state === "listening" ? this.stop_listening() : this.listen()));
		this.$send.on("click", () => this.send());
		this.$input.on("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.send();
			}
		});
		this.$input.on("input", () => this.autosize());
		this.$panel.on("keydown", (e) => {
			if (e.key !== "Escape") return;
			if (this.machine.is_busy()) this.cancel("لغو شد.");
			else this.toggle(false);
		});
		this.$messages.on("click", ".raya-chip", (e) => {
			const $chip = $(e.currentTarget);
			const text = $chip.data("append") ? `${this.last_request} ${$chip.data("append")}` : $chip.data("text");
			this.$input.val(text);
			this.send();
		});

		frappe.router.on("change", () => setTimeout(() => this.refresh_context(), 300));
		// List selection changes update the context line without polling
		$(document).on("change", ".list-row-checkbox, .list-check-all", () => setTimeout(() => this.refresh_context(), 50));

		if (frappe.ui.keys && frappe.ui.keys.add_shortcut) {
			frappe.ui.keys.add_shortcut({
				shortcut: "ctrl+shift+k",
				action: () => this.toggle(true),
				description: "دستیار رایا",
				ignore_inputs: false,
			});
		}
	}

	toggle(open) {
		const show = open === undefined ? this.$panel.prop("hidden") : open;
		this.$panel.prop("hidden", !show);
		this.$fab.attr("aria-expanded", String(show));
		if (show) {
			this.refresh_context();
			setTimeout(() => this.$input.trigger("focus"), 50);
		} else {
			// Closing never leaves the microphone running
			if (["listening", "requesting-permission", "transcribing"].includes(this.machine.state)) this.cancel();
			this.stop_speaking();
			this.$fab.trigger("focus");
		}
	}

	open_with(text) {
		this.toggle(true);
		if (text) {
			this.$input.val(text);
			this.send();
		}
	}

	autosize() {
		const el = this.$input[0];
		el.style.height = "auto";
		el.style.height = Math.min(el.scrollHeight, 120) + "px";
	}

	clear() {
		this.cancel();
		this.$messages.empty();
		this.welcome();
	}

	refresh_context(initial) {
		const ctx = get_context();
		const key = context_key(ctx);
		const d = describe_context(ctx);
		this.$context.html(`<span>زمینه:</span> <strong>${esc(d.label)}</strong> <span>${esc(d.value)}</span>`);
		if (!initial && key !== this.ctx_key && this.ctx_key !== null) {
			if (this.pending) {
				this.cancel_pending("صفحه عوض شد؛ درخواست در انتظار تأیید لغو شد.");
			} else if (this.$messages.children().length > 1) {
				this.add("system", `زمینه به «${esc(d.label)} ${esc(d.value)}» تغییر کرد.`);
			}
		}
		this.ctx_key = key;
		return ctx;
	}

	// ------------------------------------------------------------------ voice

	async listen() {
		if (!this.machine.to("requesting-permission")) return;
		const turn = this.machine.turn;
		this.stop_speaking();
		this.$input.val("");
		try {
			await this.stt.start({
				on_partial: (text) => {
					if (this.machine.turn === turn && this.machine.state === "listening") this.$input.val(text);
				},
			});
			if (this.machine.turn !== turn) return this.stt.cancel();
			this.machine.to("listening");
		} catch (err) {
			if (this.machine.turn !== turn) return;
			this.machine.to("error");
			const denied = err && err.name === "NotAllowedError";
			this.add(
				"error",
				denied
					? "اجازه دسترسی به میکروفن داده نشد. می‌توانید درخواست را تایپ کنید."
					: "میکروفن یا سرویس تشخیص گفتار در دسترس نیست. می‌توانید درخواست را تایپ کنید."
			);
			this.machine.to("idle");
			this.$input.trigger("focus");
		}
	}

	async stop_listening() {
		if (!this.machine.to("transcribing")) return;
		const turn = this.machine.turn;
		try {
			const text = await this.stt.stop();
			if (this.machine.turn !== turn) return;
			this.$input.val(text);
			this.machine.to("idle");
			this.autosize();
			this.$input.trigger("focus");
			if (text) this.add("system", "متن تشخیص‌داده‌شده را بررسی و در صورت نیاز اصلاح کنید، سپس ارسال کنید.");
		} catch (err) {
			if (this.machine.turn !== turn) return;
			this.machine.to("error");
			this.add("error", "تبدیل گفتار به متن ناموفق بود.");
			this.machine.to("idle");
		}
	}

	cancel(message) {
		this.stt.cancel();
		this.stop_speaking();
		if (this.pending) return this.cancel_pending(message || "درخواست لغو شد.");
		if (this.machine.cancel() && message) this.add("system", esc(message));
	}

	stop_speaking() {
		this.tts.stop();
		if (this.machine.state === "speaking") this.machine.to("idle");
	}

	async speak(text) {
		if (!this.tts_on || !text) return this.machine.to("idle");
		if (!this.machine.to("speaking")) return;
		const turn = this.machine.turn;
		await this.tts.speak(text);
		if (this.machine.turn === turn && this.machine.state === "speaking") this.machine.to("idle");
	}

	// ---------------------------------------------------------------- request

	async send() {
		const text = (this.$input.val() || "").trim();
		if (!text || this.machine.is_busy()) return;
		if (this.pending) this.cancel_pending("درخواست قبلی کنار گذاشته شد.");
		if (!this.machine.to("thinking")) return;
		const turn = this.machine.turn;
		const ctx = this.refresh_context();
		this.last_request = text;
		this.$input.val("");
		this.autosize();
		this.add("user", esc(text));

		try {
			const res = await this.agent.interpret(text, ctx);
			if (this.machine.turn !== turn) return;
			const $reply = this.add("assistant", `<div>${esc(res.reply)}</div>`);

			if (res.clarify) {
				const choices = res.clarify.choices || [];
				$reply.append(
					`<div style="margin-top:6px;font-weight:600">${esc(res.clarify.question)}</div>
					${choices.length ? `<div class="raya-chips" style="margin-top:8px">${choices
						.map((c) => `<button type="button" class="raya-chip" data-append="${esc(c)}">${esc(c)}</button>`)
						.join("")}</div>` : ""}
					${res.clarify.link ? `<div class="raya-msg-actions"><a class="btn btn-xs btn-default" href="${esc(res.clarify.link)}">باز کردن صفحه</a></div>` : ""}`
				);
				return this.speak(res.reply + " " + res.clarify.question);
			}
			if (!res.proposal) return this.speak(res.reply);

			const { action, params } = res.proposal;
			const caps = await this.capabilities();
			const spec = caps[action];
			if (!spec) throw new Error("unknown action");

			if (spec.kind === "read") {
				const result = await executor.run(action, params);
				if (this.machine.turn !== turn) return;
				$reply.append(this.render_result(result));
				this.scroll();
				return this.speak(res.reply);
			}

			const preview = await executor.preview(action, params);
			if (this.machine.turn !== turn) {
				executor.cancel(preview.token);
				return;
			}
			this.pending = { token: preview.token, params_hash: preview.params_hash };
			$reply.append(this.render_confirm(preview));
			this.scroll();
			this.machine.to("awaiting-confirmation");
			this.speak_when_waiting(res.reply);
		} catch (err) {
			if (this.machine.turn !== turn) return;
			this.machine.to("error");
			this.add("error", esc(this.error_text(err)));
			this.machine.to("idle");
		}
	}

	speak_when_waiting(text) {
		// Spoken output while a confirmation waits does not leave the awaiting state
		if (this.tts_on && text) this.tts.speak(text);
	}

	async capabilities() {
		if (!this.caps) {
			const res = await executor.capabilities();
			this.caps = Object.fromEntries(res.actions.map((a) => [a.name, a]));
		}
		return this.caps;
	}

	error_text(err) {
		if (!navigator.onLine) return "اتصال برقرار نیست. پس از اتصال دوباره تلاش کنید.";
		const server = err && err._server_messages;
		if (server) {
			try {
				return JSON.parse(JSON.parse(server)[0]).message.replace(/<[^>]+>/g, "");
			} catch (e) {
				// fall through
			}
		}
		if (err && err.exc_type === "PermissionError") return "به این عملیات دسترسی ندارید.";
		return "درخواست انجام نشد. دوباره تلاش کنید.";
	}

	// ----------------------------------------------------------- confirmation

	render_confirm(preview) {
		const p = preview.preview;
		const rows = (p.changes || [])
			.map((c) => `<dt>${esc(c.label)}</dt><dd>${esc(c.value)}</dd>`)
			.join("");
		const skipped = (p.skipped || []).length
			? `<div class="raya-confirm-meta">${num(p.skipped.length)} مورد کنار گذاشته می‌شود: ${p.skipped
					.slice(0, 5)
					.map((s) => esc(s.name))
					.join("، ")}</div>`
			: "";
		const dups = (p.duplicates || []).length
			? `<div class="raya-confirm-meta">${badge("تکراری", "danger")} ${num(p.duplicates.length)} لید شماره یا ایمیل تکراری دارد.</div>`
			: "";
		const $card = $(`<div class="raya-confirm" role="group" aria-label="تأیید عملیات">
			<div class="raya-confirm-title">${esc(preview.label)}</div>
			<div>${esc(p.summary)}</div>
			<dl>${rows}</dl>
			${skipped}${dups}
			<div class="raya-confirm-meta">این پیش‌نمایش تا ${esc(frappe.datetime.str_to_user(preview.expires_on))} معتبر است و فقط با همین پارامترها اجرا می‌شود.</div>
			<div class="raya-msg-actions">
				<button type="button" class="btn btn-primary btn-sm raya-do-confirm" ${p.count ? "" : "disabled"}>تأیید و اجرا</button>
				<button type="button" class="btn btn-default btn-sm raya-do-cancel">انصراف</button>
			</div>
		</div>`);
		$card.find(".raya-do-confirm").on("click", (e) => this.confirm($(e.currentTarget).closest(".raya-confirm")));
		$card.find(".raya-do-cancel").on("click", () => this.cancel_pending("انصراف داده شد؛ تغییری انجام نشد."));
		setTimeout(() => $card.find(".raya-do-confirm").trigger("focus"), 50);
		return $card;
	}

	async confirm($card) {
		if (!this.pending || !this.machine.to("executing")) return;
		const { token, params_hash } = this.pending;
		this.pending = null;
		$card.find("button").prop("disabled", true);
		try {
			const result = await executor.confirm(token, params_hash);
			$card.after(this.render_write_result(result));
			this.scroll();
			this.machine.to("idle");
			this.speak(result.message);
		} catch (err) {
			this.machine.to("error");
			this.add("error", esc(this.error_text(err)));
			this.machine.to("idle");
		}
	}

	cancel_pending(message) {
		const pending = this.pending;
		this.pending = null;
		this.$messages.find(".raya-confirm button").prop("disabled", true);
		if (pending) executor.cancel(pending.token).catch(() => {});
		if (this.machine.state === "awaiting-confirmation") this.machine.to("cancelled");
		if (message) this.add("system", esc(message));
	}

	// ---------------------------------------------------------------- results

	render_write_result(r) {
		const ok = r.status === "Executed";
		const records = (r.records || [])
			.slice(0, 10)
			.map((x) => `<a href="${esc(x.link)}">${esc(x.name)}</a>`)
			.join("، ");
		const failed = (r.failed || []).length
			? `<div class="raya-confirm-meta">${num(r.failed.length)} مورد انجام نشد: ${r.failed
					.slice(0, 5)
					.map((f) => `${esc(f.name)} (${esc(f.reason)})`)
					.join("، ")}</div>`
			: "";
		return `<div class="raya-confirm" style="border-color:${ok ? "var(--raya-success)" : "var(--raya-warning)"}">
			<div class="raya-confirm-title">${ok ? "انجام شد" : "بخشی انجام شد"}</div>
			<div>${esc(r.message)}</div>
			${records ? `<div class="raya-confirm-meta">رکوردها: ${records}</div>` : ""}${failed}
		</div>`;
	}

	render_result(r) {
		const link = (href, label) =>
			href ? `<div class="raya-msg-actions"><a class="btn btn-xs btn-default" href="${esc(href)}">${esc(label)}</a></div>` : "";

		if (r.type === "document") {
			const inv = r.invoice;
			let html = `<div style="margin-top:6px;font-weight:700">${esc(__(r.doctype))}: ${esc(r.title)}</div>`;
			if (inv) {
				html += `<dl>
					<dt>مشتری</dt><dd>${esc(inv.customer)}</dd>
					<dt>تاریخ</dt><dd>${jdate(inv.posting_date)}</dd>
					<dt>سررسید</dt><dd>${jdate(inv.due_date)} ${inv.is_overdue ? badge("سررسید گذشته", "danger") : ""}</dd>
					<dt>وضعیت</dt><dd>${esc(__(inv.status))}</dd>
					<dt>مبلغ کل</dt><dd>${esc(inv.grand_total)}</dd>
					<dt>مانده</dt><dd>${esc(inv.outstanding)}</dd>
					<dt>اقلام</dt><dd>${num(inv.items_count)} قلم</dd>
				</dl>`;
				if (inv.items.length) {
					html += table(
						[
							{ label: "کالا", key: "item" },
							{ label: "مقدار", render: (i) => num(i.qty) },
							{ label: "مبلغ", key: "amount" },
						],
						inv.items
					);
				}
			} else {
				html += `<dl>${r.fields
					.slice(0, 12)
					.map((f) => `<dt>${esc(f.label)}</dt><dd>${f.value}</dd>`)
					.join("")}</dl>`;
			}
			return html + link(r.link, "باز کردن سند");
		}

		if (r.type === "table") {
			const d = r.data;
			if (!d.rows.length) return `<div class="raya-confirm-meta">${esc(r.definition)}</div><div>موردی پیدا نشد.</div>`;
			return `<div class="raya-confirm-meta">${esc(r.definition)}</div>
				<div style="margin:6px 0">${num(d.total)} لید${d.truncated ? " (فقط ۵۰۰ لید قدیمی‌تر بررسی شد)" : ""}</div>
				${table(
					[
						{ label: "لید", render: (x) => `<a href="${esc(x.link)}">${esc(x.lead_name || x.name)}</a>` },
						{ label: "بی‌فعالیت", render: (x) => `${num(x.idle_days)} روز` },
						{ label: "مسئول", render: (x) => esc(x.lead_owner ? frappe.user.full_name(x.lead_owner) : "—") },
					],
					d.rows
				)}${link(r.link, "باز کردن فهرست لیدها")}`;
		}

		if (r.type === "sales") {
			const s = r.data.summary;
			if (!s.current.permitted) return `<div>به فاکتورهای فروش دسترسی ندارید.</div>`;
			const change = s.total_change == null ? "" : ` (${s.total_change >= 0 ? "▲" : "▼"} ${pct(s.total_change)})`;
			let html = `<dl>
				<dt>بازه</dt><dd>${esc(r.data.period_label || "")}${r.data.branch ? " — " + esc(r.data.branch) : ""}</dd>
				<dt>تعداد فاکتور</dt><dd>${num(s.current.count)}</dd>
				<dt>جمع فروش</dt><dd>${money(s.current.total)}${change}</dd>
			</dl>`;
			const rows = (r.data.by_branch.rows || []).slice(0, 5);
			if (rows.length) {
				html += table(
					[
						{ label: "شعبه", render: (x) => esc(x.branch || "بدون شعبه") },
						{ label: "تعداد", render: (x) => num(x.count) },
						{ label: "جمع", render: (x) => money(x.total) },
					],
					rows
				);
			}
			// On the dashboard, the same filters are applied to its charts
			const page = window.raya_pages && window.raya_pages["raya-dashboard"];
			if (page && frappe.get_route()[0] === "raya-dashboard") {
				page.set_filters(r.filters);
				html += `<div class="raya-confirm-meta">فیلترهای داشبورد به همین بازه و شعبه تغییر کرد.</div>`;
			}
			return html + link(r.link, "نمایش در داشبورد");
		}

		if (r.type === "dashboard") {
			const f = r.data.funnel;
			const v = (m) => (m.permitted ? num(m.value) : "—");
			return `<dl>
				<dt>بازه</dt><dd>${esc(r.data.period_label)}</dd>
				<dt>لید ورودی</dt><dd>${v(f.leads_in)}</dd>
				<dt>تخصیص‌یافته</dt><dd>${v(f.leads_assigned)}</dd>
				<dt>تماس</dt><dd>${v(f.calls)}</dd>
				<dt>پیگیری</dt><dd>${v(f.followups)}</dd>
				<dt>قرارداد</dt><dd>${v(f.contracts)}</dd>
				<dt>فروش</dt><dd>${r.data.sales.current.permitted ? money(r.data.sales.current.total) : "—"}</dd>
			</dl>${link(r.link, "باز کردن داشبورد")}`;
		}

		if (r.type === "selection") {
			const statuses = r.by_status
				? Object.entries(r.by_status)
						.map(([k, n]) => `<dt>${esc(__(k))}</dt><dd>${num(n)}</dd>`)
						.join("")
				: "";
			return `<dl><dt>تعداد</dt><dd>${num(r.count)} ${esc(__(r.doctype))}</dd>${statuses}</dl>
				${r.hidden ? `<div class="raya-confirm-meta">${num(r.hidden)} ردیف به دلیل دسترسی نمایش داده نشد.</div>` : ""}`;
		}
		return "";
	}
}

