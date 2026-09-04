import { describe, expect, it } from "bun:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadRippleIssues, mapRippleIssues, RIPPLE_STATUSES } from "../core/ripple-issues.ts";
import { createUniqueTestDir, safeCleanup } from "./test-utils.ts";

const AGENT_ID = "11111111-1111-1111-1111-111111111111";
const SQUAD_ID = "22222222-2222-2222-2222-222222222222";
const PARENT_UUID = "33333333-3333-3333-3333-333333333333";
const CHILD_UUID = "44444444-4444-4444-4444-444444444444";

const issues = [
	{
		id: PARENT_UUID,
		identifier: "PUD-10",
		title: "Parent",
		description: "Parent body",
		status: "in_progress",
		priority: "high",
		assignee_type: "agent",
		assignee_id: AGENT_ID,
		parent_issue_id: null,
		position: 2,
		created_at: "2026-09-01T10:00:00Z",
		updated_at: "2026-09-03T12:00:00Z",
		labels: [{ name: "infra", color: "#fff" }],
	},
	{
		id: CHILD_UUID,
		identifier: "PUD-11",
		title: "Child",
		description: null,
		status: "todo",
		priority: "medium",
		assignee_type: "squad",
		assignee_id: SQUAD_ID,
		parent_issue_id: PARENT_UUID,
		position: 1,
		created_at: "2026-09-02T10:00:00Z",
		updated_at: "2026-09-02T10:00:00Z",
	},
	{
		id: "55555555-5555-5555-5555-555555555555",
		identifier: "PUD-12",
		title: "Unknown assignee",
		description: null,
		status: "blocked",
		priority: "low",
		assignee_type: "member",
		assignee_id: "66666666-6666-6666-6666-666666666666",
		parent_issue_id: null,
		position: 3,
		created_at: "2026-09-02T10:00:00Z",
		updated_at: "2026-09-02T10:00:00Z",
	},
	{
		id: "d",
		identifier: "PUD-13",
		title: "Done",
		status: "done",
		priority: "low",
		position: 4,
		created_at: "2026-09-02T10:00:00Z",
		updated_at: "2026-09-02T10:00:00Z",
	},
	{
		id: "c",
		identifier: "PUD-14",
		title: "Cancelled",
		status: "cancelled",
		priority: "low",
		position: 5,
		created_at: "2026-09-02T10:00:00Z",
		updated_at: "2026-09-02T10:00:00Z",
	},
];

const names = new Map([
	[AGENT_ID, "tech-lead"],
	[SQUAD_ID, "delivery"],
]);

describe("mapRippleIssues", () => {
	it("maps open issues to read-only tasks in board order and drops done/cancelled", () => {
		const tasks = mapRippleIssues(issues, names);
		expect(tasks.map((t) => t.id)).toEqual(["PUD-11", "PUD-10", "PUD-12"]);
		const parent = tasks.find((t) => t.id === "PUD-10");
		expect(parent).toMatchObject({
			title: "Parent",
			status: "in_progress",
			priority: "high",
			description: "Parent body",
			labels: ["infra"],
			assignee: ["tech-lead"],
			createdDate: "2026-09-01",
			updatedDate: "2026-09-03",
			ordinal: 2,
			dependencies: [],
			source: "ripple",
		});
		expect(parent?.parentTaskId).toBeUndefined();
		const child = tasks.find((t) => t.id === "PUD-11");
		expect(child?.parentTaskId).toBe("PUD-10");
		expect(child?.assignee).toEqual(["delivery"]);
		expect(child?.description).toBe("");
		expect(child?.labels).toEqual([]);
		expect(tasks.find((t) => t.id === "PUD-12")?.assignee).toEqual(["66666666"]);
	});

	it("exposes only the open ripple statuses as board columns", () => {
		expect(RIPPLE_STATUSES).toEqual(["backlog", "todo", "in_progress", "in_review", "blocked"]);
	});
});

describe("loadRippleIssues", () => {
	async function writeStub(dir: string, script: string): Promise<string> {
		await mkdir(dir, { recursive: true });
		const path = join(dir, "ripple-stub.sh");
		await writeFile(path, `#!/bin/sh\n${script}\n`);
		await chmod(path, 0o755);
		return path;
	}

	it("runs issue, agent and squad lists through the configured prefix and resolves names", async () => {
		const dir = createUniqueTestDir("ripple-stub");
		try {
			const stub = await writeStub(
				dir,
				`case "$1 $2" in
  "issue list") printf '%s' '${JSON.stringify({ issues, total: 5 })}' ;;
  "agent list") printf '%s' '${JSON.stringify([{ id: AGENT_ID, name: "tech-lead" }])}' ;;
  "squad list") printf '%s' '${JSON.stringify([{ id: SQUAD_ID, name: "delivery" }])}' ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac`,
			);
			const tasks = await loadRippleIssues(stub);
			expect(tasks.map((t) => t.id)).toEqual(["PUD-11", "PUD-10", "PUD-12"]);
			expect(tasks.find((t) => t.id === "PUD-10")?.assignee).toEqual(["tech-lead"]);
			expect(tasks.find((t) => t.id === "PUD-11")?.assignee).toEqual(["delivery"]);
		} finally {
			await safeCleanup(dir);
		}
	});

	it("throws with stderr when issue list fails", async () => {
		const dir = createUniqueTestDir("ripple-stub");
		try {
			const stub = await writeStub(dir, `echo "boom: not logged in" >&2; exit 3`);
			await expect(loadRippleIssues(stub)).rejects.toThrow(/not logged in/);
		} finally {
			await safeCleanup(dir);
		}
	});

	it("still returns issues when agent/squad lists fail", async () => {
		const dir = createUniqueTestDir("ripple-stub");
		try {
			const stub = await writeStub(
				dir,
				`case "$1 $2" in
  "issue list") printf '%s' '${JSON.stringify({ issues, total: 5 })}' ;;
  *) exit 1 ;;
esac`,
			);
			const tasks = await loadRippleIssues(stub);
			expect(tasks.map((t) => t.id)).toEqual(["PUD-11", "PUD-10", "PUD-12"]);
			expect(tasks.find((t) => t.id === "PUD-10")?.assignee).toEqual(["11111111"]);
		} finally {
			await safeCleanup(dir);
		}
	});
});
