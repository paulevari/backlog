import { describe, expect, it } from "bun:test";
import type { Core } from "../core/backlog.ts";
import type { Task } from "../types/index.ts";
import { pollTasks } from "../utils/task-watcher.ts";

function task(id: string, status: string, updatedDate = "2026-09-01"): Task {
	return { id, title: id, status, assignee: [], labels: [], dependencies: [], createdDate: "2026-09-01", updatedDate };
}

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

describe("pollTasks", () => {
	it("emits add/change/remove by diffing successive loadTasks results", async () => {
		const snapshots: Task[][] = [
			[task("PUD-1", "todo"), task("PUD-2", "todo")],
			[task("PUD-1", "in_progress", "2026-09-02"), task("PUD-3", "todo")],
		];
		let calls = 0;
		const core = { loadTasks: async () => snapshots[Math.min(calls++, snapshots.length - 1)] ?? [] } as unknown as Core;
		const events: string[] = [];
		const watcher = pollTasks(
			core,
			{
				onTaskAdded: (t) => void events.push(`add:${t.id}`),
				onTaskChanged: (t) => void events.push(`change:${t.id}:${t.status}`),
				onTaskRemoved: (id) => void events.push(`remove:${id}`),
			},
			snapshots[0] ?? [],
			20,
		);
		await sleep(60);
		watcher.stop();
		expect(events.slice(0, 3).sort()).toEqual(["add:PUD-3", "change:PUD-1:in_progress", "remove:PUD-2"]);
		expect(events.length).toBe(3);
	});

	it("keeps the last snapshot when a poll fails and stops cleanly", async () => {
		let calls = 0;
		const core = {
			loadTasks: async () => {
				calls++;
				throw new Error("ssh down");
			},
		} as unknown as Core;
		const events: string[] = [];
		const watcher = pollTasks(core, { onTaskRemoved: (id) => void events.push(id) }, [task("PUD-1", "todo")], 10);
		await sleep(40);
		watcher.stop();
		const callsAtStop = calls;
		await sleep(30);
		expect(calls).toBeGreaterThan(0);
		expect(calls).toBe(callsAtStop);
		expect(events).toEqual([]);
	});

	it("does not emit callbacks from a poll that was in flight when stop() was called", async () => {
		let release: () => void = () => {};
		const core = {
			loadTasks: () =>
				new Promise<Task[]>((resolve) => {
					release = () => resolve([task("PUD-9", "todo")]);
				}),
		} as unknown as Core;
		const events: string[] = [];
		const watcher = pollTasks(core, { onTaskAdded: (t) => void events.push(t.id) }, [], 10);
		await sleep(25);
		watcher.stop();
		release();
		await sleep(10);
		expect(events).toEqual([]);
	});
});
