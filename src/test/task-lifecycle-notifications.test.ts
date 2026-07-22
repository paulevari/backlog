import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { Core } from "../core/backlog.ts";
import type { Task } from "../types/index.ts";
import {
	createTaskLifecycleNotifier,
	scopedBellerophonSubject,
	TASK_LIFECYCLE_SUBJECT,
} from "../utils/task-lifecycle-notifications.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

type EnvUrlCase = {
	name: string;
	env: string | undefined;
	optionUrl?: string;
	expectedServers: string;
};

const envUrlCases: EnvUrlCase[] = [
	{
		name: "explicit options.url wins over BACKLOG_BELLEROPHON_URL",
		env: "evari://env-host:1234",
		optionUrl: "evari://option-host:5555",
		expectedServers: "evari://option-host:5555",
	},
	{
		name: "uses non-empty BACKLOG_BELLEROPHON_URL when no options.url is supplied",
		env: "evari://env-host:1234",
		expectedServers: "evari://env-host:1234",
	},
	{
		name: "trims surrounding whitespace from BACKLOG_BELLEROPHON_URL",
		env: "  evari://env-host:1234  \n",
		expectedServers: "evari://env-host:1234",
	},
	{
		name: "falls back to default when BACKLOG_BELLEROPHON_URL is whitespace-only",
		env: "   ",
		expectedServers: "evari://localhost:9000",
	},
	{
		name: "falls back to default when BACKLOG_BELLEROPHON_URL is unset",
		env: undefined,
		expectedServers: "evari://localhost:9000",
	},
];

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
				notifyRequired: async () => undefined,
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
			projectName: "Lifecycle Notifications",
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

	it("opens connections only for publish attempts and closes them after flushing", async () => {
		const published: Array<{ subject: string; payload: Uint8Array | string }> = [];
		let connectCalls = 0;
		let closeCalls = 0;
		const notifier = createTaskLifecycleNotifier({
			connect: async () => {
				connectCalls += 1;
				return {
					publish: (subject: string, payload?: Uint8Array | string) => {
						if (payload !== undefined) {
							published.push({ subject, payload });
						}
					},
					flush: async () => undefined,
					close: async () => {
						closeCalls += 1;
					},
				};
			},
			now: () => "2026-06-29T12:00:00.000Z",
			projectRoot: testDir,
		});

		expect(connectCalls).toBe(0);

		await notifier.notify({ action: "created", task: sampleTask(), projectRoot: testDir });
		await notifier.notify({ action: "archived", task: sampleTask(), projectRoot: testDir });

		expect(connectCalls).toBe(2);
		expect(published).toHaveLength(2);
		expect(closeCalls).toBe(2);
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
			projectName: "Lifecycle Notifications",
			task: sampleTask({ status: "Done" }),
			projectRoot: testDir,
		});

		expect(published).toHaveLength(1);
		expect(published[0]?.subject).toBe("Lifecycle-Notifications.backlog.task.lifecycle");

		const bytes = published[0]?.payload;
		const json = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
		expect(JSON.parse(json)).toMatchObject({
			version: 2,
			taskRevision: 1,
			action: "status_changed",
			previousStatus: "To Do",
			projectName: "Lifecycle Notifications",
			newState: "Done",
			projectRoot: testDir,
			timestamp: "2026-06-29T12:00:00.000Z",
			task: { id: "task-1", title: "Lifecycle Task", status: "Done" },
		});
	});

	it("keeps the base lifecycle subject when no project name is available", async () => {
		expect(scopedBellerophonSubject(TASK_LIFECYCLE_SUBJECT)).toBe(TASK_LIFECYCLE_SUBJECT);
	});

	it("prefixes lifecycle subjects with a normalized project name", async () => {
		expect(scopedBellerophonSubject(TASK_LIFECYCLE_SUBJECT, "Annie")).toBe("Annie.backlog.task.lifecycle");
		expect(scopedBellerophonSubject(TASK_LIFECYCLE_SUBJECT, "Test Project!")).toBe(
			"Test-Project.backlog.task.lifecycle",
		);
	});

	describe("URL resolution", () => {
		let originalEnvUrl: string | undefined;
		const capturedConnectOptions: Array<Record<string, unknown>> = [];

		const captureConnect = async (options?: Record<string, unknown>) => {
			capturedConnectOptions.push(options ?? {});
			return {
				publish: () => undefined,
				flush: async () => undefined,
				close: async () => undefined,
			};
		};

		beforeAll(() => {
			originalEnvUrl = process.env.BACKLOG_BELLEROPHON_URL;
		});

		beforeEach(() => {
			capturedConnectOptions.length = 0;
		});

		afterEach(() => {
			if (originalEnvUrl === undefined) {
				delete process.env.BACKLOG_BELLEROPHON_URL;
			} else {
				process.env.BACKLOG_BELLEROPHON_URL = originalEnvUrl;
			}
		});

		for (const tc of envUrlCases) {
			it(`resolves ConnectionOptions.servers: ${tc.name}`, async () => {
				if (tc.env === undefined) {
					delete process.env.BACKLOG_BELLEROPHON_URL;
				} else {
					process.env.BACKLOG_BELLEROPHON_URL = tc.env;
				}

				const notifier = createTaskLifecycleNotifier({
					connect: captureConnect,
					...(tc.optionUrl !== undefined ? { url: tc.optionUrl } : {}),
					now: () => "2026-06-29T12:00:00.000Z",
					projectRoot: testDir,
				});

				await notifier.notify({ action: "created", task: sampleTask(), projectRoot: testDir });

				expect(capturedConnectOptions).toEqual([
					{
						name: "backlog.md-task-lifecycle",
						servers: tc.expectedServers,
						timeout: 500,
						reconnect: false,
						maxReconnectAttempts: 0,
					},
				]);
			});
		}
	});
});
