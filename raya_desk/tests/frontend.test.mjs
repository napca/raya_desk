import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function module_from_source(path) {
	const source = await readFile(new URL(path, import.meta.url), "utf8");
	return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}
const { suggestions_for } = await module_from_source("../public/js/raya/assistant/suggestions.js");
const { valid_iso_date } = await module_from_source("../public/js/raya/calendar.js");

test("invoice suggestions describe the saved invoice without unrelated lead commands", () => {
	assert.deepEqual(suggestions_for({ view: "form", doctype: "Sales Invoice", docname: "INV-1" }), ["این فاکتور را توضیح بده"]);
});
test("an unsaved or unreadable document has no document actions", () => {
	assert.deepEqual(suggestions_for({ view: "form", doctype: "Lead", docname: "new-lead", is_new: true }), []);
	assert.deepEqual(suggestions_for({ view: "form", doctype: "Lead", docname: "L-1" }, () => false), []);
});
test("follow-up and allocation suggestions follow permissions and selection", () => {
	const lead = { view: "list", doctype: "Lead", selected: ["L-1"] };
	assert.equal(suggestions_for(lead).length, 2);
	assert.equal(suggestions_for(lead, () => true, () => false).length, 1);
	assert.equal(suggestions_for({ ...lead, selected: [] }).length, 1);
	assert.equal(suggestions_for({ view: "form", doctype: "Customer", docname: "C-1" }, () => true, () => false).length, 1);
});
test("unsupported reports and empty customer lists do not advertise unavailable actions", () => {
	assert.deepEqual(suggestions_for({ view: "report", page: "General Ledger" }), []);
	assert.deepEqual(suggestions_for({ view: "list", doctype: "Customer", selected: [] }), []);
});
test("dashboard sales suggestions require sales read permission", () => {
	assert.equal(suggestions_for({ view: "page", page: "raya-dashboard" }).length, 2);
	assert.deepEqual(suggestions_for({ view: "page", page: "raya-dashboard" }, () => false), []);
});
test("date labels accept real ISO dates and reject rollover, locale strings and markup", () => {
	for (const value of ["2024-02-29", "2026-11-08", "2026-01-01"]) assert.equal(valid_iso_date(value), true);
	for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-11-00", "۱۴۰۵/۰۸/۱۷", "2026-11-08 10:00:00", "<img>", null, ""])
		assert.equal(valid_iso_date(value), false);
});
