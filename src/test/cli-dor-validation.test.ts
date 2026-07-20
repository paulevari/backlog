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

describe("Definition of Ready validation", () => {
	beforeEach(async () => {
		originalNotificationSetting = process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS;
		process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS = "0";
		TEST_DIR = createUniqueTestDir("test-dor-validation");
		await mkdir(TEST_DIR, { recursive: true });
		await $`git init -b main`.cwd(TEST_DIR).quiet();
		await $`git config user.name "Test User"`.cwd(TEST_DIR).quiet();
		await $`git config user.email test@example.com`.cwd(TEST_DIR).quiet();

		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "DoR Validation Test Project", false);
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

	describe("T-509: Definition of Ready check", () => {
		it("should pass validation for fully qualified task", async () => {
			const core = new Core(TEST_DIR);
			const milestone = await core.filesystem.createMilestone("Test Milestone");

			await core.createTask(
				{
					id: "task-dep",
					title: "Dependency Task",
					status: "Done",
					assignee: [],
					createdDate: "2025-06-08",
					labels: [],
					dependencies: [],
					rawContent: "Completed dependency",
				},
				false,
			);

			await core.createTask(
				{
					id: "task-qualified",
					title: "Fully Qualified Task",
					description: "This task has all required DoR elements",
					status: "Backlog",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["complexity:medium"],
					dependencies: ["TASK-dep"],
					milestone: milestone.id,
					acceptanceCriteriaItems: [{ index: 1, text: "First criterion", checked: false }],
					definitionOfDoneItems: [{ index: 1, text: "First DoD item", checked: false }],
					rawContent: "Fully qualified",
				},
				false,
			);

			const result = await runCli(["task", "validate", "--dor", "TASK-qualified", "--json"]);
			expect(result.exitCode, result.stderr).toBe(0);

			const output = JSON.parse(result.stdout);
			expect(output.schemaVersion).toBe(1);
			expect(output.kind).toBe("dor-validation");
			expect(output.taskId).toBe("TASK-QUALIFIED");
			expect(output.pass).toBe(true);
			expect(Array.isArray(output.checks)).toBe(true);
			expect(output.checks.length).toBe(6);
			expect(output.checks.every((c: { pass: boolean }) => c.pass)).toBe(true);
		});

		it("should fail when description is empty", async () => {
			const core = new Core(TEST_DIR);
			const milestone = await core.filesystem.createMilestone("Test Milestone");

			await core.createTask(
				{
					id: "task-no-desc",
					title: "No Description Task",
					description: "",
					status: "Backlog",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["complexity:medium"],
					dependencies: [],
					milestone: milestone.id,
					acceptanceCriteriaItems: [{ index: 1, text: "First criterion", checked: false }],
					definitionOfDoneItems: [{ index: 1, text: "First DoD item", checked: false }],
					rawContent: "Missing description",
				},
				false,
			);

			const result = await runCli(["task", "validate", "--dor", "TASK-no-desc", "--json"]);
			expect(result.exitCode).toBe(1);

			const output = JSON.parse(result.stdout);
			expect(output.pass).toBe(false);
			const descCheck = output.checks.find((c: { name: string }) => c.name === "description");
			expect(descCheck).toBeDefined();
			expect(descCheck.pass).toBe(false);
		});

		it("should fail when acceptance criteria are missing", async () => {
			const core = new Core(TEST_DIR);
			const milestone = await core.filesystem.createMilestone("Test Milestone");

			await core.createTask(
				{
					id: "task-no-ac",
					title: "No AC Task",
					description: "Has description but no acceptance criteria",
					status: "Backlog",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["complexity:medium"],
					dependencies: [],
					milestone: milestone.id,
					acceptanceCriteriaItems: [],
					definitionOfDoneItems: [{ index: 1, text: "First DoD item", checked: false }],
					rawContent: "Missing AC",
				},
				false,
			);

			const result = await runCli(["task", "validate", "--dor", "TASK-no-ac", "--json"]);
			expect(result.exitCode).toBe(1);

			const output = JSON.parse(result.stdout);
			expect(output.pass).toBe(false);
			const acCheck = output.checks.find((c: { name: string }) => c.name === "acceptance-criteria");
			expect(acCheck).toBeDefined();
			expect(acCheck.pass).toBe(false);
		});

		it("should fail when definition of done is missing", async () => {
			const core = new Core(TEST_DIR);
			const milestone = await core.filesystem.createMilestone("Test Milestone");

			await core.createTask(
				{
					id: "task-no-dod",
					title: "No DoD Task",
					description: "Has description but no definition of done",
					status: "Backlog",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["complexity:medium"],
					dependencies: [],
					milestone: milestone.id,
					acceptanceCriteriaItems: [{ index: 1, text: "First criterion", checked: false }],
					definitionOfDoneItems: [],
					rawContent: "Missing DoD",
				},
				false,
			);

			const result = await runCli(["task", "validate", "--dor", "TASK-no-dod", "--json"]);
			expect(result.exitCode).toBe(1);

			const output = JSON.parse(result.stdout);
			expect(output.pass).toBe(false);
			const dodCheck = output.checks.find((c: { name: string }) => c.name === "definition-of-done");
			expect(dodCheck).toBeDefined();
			expect(dodCheck.pass).toBe(false);
		});

		it("should fail when complexity label is missing", async () => {
			const core = new Core(TEST_DIR);
			const milestone = await core.filesystem.createMilestone("Test Milestone");

			await core.createTask(
				{
					id: "task-no-complexity",
					title: "No Complexity Task",
					description: "Has description but no complexity label",
					status: "Backlog",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["other-label"],
					dependencies: [],
					milestone: milestone.id,
					acceptanceCriteriaItems: [{ index: 1, text: "First criterion", checked: false }],
					definitionOfDoneItems: [{ index: 1, text: "First DoD item", checked: false }],
					rawContent: "Missing complexity",
				},
				false,
			);

			const result = await runCli(["task", "validate", "--dor", "TASK-no-complexity", "--json"]);
			expect(result.exitCode).toBe(1);

			const output = JSON.parse(result.stdout);
			expect(output.pass).toBe(false);
			const complexityCheck = output.checks.find((c: { name: string }) => c.name === "complexity-label");
			expect(complexityCheck).toBeDefined();
			expect(complexityCheck.pass).toBe(false);
		});

		it("should fail when milestone is missing", async () => {
			const core = new Core(TEST_DIR);

			await core.createTask(
				{
					id: "task-no-milestone",
					title: "No Milestone Task",
					description: "Has description but no milestone",
					status: "Backlog",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["complexity:medium"],
					dependencies: [],
					acceptanceCriteriaItems: [{ index: 1, text: "First criterion", checked: false }],
					definitionOfDoneItems: [{ index: 1, text: "First DoD item", checked: false }],
					rawContent: "Missing milestone",
				},
				false,
			);

			const result = await runCli(["task", "validate", "--dor", "TASK-no-milestone", "--json"]);
			expect(result.exitCode).toBe(1);

			const output = JSON.parse(result.stdout);
			expect(output.pass).toBe(false);
			const milestoneCheck = output.checks.find((c: { name: string }) => c.name === "milestone");
			expect(milestoneCheck).toBeDefined();
			expect(milestoneCheck.pass).toBe(false);
		});

		it("should fail when dependencies are not resolvable", async () => {
			const core = new Core(TEST_DIR);
			const milestone = await core.filesystem.createMilestone("Test Milestone");

			await core.createTask(
				{
					id: "task-bad-deps",
					title: "Bad Dependencies Task",
					description: "Has description but unresolvable dependencies",
					status: "Backlog",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["complexity:medium"],
					dependencies: ["TASK-999"],
					milestone: milestone.id,
					acceptanceCriteriaItems: [{ index: 1, text: "First criterion", checked: false }],
					definitionOfDoneItems: [{ index: 1, text: "First DoD item", checked: false }],
					rawContent: "Unresolvable dependency",
				},
				false,
			);

			const result = await runCli(["task", "validate", "--dor", "TASK-bad-deps", "--json"]);
			expect(result.exitCode).toBe(1);

			const output = JSON.parse(result.stdout);
			expect(output.pass).toBe(false);
			const depsCheck = output.checks.find((c: { name: string }) => c.name === "dependencies");
			expect(depsCheck).toBeDefined();
			expect(depsCheck.pass).toBe(false);
			expect(depsCheck.detail).toContain("TASK-999");
		});

		it("should return exit code 2 for unknown task", async () => {
			const result = await runCli(["task", "validate", "--dor", "TASK-nonexistent", "--json"]);
			expect(result.exitCode).toBe(2);
		});

		it("should support human-readable output without --json", async () => {
			const core = new Core(TEST_DIR);
			const milestone = await core.filesystem.createMilestone("Test Milestone");

			await core.createTask(
				{
					id: "task-for-text",
					title: "Task for Text Output",
					description: "This task tests text output",
					status: "Backlog",
					assignee: [],
					createdDate: "2025-06-08",
					labels: ["complexity:low"],
					dependencies: [],
					milestone: milestone.id,
					acceptanceCriteriaItems: [{ index: 1, text: "First criterion", checked: false }],
					definitionOfDoneItems: [{ index: 1, text: "First DoD item", checked: false }],
					rawContent: "Text output test",
				},
				false,
			);

			const result = await runCli(["task", "validate", "--dor", "TASK-for-text"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("TASK-FOR-TEXT");
			expect(result.stdout).not.toContain("schemaVersion");
		});
	});
});
