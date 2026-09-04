import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Core } from "../index.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;

const issueList = {
	issues: [
		{
			id: "a",
			identifier: "PUD-1",
			title: "Open",
			status: "todo",
			priority: "low",
			position: 1,
			created_at: "2026-09-01T00:00:00Z",
		},
	],
};

describe("Core ripple mode", () => {
	let stub: string;

	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-core-ripple");
		await mkdir(TEST_DIR, { recursive: true });
		stub = join(TEST_DIR, "ripple-stub.sh");
		await writeFile(
			stub,
			`#!/bin/sh\ncase "$1 $2" in\n "issue list") printf '%s' '${JSON.stringify(issueList)}' ;;\n *) echo '[]' ;;\nesac\n`,
		);
		await chmod(stub, 0o755);
		const seed = new Core(TEST_DIR);
		await initializeTestProject(seed, "Ripple Core");
		await seed.createTask(
			{
				id: "task-1",
				title: "Native",
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-01-01",
			},
			false,
		);
	});
	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("loadTasks returns only ripple issues, never native tasks", async () => {
		const core = new Core(TEST_DIR, { rippleCommand: stub });
		expect(core.rippleMode).toBe(true);
		const tasks = await core.loadTasks();
		expect(tasks.map((t) => t.id)).toEqual(["PUD-1"]);
		expect(tasks[0]?.source).toBe("ripple");
	});

	it("rejects mutations while in ripple mode", async () => {
		const core = new Core(TEST_DIR, { rippleCommand: stub });
		await expect(core.archiveTask("PUD-1", false)).rejects.toThrow(/read-only/);
		await expect(
			core.createTask(
				{
					id: "PUD-2",
					title: "x",
					status: "todo",
					assignee: [],
					labels: [],
					dependencies: [],
					createdDate: "2026-01-01",
				},
				false,
			),
		).rejects.toThrow(/read-only/);
		await expect(
			core.updateTask(
				{
					id: "PUD-1",
					title: "x",
					status: "todo",
					assignee: [],
					labels: [],
					dependencies: [],
					createdDate: "2026-01-01",
				},
				false,
			),
		).rejects.toThrow(/read-only/);
		await expect(core.editTaskInTui("PUD-1", {} as never)).rejects.toThrow(/read-only/);
		await expect(core.completeTask("PUD-1", false)).rejects.toThrow(/read-only/);
		await expect(
			core.reorderTask({ taskId: "PUD-1", targetStatus: "todo", orderedTaskIds: ["PUD-1"] }),
		).rejects.toThrow(/read-only/);
	});

	it("is not in ripple mode without a command", () => {
		expect(new Core(TEST_DIR).rippleMode).toBe(false);
	});
});
