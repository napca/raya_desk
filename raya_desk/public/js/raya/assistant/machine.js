// Explicit state machine for one assistant turn. The UI renders from `state`; illegal transitions
// are refused so a late callback (e.g. a reply after the user cancelled) cannot revive a turn.

export const STATES = [
	"idle",
	"requesting-permission",
	"listening",
	"transcribing",
	"thinking",
	"awaiting-confirmation",
	"executing",
	"speaking",
	"error",
	"cancelled",
];

const ALLOWED = {
	idle: ["requesting-permission", "thinking"],
	"requesting-permission": ["listening", "error", "cancelled"],
	listening: ["transcribing", "error", "cancelled"],
	transcribing: ["idle", "error", "cancelled"],
	thinking: ["idle", "awaiting-confirmation", "speaking", "error", "cancelled"],
	"awaiting-confirmation": ["executing", "cancelled", "idle"],
	executing: ["idle", "speaking", "error"],
	speaking: ["idle", "cancelled"],
	error: ["idle", "requesting-permission", "thinking"],
	cancelled: ["idle", "requesting-permission", "thinking"],
};

export const LABELS = {
	idle: "آماده",
	"requesting-permission": "در انتظار اجازه میکروفن",
	listening: "در حال شنیدن",
	transcribing: "در حال تبدیل گفتار به متن",
	thinking: "در حال بررسی درخواست",
	"awaiting-confirmation": "در انتظار تأیید شما",
	executing: "در حال اجرا",
	speaking: "در حال پخش پاسخ",
	error: "خطا",
	cancelled: "لغو شد",
};

// Turns are numbered so async results from an older turn can be discarded
export class Machine {
	constructor(on_change) {
		this.state = "idle";
		this.turn = 0;
		this.on_change = on_change;
	}

	can(to) {
		return to === this.state || (ALLOWED[this.state] || []).includes(to);
	}

	to(to, detail) {
		if (to === this.state) return true;
		if (!this.can(to)) {
			console.warn(`raya assistant: ignored transition ${this.state} → ${to}`);
			return false;
		}
		const from = this.state;
		this.state = to;
		if (to === "requesting-permission" || to === "thinking") {
			if (from === "idle" || from === "error" || from === "cancelled") this.turn++;
		}
		this.on_change && this.on_change(to, from, detail);
		return true;
	}

	// Cancels whatever is in flight; stale callbacks then see a different turn number
	cancel() {
		if (this.state === "idle") return false;
		this.turn++;
		if (this.can("cancelled")) this.to("cancelled");
		else this.state = "cancelled";
		return true;
	}

	reset() {
		this.state = "idle";
		this.on_change && this.on_change("idle", null);
	}

	is_busy() {
		return !["idle", "error", "cancelled", "awaiting-confirmation"].includes(this.state);
	}
}
