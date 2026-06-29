import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { Core } from "../core/backlog.ts";
import type { Task } from "../types/index.ts";
import { createTaskLifecycleNotifier, TASK_LIFECYCLE_SUBJECT } from "../utils/task-lifecycle-notifications.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

const sampleTask = (overrides: Partial<Task> = {}): Task => ({
	id: "task-1",
	title: "Lifecycle Task",
	status: "To Do",
	assignee: [],
	createdDate: "2026-06-29",
	labels: [],
	dependencies: [],
	...overrides,
});

describe("task lifecycle notifications", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = createUniqueTestDir("task-lifecycle-notifications");
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	it("publishes create, status change, archive, and complete events from Core", async () => {
		const events: unknown[] = [];
		const core = new Core(testDir, {
			taskNotifier: {
				notify: async (event: unknown) => {
					events.push(event);
				},
			},
		});
		await initializeTestProject(core, "Lifecycle Notifications");
		const config = await core.filesystem.loadConfig();
		if (!config) {
			throw new Error("Expected test project config to exist");
		}
		await core.filesystem.saveConfig({
			...config,
			remoteOperations: false,
		});

		const { task } = await core.createTaskFromInput({
			title: "Create Event",
			status: "To Do",
			acceptanceCriteria: [{ text: "Ready for work", checked: false }],
			definitionOfDoneAdd: ["Notification test covered"],
		});
		await core.updateTaskFromInput(task.id, { status: "In Progress" });
		await core.archiveTask(task.id, false);

		await core.createTask(sampleTask({ id: "task-2", title: "Complete Event", status: "Done" }), false);
		await core.completeTask("task-2", false);

		expect(events).toHaveLength(5);
		expect(events[0]).toMatchObject({
			action: "created",
			projectRoot: testDir,
			task: { id: task.id, title: "Create Event", status: "To Do" },
		});
		expect(events[1]).toMatchObject({
			action: "status_changed",
			previousStatus: "To Do",
			task: { id: task.id, status: "In Progress" },
		});
		expect(events[2]).toMatchObject({
			action: "archived",
			task: { id: task.id, title: "Create Event" },
		});
		expect(events[3]).toMatchObject({
			action: "created",
			task: { id: "TASK-2", title: "Complete Event" },
		});
		expect(events[4]).toMatchObject({
			action: "completed",
			task: { id: "TASK-2", title: "Complete Event" },
		});
	});

	it("does not publish when startup connection fails", async () => {
		const published: Array<{ subject: string; payload: Uint8Array | string }> = [];
		let connectCalls = 0;
		const notifier = createTaskLifecycleNotifier({
			connect: async () => {
				connectCalls += 1;
				throw new Error("local bellerophon unavailable");
			},
			now: () => "2026-06-29T12:00:00.000Z",
			projectRoot: testDir,
		});

		await notifier.notify({ action: "created", task: sampleTask(), projectRoot: testDir });
		await notifier.notify({ action: "archived", task: sampleTask(), projectRoot: testDir });

		expect(connectCalls).toBe(1);
		expect(published).toHaveLength(0);
	});

	it("publishes structured JSON payloads when connected", async () => {
		const published: Array<{ subject: string; payload: Uint8Array | string }> = [];
		const notifier = createTaskLifecycleNotifier({
			connect: async () => ({
				publish: (subject: string, payload?: Uint8Array | string) => {
					if (payload !== undefined) {
						published.push({ subject, payload });
					}
				},
				flush: async () => undefined,
			}),
			now: () => "2026-06-29T12:00:00.000Z",
			projectRoot: testDir,
		});

		await notifier.notify({
			action: "status_changed",
			previousStatus: "To Do",
			task: sampleTask({ status: "Done" }),
			projectRoot: testDir,
		});

		expect(published).toHaveLength(1);
		expect(published[0]?.subject).toBe(TASK_LIFECYCLE_SUBJECT);

		const bytes = published[0]?.payload;
		const json = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
		expect(JSON.parse(json)).toMatchObject({
			version: 1,
			action: "status_changed",
			previousStatus: "To Do",
			projectRoot: testDir,
			timestamp: "2026-06-29T12:00:00.000Z",
			task: { id: "task-1", title: "Lifecycle Task", status: "Done" },
		});
	});
});
