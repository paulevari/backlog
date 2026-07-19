import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
const CLI_PATH = join(process.cwd(), "src", "cli.ts");

describe("Task selection filters", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-selection-filters");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();
		await $`git config user.name "Test User"`.cwd(TEST_DIR).quiet();
		await $`git config user.email test@example.com`.cwd(TEST_DIR).quiet();

		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "Selection Filter Test Project", false);
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	describe("--deps-satisfied filter", () => {
		it("T-100: should filter tasks by dependency satisfaction status", async () => {
			const core = new Core(TEST_DIR);

			await core.createTask(
				{
					id: "task-1",
					title: "Completed Dependency",
					status: "Done",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					rawContent: "Completed task",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-2",
					title: "Open Dependency",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					rawContent: "Open task",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-3",
					title: "All Deps Done - Should Include",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: ["TASK-1"],
					rawContent: "All dependencies done",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-4",
					title: "One Open Dep - Should Exclude",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: ["TASK-1", "TASK-2"],
					rawContent: "Has open dependency",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-5",
					title: "Missing Dep Non-Blocking - Should Include",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: ["TASK-999"],
					rawContent: "Missing dependency treated as non-blocking",
				},
				false,
			);

			const result = await $`bun ${CLI_PATH} task list --json --deps-satisfied`.cwd(TEST_DIR).quiet();
			const output = JSON.parse(result.stdout.toString());

			expect(output.schemaVersion).toBe(1);
			expect(output.tasks).toBeDefined();

			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-3");
			expect(taskIds).toContain("TASK-5");
			expect(taskIds).not.toContain("TASK-4");
		});
	});

	describe("--exclude-parents filter", () => {
		it("T-101: should exclude tasks that have children regardless of child status", async () => {
			const core = new Core(TEST_DIR);

			await core.createTask(
				{
					id: "task-1",
					title: "Parent Task - Should Exclude",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					rawContent: "Parent task",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-1.1",
					title: "Child Task",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					parentTaskId: "task-1",
					rawContent: "Child of task-1",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-2",
					title: "Parent With All Done Children - Should Still Exclude",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					rawContent: "Parent task",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-2.1",
					title: "Done Child",
					status: "Done",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					parentTaskId: "task-2",
					rawContent: "Done child of task-2",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-3",
					title: "Childless Task - Should Include",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					rawContent: "No children",
				},
				false,
			);

			const result = await $`bun ${CLI_PATH} task list --json --exclude-parents`.cwd(TEST_DIR).quiet();
			const output = JSON.parse(result.stdout.toString());

			expect(output.schemaVersion).toBe(1);
			expect(output.tasks).toBeDefined();

			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-1.1");
			expect(taskIds).toContain("TASK-2.1");
			expect(taskIds).toContain("TASK-3");
			expect(taskIds).not.toContain("TASK-1");
			expect(taskIds).not.toContain("TASK-2");
		});
	});

	describe("batch capping", () => {
		it("T-102: should respect --limit with stable ordering", async () => {
			const core = new Core(TEST_DIR);

			for (let i = 1; i <= 10; i++) {
				await core.createTask(
					{
						id: `task-${i}`,
						title: `Task ${i}`,
						status: "To Do",
						assignee: [],
						createdDate: "2025-06-08",
						labels: ["test"],
						dependencies: [],
						priority: "high",
						rawContent: `Task ${i}`,
					},
					false,
				);
			}

			const result1 = await $`bun ${CLI_PATH} task list --json --labels test --limit 3`.cwd(TEST_DIR).quiet();
			const output1 = JSON.parse(result1.stdout.toString());

			const result2 = await $`bun ${CLI_PATH} task list --json --labels test --limit 3`.cwd(TEST_DIR).quiet();
			const output2 = JSON.parse(result2.stdout.toString());

			expect(output1.schemaVersion).toBe(1);
			expect(output1.tasks).toBeDefined();
			expect(output1.tasks).toHaveLength(3);

			const taskIds1 = output1.tasks.map((t: { id: string }) => t.id);
			const taskIds2 = output2.tasks.map((t: { id: string }) => t.id);

			expect(taskIds1).toEqual(taskIds2);
			expect(taskIds1).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
		});
	});

	describe("one-invocation compile", () => {
		it("T-103: should compile full selection to single CLI call", async () => {
			const core = new Core(TEST_DIR);
			const milestone = await core.filesystem.createMilestone("Test Milestone");

			await core.createTask(
				{
					id: "task-1",
					title: "Dependency Task",
					status: "Done",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					rawContent: "Done dependency",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-2",
					title: "Parent Task",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					rawContent: "Parent",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-2.1",
					title: "Child Task - Noise",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					parentTaskId: "task-2",
					rawContent: "Should be excluded by exclude-parents on parent",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-3",
					title: "Matching Task",
					status: "To Do",
					assignee: ["alice"],
					createdDate: "2025-06-08",
					labels: ["frontend", "bug"],
					dependencies: ["TASK-1"],
					milestone: milestone.id,
					priority: "high",
					rawContent: "Should match all filters",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-4",
					title: "Wrong Status",
					status: "Done",
					assignee: ["alice"],
					createdDate: "2025-06-08",
					labels: ["frontend", "bug"],
					dependencies: ["TASK-1"],
					milestone: milestone.id,
					priority: "high",
					rawContent: "Wrong status",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-5",
					title: "Missing Label",
					status: "To Do",
					assignee: ["alice"],
					createdDate: "2025-06-08",
					labels: ["frontend"],
					dependencies: ["TASK-1"],
					milestone: milestone.id,
					priority: "high",
					rawContent: "Missing bug label",
				},
				false,
			);

			const result =
				await $`bun ${CLI_PATH} task list --json --status "To Do" --assignee alice --milestone "Test Milestone" --priority high --labels frontend,bug --deps-satisfied --exclude-parents --limit 5`
					.cwd(TEST_DIR)
					.quiet();
			const output = JSON.parse(result.stdout.toString());

			expect(output.schemaVersion).toBe(1);
			expect(output.tasks).toBeDefined();

			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-3");
			expect(taskIds).not.toContain("TASK-2");
			expect(taskIds).not.toContain("TASK-2.1");
			expect(taskIds).not.toContain("TASK-4");
			expect(taskIds).not.toContain("TASK-5");
		});
	});

	describe("label matching modes", () => {
		it("T-105: should support require_all (AND) label matching", async () => {
			const core = new Core(TEST_DIR);

			await core.createTask(
				{
					id: "task-1",
					title: "Has Both Labels",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["frontend", "bug"],
					dependencies: [],
					rawContent: "Has both",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-2",
					title: "Has Only Frontend",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["frontend"],
					dependencies: [],
					rawContent: "Missing bug",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-3",
					title: "Has Only Bug",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["bug"],
					dependencies: [],
					rawContent: "Missing frontend",
				},
				false,
			);

			const result = await $`bun ${CLI_PATH} task list --json --labels frontend,bug`.cwd(TEST_DIR).quiet();
			const output = JSON.parse(result.stdout.toString());

			expect(output.schemaVersion).toBe(1);
			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-1");
			expect(taskIds).not.toContain("TASK-2");
			expect(taskIds).not.toContain("TASK-3");
		});

		it("T-105b: core filter engine should support require_any (OR) label matching", async () => {
			const core = new Core(TEST_DIR);

			await core.createTask(
				{
					id: "task-1",
					title: "Has Label A",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["a"],
					dependencies: [],
					rawContent: "Has a",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-2",
					title: "Has Label B",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["b"],
					dependencies: [],
					rawContent: "Has b",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-3",
					title: "Has Both A and B",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["a", "b"],
					dependencies: [],
					rawContent: "Has both",
				},
				false,
			);

			const tasks = await core.queryTasks({
				filters: { labels: ["a", "b"] },
				includeCrossBranch: false,
			});

			const taskIds = tasks.map((t) => t.id);
			expect(taskIds).toContain("TASK-1");
			expect(taskIds).toContain("TASK-2");
			expect(taskIds).toContain("TASK-3");
		});
	});

	describe("milestone scope filter", () => {
		it("T-104: should filter by open milestone scope", async () => {
			const core = new Core(TEST_DIR);
			const openMilestone = await core.filesystem.createMilestone("Open Milestone");
			const completedMilestone = await core.filesystem.createMilestone("Completed Milestone");

			await core.createTask(
				{
					id: "task-1",
					title: "Task in Open Milestone",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					milestone: openMilestone.id,
					rawContent: "In open milestone",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-2",
					title: "Done Task in Completed Milestone",
					status: "Done",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					milestone: completedMilestone.id,
					rawContent: "In completed milestone",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-3",
					title: "Task with No Milestone",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					rawContent: "No milestone",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-4",
					title: "Done Task in Open Milestone",
					status: "Done",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					milestone: openMilestone.id,
					rawContent: "Done but milestone still open",
				},
				false,
			);

			const baselineResult = await $`bun ${CLI_PATH} task list --json --status Done`.cwd(TEST_DIR).quiet();
			const baselineOutput = JSON.parse(baselineResult.stdout.toString());
			const baselineTaskIds = baselineOutput.tasks.map((t: { id: string }) => t.id);
			expect(baselineTaskIds).toContain("TASK-2");

			const result = await $`bun ${CLI_PATH} task list --json --milestone-scope open`.cwd(TEST_DIR).quiet();
			const output = JSON.parse(result.stdout.toString());

			expect(output.schemaVersion).toBe(1);
			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-1");
			expect(taskIds).not.toContain("TASK-2");
			expect(taskIds).not.toContain("TASK-3");

			const scopedDoneResult = await $`bun ${CLI_PATH} task list --json --status Done --milestone-scope open`
				.cwd(TEST_DIR)
				.quiet();
			const scopedDoneOutput = JSON.parse(scopedDoneResult.stdout.toString());
			const scopedDoneTaskIds = scopedDoneOutput.tasks.map((t: { id: string }) => t.id);
			expect(scopedDoneTaskIds).toContain("TASK-4");
			expect(scopedDoneTaskIds).not.toContain("TASK-2");
		});
	});
});
