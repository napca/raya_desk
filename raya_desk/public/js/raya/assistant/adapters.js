// Provider adapters. Each layer has one small contract so a streaming or request/response
// provider can replace the demo without touching the panel:
//
//   SpeechToText  { id, label, demo, available(), start({ on_partial }) → Promise, stop() → Promise<text>, cancel() }
//   Agent         { id, demo, interpret(text, context) → Promise<{ reply, proposal?, clarify?, demo }> }
//   TextToSpeech  { id, label, demo, available(), speak(text) → Promise, stop() }
//   Executor      { run(action, params), preview(action, params), confirm(token, hash), cancel(token) }
//
// The agent and executor talk only to raya_desk.assistant.api; provider keys never reach the browser.

import { call } from "../core";

const API = "raya_desk.assistant.api.";

// ------------------------------------------------------------- speech to text

// Demo recogniser: simulates permission, partial results and a final transcript for the
// current page. Clearly labelled; it never touches the microphone.
export class MockSpeechToText {
	constructor(get_context) {
		this.id = "mock";
		this.label = "گفتار نمایشی (بدون میکروفن)";
		this.demo = true;
		this.get_context = get_context;
		this.timers = [];
	}

	available() {
		return true;
	}

	phrase() {
		const ctx = this.get_context();
		if (ctx.view === "form" && ctx.doctype === "Sales Invoice") return "این فاکتور را توضیح بده";
		if (ctx.view === "form" && ["Lead", "Customer", "Opportunity"].includes(ctx.doctype))
			return "برای این مورد فردا ساعت ده پیگیری ثبت کن";
		if (ctx.view === "list" && ctx.doctype === "Lead" && ctx.selected && ctx.selected.length)
			return "این لیدهای انتخاب‌شده را تقسیم کن";
		if (ctx.doctype === "Lead") return "لیدهایی که سه روز پیگیری نشده‌اند را بیاور";
		return "فروش این ماه را نشان بده";
	}

	start({ on_partial }) {
		this.cancel();
		this.text = this.phrase();
		const words = this.text.split(" ");
		return new Promise((resolve) => {
			this.timers.push(
				setTimeout(() => {
					resolve();
					words.forEach((_, i) =>
						this.timers.push(
							setTimeout(() => on_partial && on_partial(words.slice(0, i + 1).join(" ")), 250 * (i + 1))
						)
					);
				}, 400)
			);
		});
	}

	stop() {
		this.cancel();
		return new Promise((resolve) => setTimeout(() => resolve(this.text || ""), 350));
	}

	cancel() {
		this.timers.forEach(clearTimeout);
		this.timers = [];
	}
}

// Web Speech API, when the browser offers it. Chrome sends the audio to its own speech service,
// which the label says. Needs HTTPS outside localhost.
export class BrowserSpeechToText {
	constructor() {
		this.id = "browser";
		this.label = "تشخیص گفتار مرورگر";
		this.demo = false;
		this.Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
	}

	available() {
		return !!this.Impl && window.isSecureContext;
	}

	start({ on_partial }) {
		return new Promise((resolve, reject) => {
			const rec = new this.Impl();
			this.rec = rec;
			this.final = "";
			this.interim = "";
			rec.lang = "fa-IR";
			rec.interimResults = true;
			rec.continuous = true;
			rec.onstart = () => resolve();
			rec.onerror = (e) => {
				const err = new Error(e.error);
				err.name = e.error === "not-allowed" ? "NotAllowedError" : e.error;
				reject(err);
				this.on_end && this.on_end(err);
			};
			rec.onresult = (event) => {
				let interim = "";
				for (let i = event.resultIndex; i < event.results.length; i++) {
					const r = event.results[i];
					if (r.isFinal) this.final += r[0].transcript;
					else interim += r[0].transcript;
				}
				this.interim = interim;
				on_partial && on_partial((this.final + " " + interim).trim());
			};
			rec.onend = () => this.on_end && this.on_end();
			rec.start();
		});
	}

	stop() {
		return new Promise((resolve) => {
			if (!this.rec) return resolve("");
			this.on_end = () => resolve((this.final + " " + this.interim).trim());
			this.rec.stop();
		});
	}

	cancel() {
		if (this.rec) {
			this.on_end = null;
			this.rec.abort();
			this.rec = null;
		}
	}
}

// ---------------------------------------------------------------------- agent

export class ServerAgent {
	constructor() {
		this.id = "server";
	}

	interpret(text, context) {
		return call(API + "interpret", { text, context });
	}
}

// --------------------------------------------------------------- text to speech

export class BrowserTextToSpeech {
	constructor() {
		this.id = "browser";
		this.label = "پخش صوتی مرورگر";
		this.demo = false;
	}

	available() {
		return "speechSynthesis" in window;
	}

	speak(text) {
		this.stop();
		return new Promise((resolve) => {
			const u = new SpeechSynthesisUtterance(text);
			u.lang = "fa-IR";
			const voice = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith("fa"));
			if (voice) u.voice = voice;
			u.onend = u.onerror = () => resolve();
			window.speechSynthesis.speak(u);
		});
	}

	stop() {
		if (this.available()) window.speechSynthesis.cancel();
	}
}

// ------------------------------------------------------------------- executor

export const executor = {
	run: (action, params) => call(API + "run_action", { action, params }),
	preview: (action, params) => call(API + "preview_action", { action, params }),
	confirm: (token, params_hash) => call(API + "confirm_action", { token, params_hash }),
	cancel: (token) => call(API + "cancel_action", { token }),
	capabilities: () => call(API + "get_capabilities"),
};

export function make_stt(provider, get_context) {
	if (provider === "browser") {
		const stt = new BrowserSpeechToText();
		if (stt.available()) return stt;
	}
	return new MockSpeechToText(get_context);
}
