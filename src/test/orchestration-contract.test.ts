import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Core } from "../core/backlog.ts";
import { parseTask } from "../markdown/parser.ts";
import { serializeTask } from "../markdown/serializer.ts";
import type { Task } from "../types/index.ts";
import { createTaskLifecycleNotifier } from "../utils/task-lifecycle-notifications.ts";
import { initializeTestProject, safeCleanup } from "./test-utils.ts";

describe("orchestration task metadata", () => {
	it("round-trips revision and namespaced orchestration metadata", () => {
		const task: Task = {
			id: "TASK-1",
			title: "Implement the coordinator",
			status: "In Progress",
			assignee: ["@worker"],
			createdDate: "2026-07-12",
			labels: [],
			dependencies: [],
			revision: 3,
			orchestration: {
				executionId: "exec-1",
				role: "implementation",
				planRevision: "sha256:abc",
				planUnitId: "O1",
				workerAgent: "orchestrator-task-implementer",
				parentSessionId: "session-parent",
				workerSessionId: "session-1",
				worktree: "/tmp/worktree-1",
				branch: "opencode/o1",
				baseCommit: "abc123",
				headCommits: ["def456"],
				reviewRound: 1,
				reviewVerdict: "pending",
				lastHeartbeat: "2026-07-12T10:00:00.000Z",
				idempotencyKey: "dispatch:o1:1",
			},
		};

		expect(parseTask(serializeTask(task))).toMatchObject({
			revision: 3,
			orchestration: task.orchestration,
		});
	});
});

describe("orchestration graph and transitions", () => {
	let testDir: string;
	let core: Core;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "orchestration-contract-"));
		core = new Core(testDir);
		await initializeTestProject(core, "Orchestration Contract");
		const config = await core.fs.loadConfig();
		if (!config) throw new Error("Expected config");
		await core.fs.saveConfig({
			...config,
			remoteOperations: false,
			statuses: ["Backlog", "Active", "In Progress", "Review", "Human", "Deferred", "Done"],
		});
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	it("materializes an idempotent parent and dependency graph", async () => {
		const request = {
			executionId: "exec-1",
			idempotencyKey: "materialize:exec-1",
			planRevision: "sha256:abc",
			parent: {
				key: "plan",
				title: "Execute plan",
				status: "Active",
				implementationPlan: "Canonical plan",
			},
			units: [
				{
					key: "O1",
					title: "Foundation",
					status: "Active",
					acceptanceCriteria: ["Foundation works"],
					definitionOfDone: ["Tests pass"],
				},
				{
					key: "O2",
					title: "Consumer",
					status: "Backlog",
					dependsOn: ["O1"],
					modifiedFiles: ["src/consumer.ts"],
				},
			],
		};

		const first = await core.materializeTaskGraph(request);
		const second = await core.materializeTaskGraph(request);

		expect(second).toEqual(first);
		expect(first.tasks).toHaveLength(3);
		const foundation = first.tasks.find((entry) => entry.key === "O1");
		const consumer = first.tasks.find((entry) => entry.key === "O2");
		if (!foundation || !consumer) throw new Error("Expected materialized graph entries");
		expect(consumer.task.dependencies).toEqual([foundation.task.id]);
		expect(consumer?.task.parentTaskId).toBe(first.parent.task.id);
		expect(consumer?.task.orchestration).toMatchObject({
			executionId: "exec-1",
			planRevision: "sha256:abc",
			planUnitId: "O2",
		});
		expect(await core.fs.listTasks()).toHaveLength(3);

		const reconciled = await core.getTaskGraph("exec-1");
		expect(reconciled).toEqual(first);
	});

	it("rejects execution ID and idempotency collisions", async () => {
		const request = {
			executionId: "exec-collision",
			idempotencyKey: "materialize:exec-collision",
			planRevision: "sha256:one",
			parent: { key: "plan", title: "Original plan", status: "Active" },
			units: [{ key: "O1", title: "Original unit", status: "Active" }],
		};
		await core.materializeTaskGraph(request);

		await expect(
			core.materializeTaskGraph({
				...request,
				planRevision: "sha256:two",
				parent: { ...request.parent, title: "Changed plan" },
			}),
		).rejects.toThrow("idempotency key collision");
		await expect(core.materializeTaskGraph({ ...request, idempotencyKey: "materialize:another-key" })).rejects.toThrow(
			"already exists",
		);
	});

	it("recovers an incomplete graph when an exact request is replayed", async () => {
		const request = {
			executionId: "exec-recovery",
			idempotencyKey: "materialize:exec-recovery",
			planRevision: "sha256:recovery",
			parent: { key: "plan", title: "Recover plan", status: "Active" },
			units: [
				{ key: "O1", title: "First", status: "Active" },
				{ key: "O2", title: "Second", status: "Backlog", dependsOn: ["O1"] },
			],
		};
		const first = await core.materializeTaskGraph(request);
		const missing = first.tasks.find((entry) => entry.key === "O2")?.task.filePath;
		if (!missing) throw new Error("Expected a persisted child file");
		await unlink(missing);

		const recovered = await core.materializeTaskGraph(request);
		expect(recovered.tasks.map((entry) => entry.key)).toEqual(["plan", "O1", "O2"]);
		expect(await core.fs.listTasks()).toHaveLength(3);
	});

	it("reports whether the configured project supports orchestration", async () => {
		await expect(core.getOrchestrationCapabilities()).resolves.toMatchObject({
			contractVersion: 1,
			projectName: "Orchestration Contract",
			statuses: expect.arrayContaining(["Review", "Done"]),
			ready: true,
			missingStatuses: [],
			lifecycleEventVersions: [1, 2],
		});

		const config = await core.fs.loadConfig();
		if (!config) throw new Error("Expected config");
		await core.fs.saveConfig({ ...config, statuses: config.statuses.filter((status) => status !== "Review") });
		expect(await core.getOrchestrationCapabilities()).toMatchObject({
			ready: false,
			missingStatuses: ["Review"],
		});
	});

	it("lists non-terminal execution parents for monitor rehydration", async () => {
		await core.materializeTaskGraph({
			executionId: "exec-monitor",
			idempotencyKey: "materialize:exec-monitor",
			planRevision: "sha256:monitor",
			parentSessionId: "session-parent",
			parent: { key: "plan", title: "Monitor plan", status: "Active" },
			units: [],
		});

		await expect(core.listTaskGraphs({ nonTerminal: true })).resolves.toEqual([
			{
				executionId: "exec-monitor",
				parentTaskId: "TASK-1",
				parentSessionId: "session-parent",
				planRevision: "sha256:monitor",
				status: "Active",
				revision: 1,
			},
		]);
	});

	it("rejects cyclic child dependencies before writing any tasks", async () => {
		await expect(
			core.materializeTaskGraph({
				executionId: "exec-cycle",
				idempotencyKey: "materialize:exec-cycle",
				planRevision: "sha256:cycle",
				parent: { key: "plan", title: "Cyclic plan", status: "Active" },
				units: [
					{ key: "O1", title: "First", status: "Backlog", dependsOn: ["O2"] },
					{ key: "O2", title: "Second", status: "Backlog", dependsOn: ["O1"] },
				],
			}),
		).rejects.toThrow("cycle");
		expect(await core.fs.listTasks()).toHaveLength(0);
	});

	it("rejects stale or role-invalid transitions and increments revision once", async () => {
		const { task } = await core.createTaskFromInput({ title: "Worker task", status: "Active" });

		await expect(
			core.transitionOrchestrationTask({
				taskId: task.id,
				expectedStatus: "Active",
				expectedRevision: 1,
				targetStatus: "Done",
				actorRole: "worker",
				idempotencyKey: "close:1",
			}),
		).rejects.toThrow("worker cannot transition Active to Done");

		const claimed = await core.transitionOrchestrationTask({
			taskId: task.id,
			expectedStatus: "Active",
			expectedRevision: 1,
			targetStatus: "In Progress",
			actorRole: "worker",
			idempotencyKey: "claim:1",
		});
		expect(claimed).toMatchObject({ status: "In Progress", revision: 2 });

		await expect(
			core.transitionOrchestrationTask({
				taskId: task.id,
				expectedStatus: "Active",
				expectedRevision: 1,
				targetStatus: "In Progress",
				actorRole: "worker",
				idempotencyKey: "claim:2",
			}),
		).rejects.toThrow("revision mismatch");

		const retry = await core.transitionOrchestrationTask({
			taskId: task.id,
			expectedStatus: "Active",
			expectedRevision: 1,
			targetStatus: "In Progress",
			actorRole: "worker",
			idempotencyKey: "claim:1",
		});
		expect(retry).toMatchObject({ status: "In Progress", revision: 2 });
	});

	it("replays historical transition receipts and rejects key collisions", async () => {
		const graph = await core.materializeTaskGraph({
			executionId: "exec-receipts",
			idempotencyKey: "materialize:exec-receipts",
			planRevision: "sha256:receipts",
			parentSessionId: "session-parent",
			parent: { key: "plan", title: "Receipt plan", status: "Active" },
			units: [{ key: "O1", title: "Worker task", status: "Active" }],
		});
		const task = graph.tasks.find((entry) => entry.key === "O1")?.task;
		if (!task) throw new Error("Expected worker task");
		const claim = {
			taskId: task.id,
			expectedStatus: "Active",
			expectedRevision: 1,
			targetStatus: "In Progress",
			actorRole: "orchestrator" as const,
			actorSessionId: "session-parent",
			idempotencyKey: "claim:receipt",
			orchestration: { executionId: "exec-receipts", workerSessionId: "session-worker" },
		};
		await core.transitionOrchestrationTask(claim);
		await core.transitionOrchestrationTask({
			taskId: task.id,
			expectedStatus: "In Progress",
			expectedRevision: 2,
			targetStatus: "In Progress",
			actorRole: "worker",
			actorSessionId: "session-worker",
			idempotencyKey: "progress:receipt",
			implementationNotes: "Still working",
		});

		await expect(core.transitionOrchestrationTask(claim)).resolves.toMatchObject({
			status: "In Progress",
			revision: 2,
		});
		await expect(core.transitionOrchestrationTask({ ...claim, targetStatus: "Review" })).rejects.toThrow(
			"idempotency key collision",
		);
	});

	it("authorizes orchestration roles against persisted session bindings", async () => {
		const graph = await core.materializeTaskGraph({
			executionId: "exec-roles",
			idempotencyKey: "materialize:exec-roles",
			planRevision: "sha256:roles",
			parentSessionId: "session-parent",
			parent: { key: "plan", title: "Role plan", status: "Active" },
			units: [{ key: "O1", title: "Role task", status: "Active" }],
		});
		const task = graph.tasks.find((entry) => entry.key === "O1")?.task;
		if (!task) throw new Error("Expected role task");
		const dispatch = {
			taskId: task.id,
			expectedStatus: "Active",
			expectedRevision: 1,
			targetStatus: "In Progress",
			actorRole: "orchestrator" as const,
			idempotencyKey: "dispatch:roles",
			orchestration: { executionId: "exec-roles", workerSessionId: "session-worker" },
		};
		await expect(core.transitionOrchestrationTask(dispatch)).rejects.toThrow("actorSessionId");
		await expect(core.transitionOrchestrationTask({ ...dispatch, actorSessionId: "wrong" })).rejects.toThrow(
			"does not match",
		);
		const claimed = await core.transitionOrchestrationTask({ ...dispatch, actorSessionId: "session-parent" });

		const submit = {
			taskId: task.id,
			expectedStatus: "In Progress",
			expectedRevision: claimed.revision ?? 2,
			targetStatus: "Review",
			actorRole: "worker" as const,
			idempotencyKey: "submit:roles",
		};
		await expect(core.transitionOrchestrationTask({ ...submit, actorSessionId: "wrong" })).rejects.toThrow(
			"does not match",
		);
		const submitted = await core.transitionOrchestrationTask({ ...submit, actorSessionId: "session-worker" });
		expect(submitted).toMatchObject({ status: "Review", revision: 3 });
		const reviewerBound = await core.transitionOrchestrationTask({
			taskId: task.id,
			expectedStatus: "Review",
			expectedRevision: 3,
			targetStatus: "Review",
			actorRole: "orchestrator",
			actorSessionId: "session-parent",
			idempotencyKey: "bind-reviewer:roles",
			orchestration: { executionId: "exec-roles", reviewerSessionId: "session-reviewer" },
		});
		await expect(
			core.transitionOrchestrationTask({
				taskId: task.id,
				expectedStatus: "Review",
				expectedRevision: reviewerBound.revision ?? 4,
				targetStatus: "Review",
				actorRole: "reviewer",
				actorSessionId: "wrong",
				idempotencyKey: "review-note:roles",
				implementationNotes: "reviewed",
			}),
		).rejects.toThrow("does not match");
		await expect(
			core.transitionOrchestrationTask({
				taskId: task.id,
				expectedStatus: "Review",
				expectedRevision: reviewerBound.revision ?? 4,
				targetStatus: "Review",
				actorRole: "reviewer",
				actorSessionId: "session-reviewer",
				idempotencyKey: "review-note:roles",
				implementationNotes: "reviewed",
			}),
		).resolves.toMatchObject({ status: "Review", revision: 5 });
	});

	it("blocks generic edits to orchestration-bound tasks", async () => {
		const graph = await core.materializeTaskGraph({
			executionId: "exec-edit-guard",
			idempotencyKey: "materialize:exec-edit-guard",
			planRevision: "sha256:guard",
			parent: { key: "plan", title: "Guard plan", status: "Active" },
			units: [{ key: "O1", title: "Guarded task", status: "Active" }],
		});
		const task = graph.tasks.find((entry) => entry.key === "O1")?.task;
		if (!task) throw new Error("Expected guarded task");

		await expect(core.editTask(task.id, { status: "Done" })).rejects.toThrow("guarded orchestration transition");
		await expect(core.editTask(task.id, { implementationNotes: "bypass" })).rejects.toThrow(
			"guarded orchestration transition",
		);
		await expect(core.editTaskOrDraft(task.id, { status: "Draft" })).rejects.toThrow(
			"guarded orchestration transition",
		);
		await expect(core.archiveTask(task.id)).rejects.toThrow("guarded orchestration transition");
		await expect(core.completeTask(task.id)).rejects.toThrow("guarded orchestration transition");
	});

	it("lets only an accepted orchestrator review complete the task checklist and close", async () => {
		const { task } = await core.createTaskFromInput({
			title: "Reviewed task",
			status: "Review",
			acceptanceCriteria: [{ text: "Behavior verified", checked: false }],
			definitionOfDoneAdd: ["Checks pass"],
			disableDefinitionOfDoneDefaults: true,
		});
		await expect(
			core.transitionOrchestrationTask({
				taskId: task.id,
				expectedStatus: "Review",
				expectedRevision: 1,
				targetStatus: "Done",
				actorRole: "orchestrator",
				idempotencyKey: "review:reject",
				orchestration: { executionId: "exec-review", reviewVerdict: "Reject" },
			}),
		).rejects.toThrow("Accept review verdict");

		const completed = await core.transitionOrchestrationTask({
			taskId: task.id,
			expectedStatus: "Review",
			expectedRevision: 1,
			targetStatus: "Done",
			actorRole: "orchestrator",
			idempotencyKey: "review:accept",
			orchestration: {
				executionId: "exec-review",
				role: "execution",
				parentSessionId: "session-parent",
				reviewVerdict: "Accept",
			},
			finalSummary: "Accepted after independent review and aggregate verification.",
		});
		expect(completed.acceptanceCriteriaItems?.every((item) => item.checked)).toBe(true);
		expect(completed.definitionOfDoneItems?.every((item) => item.checked)).toBe(true);
		expect(completed.finalSummary).toContain("aggregate verification");

		const integrated = await core.transitionOrchestrationTask({
			taskId: task.id,
			expectedStatus: "Done",
			expectedRevision: 2,
			targetStatus: "Done",
			actorRole: "orchestrator",
			actorSessionId: "session-parent",
			idempotencyKey: "integrate:accepted",
			orchestration: { executionId: "exec-review", integrated: true },
		});
		expect(integrated).toMatchObject({ status: "Done", revision: 3 });
		expect(integrated.orchestration?.integrated).toBe(true);
	});
});

describe("orchestration lifecycle envelope", () => {
	it("publishes lifecycle v2 as a v1-shaped superset with orchestration correlation", async () => {
		const published: Array<Uint8Array | string> = [];
		const notifier = createTaskLifecycleNotifier({
			connect: async () => ({
				publish: (_subject, payload) => {
					if (payload !== undefined) published.push(payload);
				},
			}),
			now: () => "2026-07-12T12:00:00.000Z",
		});

		await notifier.notify({
			action: "status_changed",
			projectRoot: "/repo",
			previousStatus: "In Progress",
			actorRole: "worker",
			correlationId: "exec-1",
			idempotencyKey: "submit:1",
			task: {
				id: "TASK-1.1",
				title: "Worker task",
				status: "Review",
				assignee: [],
				createdDate: "2026-07-12",
				labels: [],
				dependencies: [],
				revision: 2,
				orchestration: { executionId: "exec-1", planRevision: "sha256:abc", planUnitId: "O1" },
			},
		});

		const encoded = published[0];
		const json = typeof encoded === "string" ? encoded : new TextDecoder().decode(encoded);
		expect(JSON.parse(json)).toMatchObject({
			version: 2,
			action: "status_changed",
			newState: "Review",
			previousStatus: "In Progress",
			taskRevision: 2,
			executionId: "exec-1",
			planRevision: "sha256:abc",
			actorRole: "worker",
			correlationId: "exec-1",
			idempotencyKey: "submit:1",
			task: { id: "TASK-1.1", status: "Review" },
		});
	});
});
