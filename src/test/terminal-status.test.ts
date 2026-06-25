import { describe, expect, it } from "bun:test";
import type { AcceptanceCriterion } from "../types/index.ts";
import { getTerminalStatus, isTerminalStatus, validateTerminalStatusCompleteness } from "../utils/terminal-status.ts";

describe("terminal status helpers", () => {
	it("uses the final configured status as terminal", () => {
		expect(getTerminalStatus(["To Do", "Review", "Closed"])).toBe("Closed");
	});

	it("compares terminal statuses case-insensitively for URL and user input values", () => {
		expect(isTerminalStatus("closed", ["To Do", "Review", "Closed"])).toBe(true);
		expect(isTerminalStatus("CLOSED", ["To Do", "Review", "Closed"])).toBe(true);
		expect(isTerminalStatus("review", ["To Do", "Review", "Closed"])).toBe(false);
	});

	it("preserves internal spaces when comparing status names", () => {
		expect(isTerminalStatus("InProgress", ["To Do", "In Progress", "InProgress"])).toBe(true);
		expect(isTerminalStatus("In Progress", ["To Do", "In Progress", "InProgress"])).toBe(false);
	});
});

const STATUSES = ["To Do", "In Progress", "Done"];

function makeAC(items: Array<{ text: string; checked: boolean }>): AcceptanceCriterion[] {
	return items.map((item, i) => ({ index: i + 1, ...item }));
}

describe("validateTerminalStatusCompleteness", () => {
	it("passes when task has no AC and no DoD items", () => {
		expect(() => validateTerminalStatusCompleteness({}, STATUSES, "Done", "In Progress")).not.toThrow();
	});

	it("passes when all AC and DoD items are checked", () => {
		const task = {
			acceptanceCriteriaItems: makeAC([{ text: "first", checked: true }]),
			definitionOfDoneItems: makeAC([{ text: "tests pass", checked: true }]),
		};
		expect(() => validateTerminalStatusCompleteness(task, STATUSES, "Done", "In Progress")).not.toThrow();
	});

	it("throws when AC items are unchecked", () => {
		const task = {
			acceptanceCriteriaItems: makeAC([
				{ text: "first", checked: true },
				{ text: "second", checked: false },
			]),
		};
		expect(() => validateTerminalStatusCompleteness(task, STATUSES, "Done", "In Progress")).toThrow(
			/Acceptance Criteria/,
		);
	});

	it("throws when DoD items are unchecked", () => {
		const task = {
			definitionOfDoneItems: makeAC([{ text: "tests pass", checked: false }]),
		};
		expect(() => validateTerminalStatusCompleteness(task, STATUSES, "Done", "In Progress")).toThrow(
			/Definition of Done/,
		);
	});

	it("throws when both AC and DoD have unchecked items", () => {
		const task = {
			acceptanceCriteriaItems: makeAC([{ text: "ac", checked: false }]),
			definitionOfDoneItems: makeAC([{ text: "dod", checked: false }]),
		};
		expect(() => validateTerminalStatusCompleteness(task, STATUSES, "Done", "In Progress")).toThrow(
			/Acceptance Criteria.*Definition of Done/,
		);
	});

	it("skips validation when task is already in terminal status", () => {
		const task = {
			acceptanceCriteriaItems: makeAC([{ text: "unchecked", checked: false }]),
		};
		expect(() => validateTerminalStatusCompleteness(task, STATUSES, "Done", "Done")).not.toThrow();
	});

	it("skips validation when target is not terminal status", () => {
		const task = {
			acceptanceCriteriaItems: makeAC([{ text: "unchecked", checked: false }]),
		};
		expect(() => validateTerminalStatusCompleteness(task, STATUSES, "In Progress", "To Do")).not.toThrow();
	});

	it("includes the user-facing message in the error", () => {
		const task = {
			acceptanceCriteriaItems: makeAC([{ text: "unchecked", checked: false }]),
		};
		expect(() => validateTerminalStatusCompleteness(task, STATUSES, "Done", "In Progress")).toThrow(
			"Please ensure all Acceptance Criteria and Definition of Done items are actually complete and if so, update the ticket by marking them as done",
		);
	});
});
