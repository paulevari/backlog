import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;
let originalNotificationSetting: string | undefined;
const CLI_PATH = join(process.cwd(), "src", "cli.ts");

async function runCli(args: string[]) {
	const child = Bun.spawn(["bun", CLI_PATH, ...args], {
		cwd: TEST_DIR,
		env: { ...globalThis.process.env, BACKLOG_BELLEROPHON_NOTIFICATIONS: "0" },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

describe("Task selection filters", () => {
	beforeEach(async () => {
		originalNotificationSetting = process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS;
		process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS = "0";
		TEST_DIR = createUniqueTestDir("test-selection-filters");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();
		await $`git config user.name "Test User"`.cwd(TEST_DIR).quiet();
		await $`git config user.email test@example.com`.cwd(TEST_DIR).quiet();

		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "Selection Filter Test Project", false);
	});

	afterEach(async () => {
		try {
			await safeCleanup(TEST_DIR);
		} finally {
			if (originalNotificationSetting === undefined) {
				delete process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS;
			} else {
				process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS = originalNotificationSetting;
			}
		}
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

			const result = await runCli(["task", "list", "--json", "--deps-satisfied"]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);

			expect(output.schemaVersion).toBe(1);
			expect(output.tasks).toBeDefined();

			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-3");
			expect(taskIds).toContain("TASK-5");
			expect(taskIds).not.toContain("TASK-4");
		});

		it("should match dependency references across ID formatting variants", async () => {
			const core = new Core(TEST_DIR);

			await core.createTask(
				{
					id: "task-1",
					title: "Open Dependency",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					rawContent: "Open dependency",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-2",
					title: "Zero-Padded Dependency Reference",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: ["TASK-01"],
					rawContent: "References TASK-1 with a zero-padded ID",
				},
				false,
			);

			const result = await runCli(["task", "list", "--json", "--deps-satisfied"]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);

			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).not.toContain("TASK-2");
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

			const result = await runCli(["task", "list", "--json", "--exclude-parents"]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);

			expect(output.schemaVersion).toBe(1);
			expect(output.tasks).toBeDefined();

			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-1.1");
			expect(taskIds).toContain("TASK-2.1");
			expect(taskIds).toContain("TASK-3");
			expect(taskIds).not.toContain("TASK-1");
			expect(taskIds).not.toContain("TASK-2");
		});

		it("should exclude parents referenced by formatting-variant child IDs", async () => {
			const core = new Core(TEST_DIR);

			await core.createTask(
				{
					id: "task-1",
					title: "Parent Referenced With Padding",
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
					title: "Child With Padded Parent Reference",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					parentTaskId: "TASK-01",
					rawContent: "Child referencing parent with a zero-padded ID",
				},
				false,
			);

			const result = await runCli(["task", "list", "--json", "--exclude-parents"]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);

			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).not.toContain("TASK-1");
			expect(taskIds).toContain("TASK-1.1");
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

			const result1 = await runCli(["task", "list", "--json", "--labels", "test", "--limit", "3"]);
			expect(result1.exitCode, result1.stderr).toBe(0);
			const output1 = JSON.parse(result1.stdout);

			const result2 = await runCli(["task", "list", "--json", "--labels", "test", "--limit", "3"]);
			expect(result2.exitCode, result2.stderr).toBe(0);
			const output2 = JSON.parse(result2.stdout);

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

			const result = await runCli([
				"task",
				"list",
				"--json",
				"--status",
				"To Do",
				"--assignee",
				"alice",
				"--milestone",
				"Test Milestone",
				"--priority",
				"high",
				"--labels",
				"frontend,bug",
				"--deps-satisfied",
				"--exclude-parents",
				"--limit",
				"5",
			]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);

			expect(output.schemaVersion).toBe(1);
			expect(output.tasks).toBeDefined();

			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-3");
			expect(taskIds).not.toContain("TASK-2");
			expect(taskIds).not.toContain("TASK-2.1");
			expect(taskIds).not.toContain("TASK-4");
			expect(taskIds).not.toContain("TASK-5");
		});

		it("should support the generic selection contract in one invocation", async () => {
			const core = new Core(TEST_DIR);
			const releaseAlpha = await core.filesystem.createMilestone("Release Alpha");
			const releaseBeta = await core.filesystem.createMilestone("Release Beta");
			const releaseGamma = await core.filesystem.createMilestone("Release Gamma");

			const tasks = [
				{
					id: "task-1",
					title: "Matches first status, milestone, and any-label branch",
					status: "To Do",
					milestone: releaseAlpha.id,
					labels: ["required-a", "required-b", "any-a"],
				},
				{
					id: "task-2",
					title: "Matches second status, milestone, and any-label branch",
					status: "In Progress",
					milestone: releaseBeta.id,
					labels: ["required-a", "required-b", "any-b"],
				},
				{
					id: "task-3",
					title: "Excluded by status",
					status: "Done",
					milestone: releaseAlpha.id,
					labels: ["required-a", "required-b", "any-a"],
				},
				{
					id: "task-4",
					title: "Excluded by milestone",
					status: "To Do",
					milestone: releaseGamma.id,
					labels: ["required-a", "required-b", "any-a"],
				},
				{
					id: "task-5",
					title: "Excluded by require-all labels",
					status: "To Do",
					milestone: releaseAlpha.id,
					labels: ["required-a", "any-a"],
				},
				{
					id: "task-6",
					title: "Excluded by require-any labels",
					status: "In Progress",
					milestone: releaseBeta.id,
					labels: ["required-a", "required-b", "other"],
				},
			];

			for (const task of tasks) {
				await core.createTask(
					{
						...task,
						assignee: [],
						createdDate: "2025-06-08",
						dependencies: [],
						rawContent: task.title,
					},
					false,
				);
			}

			const result = await runCli([
				"task",
				"list",
				"--json",
				"--status",
				"To Do",
				"--status",
				"In Progress",
				"--milestone",
				"Release Alpha",
				"--milestone",
				"Release Beta",
				"--labels",
				"required-a,required-b",
				"--any-label",
				"any-a,any-b",
			]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);
			const taskIds = output.tasks.map((task: { id: string }) => task.id);

			expect(taskIds).toEqual(["TASK-1", "TASK-2"]);
		});

		it("should not redirect requested milestones after another filter removes their tasks", async () => {
			const core = new Core(TEST_DIR);
			const releaseAlpha = await core.filesystem.createMilestone("Release Alpha");
			const releaseBeta = await core.filesystem.createMilestone("Release Beta");
			const releaseGamma = await core.filesystem.createMilestone("Release Gamma");

			for (const task of [
				{ id: "task-1", status: "Done", milestone: releaseAlpha.id },
				{ id: "task-2", status: "Done", milestone: releaseBeta.id },
				{ id: "task-3", status: "To Do", milestone: releaseGamma.id },
			]) {
				await core.createTask(
					{
						...task,
						title: `Task in ${task.milestone}`,
						assignee: [],
						createdDate: "2025-06-08",
						labels: [],
						dependencies: [],
						rawContent: `Task in ${task.milestone}`,
					},
					false,
				);
			}

			const result = await runCli([
				"task",
				"list",
				"--json",
				"--status",
				"To Do",
				"--milestone",
				"Release Alpha",
				"--milestone",
				"Release Beta",
			]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);

			expect(output.tasks).toEqual([]);
		});

		it("should support repeated milestone IDs", async () => {
			const core = new Core(TEST_DIR);
			const releaseAlpha = await core.filesystem.createMilestone("Release Alpha");
			const releaseBeta = await core.filesystem.createMilestone("Release Beta");
			const releaseGamma = await core.filesystem.createMilestone("Release Gamma");

			for (const task of [
				{ id: "task-1", milestone: releaseAlpha.id },
				{ id: "task-2", milestone: releaseBeta.id },
				{ id: "task-3", milestone: releaseGamma.id },
			]) {
				await core.createTask(
					{
						...task,
						title: `Task in ${task.milestone}`,
						status: "To Do",
						assignee: [],
						createdDate: "2025-06-08",
						labels: [],
						dependencies: [],
						rawContent: `Task in ${task.milestone}`,
					},
					false,
				);
			}

			const result = await runCli([
				"task",
				"list",
				"--json",
				"--milestone",
				releaseAlpha.id,
				"--milestone",
				releaseBeta.id,
			]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);
			const taskIds = output.tasks.map((task: { id: string }) => task.id);

			expect(taskIds).toEqual(["TASK-1", "TASK-2"]);
		});

		it("should require non-interactive output for compound selection filters", async () => {
			const result = await runCli(["task", "list", "--status", "To Do", "--status", "Done"]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Compound task selection filters require --json or --plain");

			const plainResult = await runCli(["task", "list", "--plain", "--status", "To Do", "--status", "Done"]);
			expect(plainResult.exitCode, plainResult.stderr).toBe(0);
		});
	});

	describe("label matching modes", () => {
		it("should document combining require-all and require-any label groups", async () => {
			const result = await runCli(["task", "list", "--help"]);
			expect(result.exitCode, result.stderr).toBe(0);
			const help = result.stdout.replace(/\s+/g, " ");

			expect(help).toContain("may be combined with --labels; both label groups must match");
			expect(help).toContain("Compound filters require --json or --plain");
		});

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

			const result = await runCli(["task", "list", "--json", "--labels", "frontend,bug"]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);

			expect(output.schemaVersion).toBe(1);
			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-1");
			expect(taskIds).not.toContain("TASK-2");
			expect(taskIds).not.toContain("TASK-3");
		});

		it("T-105b: --any-label should support require_any (OR) label matching", async () => {
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

			await core.createTask(
				{
					id: "task-4",
					title: "Has Unrelated Label",
					status: "To Do",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["c"],
					dependencies: [],
					rawContent: "Has c",
				},
				false,
			);

			const result = await runCli(["task", "list", "--json", "--any-label", "a,b"]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);

			expect(output.schemaVersion).toBe(1);
			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-1");
			expect(taskIds).toContain("TASK-2");
			expect(taskIds).toContain("TASK-3");
			expect(taskIds).not.toContain("TASK-4");
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

			const baselineResult = await runCli(["task", "list", "--json", "--status", "Done"]);
			expect(baselineResult.exitCode, baselineResult.stderr).toBe(0);
			const baselineOutput = JSON.parse(baselineResult.stdout);
			const baselineTaskIds = baselineOutput.tasks.map((t: { id: string }) => t.id);
			expect(baselineTaskIds).toContain("TASK-2");

			const result = await runCli(["task", "list", "--json", "--milestone-scope", "open"]);
			expect(result.exitCode, result.stderr).toBe(0);
			const output = JSON.parse(result.stdout);

			expect(output.schemaVersion).toBe(1);
			const taskIds = output.tasks.map((t: { id: string }) => t.id);
			expect(taskIds).toContain("TASK-1");
			expect(taskIds).not.toContain("TASK-2");
			expect(taskIds).not.toContain("TASK-3");

			const scopedDoneResult = await runCli([
				"task",
				"list",
				"--json",
				"--status",
				"Done",
				"--milestone-scope",
				"open",
			]);
			expect(scopedDoneResult.exitCode, scopedDoneResult.stderr).toBe(0);
			const scopedDoneOutput = JSON.parse(scopedDoneResult.stdout);
			const scopedDoneTaskIds = scopedDoneOutput.tasks.map((t: { id: string }) => t.id);
			expect(scopedDoneTaskIds).toContain("TASK-4");
			expect(scopedDoneTaskIds).not.toContain("TASK-2");
		});
	});
});
