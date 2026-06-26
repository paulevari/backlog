import { describe, expect, it } from "bun:test";
import { getInitialStatus, isInitialStatus, validateInitialStatusReadiness } from "../utils/initial-status.ts";

const STATUSES = ["To Do", "In Progress", "Done"] as const;

function makeAC(items: Array<{ text: string; checked?: boolean }>) {
	return items.map((item, i) => ({ index: i + 1, text: item.text, checked: item.checked ?? false }));
}

describe("initial status helpers", () => {
	it("uses the first configured status as initial", () => {
		expect(getInitialStatus(["To Do", "Review", "Closed"])).toBe("To Do");
	});

	it("returns null for empty statuses array", () => {
		expect(getInitialStatus([])).toBeNull();
	});

	it("returns null for array with empty-string first element", () => {
		expect(getInitialStatus(["", "In Progress"])).toBeNull();
	});

	it("compares initial statuses case-insensitively", () => {
		expect(isInitialStatus("to do", ["To Do", "In Progress", "Done"])).toBe(true);
		expect(isInitialStatus("TO DO", ["To Do", "In Progress", "Done"])).toBe(true);
		expect(isInitialStatus("In Progress", ["To Do", "In Progress", "Done"])).toBe(false);
	});

	it("returns false for non-initial status", () => {
		expect(isInitialStatus("Done", STATUSES)).toBe(false);
	});

	it("returns false for empty statuses array", () => {
		expect(isInitialStatus("To Do", [])).toBe(false);
	});
});

describe("validateInitialStatusReadiness", () => {
	it("passes when task has AC and DoD items defined", () => {
		const task = {
			acceptanceCriteriaItems: makeAC([{ text: "user can login" }]),
			definitionOfDoneItems: makeAC([{ text: "tests pass" }]),
		};
		expect(() => validateInitialStatusReadiness(task, STATUSES, "In Progress", "To Do")).not.toThrow();
	});

	it("throws when task has no AC items", () => {
		const task = {
			acceptanceCriteriaItems: [],
			definitionOfDoneItems: makeAC([{ text: "tests pass" }]),
		};
		expect(() => validateInitialStatusReadiness(task, STATUSES, "In Progress", "To Do")).toThrow(/Acceptance Criteria/);
	});

	it("throws when task has no DoD items", () => {
		const task = {
			acceptanceCriteriaItems: makeAC([{ text: "user can login" }]),
			definitionOfDoneItems: [],
		};
		expect(() => validateInitialStatusReadiness(task, STATUSES, "In Progress", "To Do")).toThrow(/Definition of Done/);
	});

	it("throws when task has neither AC nor DoD items", () => {
		expect(() => validateInitialStatusReadiness({}, STATUSES, "In Progress", "To Do")).toThrow(
			/Acceptance Criteria and Definition of Done/,
		);
	});

	it("throws when AC and DoD are undefined", () => {
		const task = {
			acceptanceCriteriaItems: undefined,
			definitionOfDoneItems: undefined,
		};
		expect(() => validateInitialStatusReadiness(task, STATUSES, "In Progress", "To Do")).toThrow(/must be defined/);
	});

	it("passes when moving between non-initial statuses", () => {
		expect(() => validateInitialStatusReadiness({}, STATUSES, "Done", "In Progress")).not.toThrow();
	});

	it("passes when staying in initial status", () => {
		expect(() => validateInitialStatusReadiness({}, STATUSES, "To Do", "To Do")).not.toThrow();
	});

	it("passes when demoting to Draft", () => {
		expect(() => validateInitialStatusReadiness({}, STATUSES, "Draft", "To Do")).not.toThrow();
	});

	it("throws when promoting from Draft to non-initial status without AC/DoD", () => {
		expect(() => validateInitialStatusReadiness({}, STATUSES, "In Progress", "Draft")).toThrow(/must be defined/);
	});

	it("passes when promoting from Draft to initial status", () => {
		expect(() => validateInitialStatusReadiness({}, STATUSES, "To Do", "Draft")).not.toThrow();
	});

	it("passes when promoting from Draft with AC and DoD defined", () => {
		const task = {
			acceptanceCriteriaItems: makeAC([{ text: "feature works" }]),
			definitionOfDoneItems: makeAC([{ text: "tests pass" }]),
		};
		expect(() => validateInitialStatusReadiness(task, STATUSES, "In Progress", "Draft")).not.toThrow();
	});

	it("error message includes the initial status name", () => {
		expect(() => validateInitialStatusReadiness({}, STATUSES, "In Progress", "To Do")).toThrow(/To Do/);
	});

	it("error message mentions only missing sections", () => {
		const taskWithAC = {
			acceptanceCriteriaItems: makeAC([{ text: "done" }]),
			definitionOfDoneItems: [],
		};
		const error1 = getError(() => validateInitialStatusReadiness(taskWithAC, STATUSES, "In Progress", "To Do"));
		expect(error1).toMatch(/Definition of Done/);
		expect(error1).not.toMatch(/Acceptance Criteria/);

		const taskWithDoD = {
			acceptanceCriteriaItems: [],
			definitionOfDoneItems: makeAC([{ text: "tests" }]),
		};
		const error2 = getError(() => validateInitialStatusReadiness(taskWithDoD, STATUSES, "In Progress", "To Do"));
		expect(error2).toMatch(/Acceptance Criteria/);
		expect(error2).not.toMatch(/Definition of Done/);
	});

	it("passes for empty statuses array", () => {
		expect(() => validateInitialStatusReadiness({}, [], "In Progress", "To Do")).not.toThrow();
	});

	it("handles case-insensitive old status matching", () => {
		expect(() => validateInitialStatusReadiness({}, STATUSES, "In Progress", "to do")).toThrow(/must be defined/);
	});
});

function getError(fn: () => void): string {
	try {
		fn();
		return "";
	} catch (e) {
		return (e as Error).message;
	}
}
