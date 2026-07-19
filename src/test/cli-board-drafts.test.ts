import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { Core } from "../index.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;

describe("CLI board export with drafts", () => {
	const cliPath = join(process.cwd(), "src", "cli.ts");

	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-board-drafts");
		await mkdir(TEST_DIR, { recursive: true });

		await $`git init -b main`.cwd(TEST_DIR).quiet();
		await $`git config user.name "Test User"`.cwd(TEST_DIR).quiet();
		await $`git config user.email test@example.com`.cwd(TEST_DIR).quiet();

		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "Board Drafts Project");

		await core.createTask(
			{
				id: "task-1",
				title: "Board task",
				status: "To Do",
				assignee: [],
				labels: [],
				dependencies: [],
				createdDate: "2026-01-01",
				rawContent: "Task body",
			},
			false,
		);

		await $`bun ${cliPath} task create "Intake capture entry" --draft -d "Draft body"`.cwd(TEST_DIR).quiet();
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("includes a leading Draft column when --include-drafts is set", async () => {
		const result = await $`bun ${cliPath} board export board-drafts.md --include-drafts --force`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);

		const board = await Bun.file(join(TEST_DIR, "board-drafts.md")).text();
		expect(board).toMatch(/^\| Draft \|/m);
		expect(board).toContain("Intake capture entry");
		expect(board).toContain("Board task");
	});

	it("leaves the board unchanged without the flag", async () => {
		const result = await $`bun ${cliPath} board export board-plain.md --force`.cwd(TEST_DIR).quiet();
		expect(result.exitCode).toBe(0);

		const board = await Bun.file(join(TEST_DIR, "board-plain.md")).text();
		expect(board).not.toContain("Intake capture entry");
		expect(board).not.toMatch(/\| Draft \|/);
		expect(board).toContain("Board task");
	});
});
