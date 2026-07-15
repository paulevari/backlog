import { describe, expect, it } from "bun:test";
import type { Task } from "../types/index.ts";
import {
	type ColumnData,
	calculateBoardColumnLayout,
	resolveBoardSelection,
	shouldRebuildColumns,
	shouldRestoreBoardSelectionWithoutFocus,
} from "../ui/board.ts";

function createTask(id: string, status: string): Task {
	return {
		id,
		title: `Title for ${id}`,
		status,
		assignee: [],
		createdDate: "2025-01-01",
		labels: [],
		dependencies: [],
		description: "",
	};
}

function makeColumns(taskIds: string[][], status: string): ColumnData[] {
	return taskIds.map((ids) => ({
		status,
		tasks: ids.map((id) => createTask(id, status)),
	}));
}

describe("shouldRebuildColumns", () => {
	it("returns false when columns and task ordering are unchanged", () => {
		const previous = makeColumns([["task-1", "task-2"]], "In Progress");
		const next = makeColumns([["task-1", "task-2"]], "In Progress");

		expect(shouldRebuildColumns(previous, next)).toBe(false);
	});

	it("returns true when a column loses items", () => {
		const previous = makeColumns([["task-1", "task-2"]], "In Progress");
		const next = makeColumns([["task-1"]], "In Progress");

		expect(shouldRebuildColumns(previous, next)).toBe(true);
	});

	it("returns true when column task ordering changes", () => {
		const previous = makeColumns([["task-1", "task-2"]], "In Progress");
		const next = makeColumns([["task-2", "task-1"]], "In Progress");

		expect(shouldRebuildColumns(previous, next)).toBe(true);
	});

	it("returns true when number of columns changes", () => {
		const previous = makeColumns([["task-1"]], "In Progress");
		const next = makeColumns([["task-1"], ["task-2"]], "In Progress");

		expect(shouldRebuildColumns(previous, next)).toBe(true);
	});
});

describe("calculateBoardColumnLayout overview", () => {
	it("returns no geometry when there are no columns", () => {
		expect(calculateBoardColumnLayout(0)).toEqual([]);
	});

	it("keeps a single column full width", () => {
		expect(calculateBoardColumnLayout(1)).toEqual([{ left: 0, width: 100 }]);
	});

	it("preserves the final-column remainder", () => {
		expect(calculateBoardColumnLayout(3)).toEqual([
			{ left: 0, width: 33 },
			{ left: 33, width: 33 },
			{ left: 66, width: 34 },
		]);
		expect(calculateBoardColumnLayout(6)).toEqual([
			{ left: 0, width: 16 },
			{ left: 16, width: 16 },
			{ left: 32, width: 16 },
			{ left: 48, width: 16 },
			{ left: 64, width: 16 },
			{ left: 80, width: 20 },
		]);
	});
});

describe("calculateBoardColumnLayout zoom", () => {
	it("keeps a one-column board full width", () => {
		expect(calculateBoardColumnLayout(1, 0, true)).toEqual([{ left: 0, width: 100 }]);
	});

	it("allocates two-thirds to either active column", () => {
		const firstActive = calculateBoardColumnLayout(2, 0, true);
		expect(firstActive[0]?.left).toBe(0);
		expect(firstActive[0]?.width).toBeCloseTo(200 / 3);
		expect(firstActive[1]?.left).toBeCloseTo(200 / 3);
		expect(firstActive[1]?.width).toBeCloseTo(100 / 3);

		const secondActive = calculateBoardColumnLayout(2, 1, true);
		expect(secondActive[0]?.width).toBeCloseTo(100 / 3);
		expect(secondActive[1]?.left).toBeCloseTo(100 / 3);
		expect(secondActive[1]?.width).toBeCloseTo(200 / 3);
	});

	it("allocates half to the active column when there are three or more", () => {
		expect(calculateBoardColumnLayout(3, 1, true)).toEqual([
			{ left: 0, width: 25 },
			{ left: 25, width: 50 },
			{ left: 75, width: 25 },
		]);

		const fourColumns = calculateBoardColumnLayout(4, 3, true);
		expect(fourColumns[0]?.width).toBeCloseTo(100 / 6);
		expect(fourColumns[1]?.width).toBeCloseTo(100 / 6);
		expect(fourColumns[2]?.width).toBeCloseTo(100 / 6);
		expect(fourColumns[3]?.width).toBe(50);
	});

	it("clamps the active column and keeps geometry contiguous", () => {
		expect(calculateBoardColumnLayout(3, -1, true)).toEqual(calculateBoardColumnLayout(3, 0, true));
		expect(calculateBoardColumnLayout(3, 99, true)).toEqual(calculateBoardColumnLayout(3, 2, true));

		for (let columnCount = 2; columnCount <= 8; columnCount += 1) {
			const layout = calculateBoardColumnLayout(columnCount, Math.floor(columnCount / 2), true);
			let nextLeft = 0;
			for (const column of layout) {
				expect(column.left).toBeCloseTo(nextLeft);
				expect(column.width).toBeGreaterThanOrEqual(0);
				nextLeft += column.width;
			}
			expect(nextLeft).toBeCloseTo(100);
		}
	});
});

describe("resolveBoardSelection", () => {
	it("follows the selected task when a live update moves it to another column", () => {
		const columns: ColumnData[] = [
			{ status: "To Do", tasks: [] },
			{ status: "In Progress", tasks: [] },
			{ status: "Done", tasks: [createTask("task-1", "Done")] },
		];

		expect(resolveBoardSelection(columns, 1, "task-1")).toEqual({ columnIndex: 2, rowIndex: 0 });
	});

	it("clamps the current column when the selected task is unavailable", () => {
		const columns: ColumnData[] = [
			{ status: "To Do", tasks: [] },
			{ status: "Done", tasks: [] },
		];

		expect(resolveBoardSelection(columns, 99, "missing")).toEqual({ columnIndex: 1 });
		expect(resolveBoardSelection([], 0, "missing")).toBeUndefined();
	});
});

describe("shouldRestoreBoardSelectionWithoutFocus", () => {
	it("preserves popup, filter picker, and modal focus during live updates", () => {
		expect(shouldRestoreBoardSelectionWithoutFocus(true, false, false)).toBe(true);
		expect(shouldRestoreBoardSelectionWithoutFocus(false, true, false)).toBe(true);
		expect(shouldRestoreBoardSelectionWithoutFocus(false, false, true)).toBe(true);
		expect(shouldRestoreBoardSelectionWithoutFocus(false, false, false)).toBe(false);
	});
});
