import { describe, expect, it } from "bun:test";
import { getBoardFooterContent } from "../ui/board.ts";
import { formatFooterContent } from "../ui/footer-content.ts";

describe("formatFooterContent", () => {
	it("keeps footer on one line when terminal width is sufficient", () => {
		const content = " {cyan-fg}[Tab]{/} Switch View | {cyan-fg}[/]{/} Search | {cyan-fg}[q/Esc]{/} Quit";

		const result = formatFooterContent(content, 120);

		expect(result.height).toBe(1);
		expect(result.content.includes("\n")).toBe(false);
	});

	it("wraps footer into two lines by splitting on separators", () => {
		const content =
			" {cyan-fg}[Tab]{/} Switch View | {cyan-fg}[/]{/} Search | {cyan-fg}[p]{/} Priority | {cyan-fg}[i]{/} Milestone | {cyan-fg}[l]{/} Labels | {cyan-fg}[q/Esc]{/} Quit";

		const result = formatFooterContent(content, 52);
		const lines = result.content.split("\n");

		expect(result.height).toBe(2);
		expect(lines).toHaveLength(2);
		expect(lines[0]?.includes("|")).toBe(true);
		expect(lines[1]?.includes("|")).toBe(true);
	});

	it("fills the first line progressively so the second line grows as width shrinks", () => {
		const content = " one | two | three | four | five";

		const wider = formatFooterContent(content, 28);
		const narrower = formatFooterContent(content, 22);

		expect(wider.height).toBe(2);
		expect(narrower.height).toBe(2);
		expect(wider.content).toBe(" one | two | three | four\n five");
		expect(narrower.content).toBe(" one | two | three\n four | five");
	});

	it("returns original content for messages without separators", () => {
		const content = " {red-fg}Failed to open editor.{/}";

		const result = formatFooterContent(content, 24);

		expect(result.height).toBe(1);
		expect(result.content).toBe(content);
	});
});

describe("board zoom footer", () => {
	it("advertises zoom in overview and overview while zoomed", () => {
		expect(getBoardFooterContent(3, false, false)).toContain("[Z]{/} Zoom");
		expect(getBoardFooterContent(3, true, false)).toContain("[Z]{/} Overview");
	});

	it("does not advertise zoom for a one-column board", () => {
		expect(getBoardFooterContent(1, false, false)).not.toContain("[Z]{/}");
		expect(getBoardFooterContent(1, true, true)).not.toContain("[Z]{/}");
	});
});
