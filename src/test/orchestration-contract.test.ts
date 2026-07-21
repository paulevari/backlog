import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { chmod, copyFile, link, mkdtemp, readFile, rename, stat, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { $ } from "bun";
import { Core } from "../core/backlog.ts";
import { parseTask } from "../markdown/parser.ts";
import { serializeTask } from "../markdown/serializer.ts";
import type { Task } from "../types/index.ts";
import { createTaskLifecycleNotifier, type TaskLifecycleNotifier } from "../utils/task-lifecycle-notifications.ts";
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
			statuses: ["Backlog", "Active", "In Progress", "Review", "Approved", "Human", "Deferred", "Done"],
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
			features: {
				atomicDescriptionTransition: true,
				atomicFamilyCompletion: true,
			},
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

	it("atomically replaces the description during a guarded Backlog to Deferred transition", async () => {
		const graph = await core.materializeTaskGraph({
			executionId: "exec-deferred",
			idempotencyKey: "materialize:exec-deferred",
			planRevision: "sha256:deferred",
			parentSessionId: "session-parent",
			parent: {
				key: "plan",
				title: "Deferred plan",
				status: "Backlog",
				description: "Original description",
				acceptanceCriteria: ["External release is observable"],
				definitionOfDone: ["Release digest is verified"],
			},
			units: [],
		});
		const request = {
			taskId: graph.parent.task.id,
			expectedStatus: "Backlog",
			expectedRevision: 1,
			targetStatus: "Deferred",
			actorRole: "orchestrator" as const,
			actorSessionId: "session-parent",
			idempotencyKey: "defer:exec-deferred",
			description: "Unblock when: the external release is observable.\n\nEvidence must include its release digest.",
		};

		const deferred = await core.transitionOrchestrationTask(request);
		expect(deferred).toMatchObject({ status: "Deferred", revision: 2, description: request.description });
		await expect(core.transitionOrchestrationTask(request)).resolves.toEqual(deferred);
		await expect(
			core.transitionOrchestrationTask({ ...request, description: "Unblock when: a different release appears." }),
		).rejects.toThrow("idempotency key collision");
		await expect(
			core.transitionOrchestrationTask({
				...request,
				idempotencyKey: "defer:stale",
				description: "Unblock when: stale evidence appears.",
			}),
		).rejects.toThrow("revision mismatch");
		expect(await core.fs.loadTask(graph.parent.task.id)).toMatchObject({
			status: "Deferred",
			revision: 2,
			description: request.description,
		});
	});

	it("limits guarded description replacement to the declared Backlog to Deferred operation", async () => {
		const { task } = await core.createTaskFromInput({ title: "Patch boundary", status: "Review" });
		await expect(
			core.transitionOrchestrationTask({
				taskId: task.id,
				expectedStatus: "Review",
				expectedRevision: 1,
				targetStatus: "Review",
				actorRole: "orchestrator",
				idempotencyKey: "patch:description",
				description: "A generic description patch must not be available.",
			}),
		).rejects.toThrow("description replacement is only allowed for Backlog to Deferred");
		expect((await core.fs.loadTask(task.id))?.description ?? "").toBe("");
	});

	const expectedFamilyModes = new Map([
		["TASK-20.1", 0o600],
		["TASK-20.1.1", 0o640],
		["TASK-20", 0o754],
	]);

	async function applyFamilyModes(targetCore = core): Promise<void> {
		for (const task of await targetCore.fs.listTasks()) {
			if (!task.filePath) throw new Error(`Expected persisted ${task.id}`);
			const mode = expectedFamilyModes.get(task.id);
			if (mode === undefined) throw new Error(`Expected mode for ${task.id}`);
			await chmod(task.filePath, mode);
		}
	}

	async function expectFamilyModes(tasks: Task[]): Promise<void> {
		for (const task of tasks) {
			if (!task.filePath) throw new Error(`Expected persisted ${task.id}`);
			const mode = expectedFamilyModes.get(task.id);
			if (mode === undefined) throw new Error(`Expected mode for ${task.id}`);
			expect((await stat(task.filePath)).mode & 0o777).toBe(mode);
		}
	}

	async function createDoneFamily(executionId: string, targetCore = core, terminalStatus = "Done") {
		await targetCore.createTask(
			{
				id: "TASK-20",
				title: "Family root",
				status: terminalStatus,
				assignee: [],
				createdDate: "2026-07-21",
				labels: [],
				dependencies: [],
				rawContent: "",
				revision: 4,
				orchestration: {
					executionId,
					role: "execution",
					parentSessionId: "session-parent",
					reviewVerdict: "Accept",
					integrated: true,
				},
			},
			false,
		);
		await targetCore.createTask(
			{
				id: "TASK-20.1",
				title: "Family child",
				status: terminalStatus,
				assignee: [],
				createdDate: "2026-07-21",
				labels: [],
				dependencies: [],
				parentTaskId: "TASK-20",
				rawContent: "",
				revision: 3,
				orchestration: { executionId, role: "implementation", reviewVerdict: "Accept", integrated: true },
			},
			false,
		);
		await targetCore.createTask(
			{
				id: "TASK-20.1.1",
				title: "Nested family child",
				status: terminalStatus,
				assignee: [],
				createdDate: "2026-07-21",
				labels: [],
				dependencies: [],
				parentTaskId: "TASK-20.1",
				rawContent: "",
				revision: 2,
				orchestration: { executionId, role: "implementation", reviewVerdict: "Accept", integrated: true },
			},
			false,
		);
		return {
			familyRootTaskId: "TASK-20",
			members: [
				{ taskId: "TASK-20.1", expectedStatus: terminalStatus, expectedRevision: 3 },
				{ taskId: "TASK-20.1.1", expectedStatus: terminalStatus, expectedRevision: 2 },
				{ taskId: "TASK-20", expectedStatus: terminalStatus, expectedRevision: 4 },
			],
			actorRole: "orchestrator" as const,
			actorSessionId: "session-parent",
			idempotencyKey: `family-complete:${executionId}`,
		};
	}

	async function initializeCrashFamily(crashDir: string, autoCommit: boolean): Promise<Core> {
		if (autoCommit) {
			await $`git init -b main`.cwd(crashDir).quiet();
			await $`git config user.name "Test User"`.cwd(crashDir).quiet();
			await $`git config user.email test@example.com`.cwd(crashDir).quiet();
		}
		const crashCore = new Core(crashDir, {
			taskNotifier: { notify: async () => undefined, notifyRequired: async () => undefined },
		});
		await initializeTestProject(crashCore, "Family crash recovery", autoCommit);
		const config = await crashCore.fs.loadConfig();
		if (!config) throw new Error("Expected crash fixture config");
		await crashCore.fs.saveConfig({
			...config,
			autoCommit,
			remoteOperations: false,
			statuses: ["Backlog", "Active", "In Progress", "Review", "Approved", "Human", "Deferred", "Done"],
		});
		await createDoneFamily("exec-family-crash", crashCore);
		if (autoCommit) {
			const repoRoot = await crashCore.gitOps.stageBacklogDirectory(crashCore.fs.backlogDirName);
			await crashCore.gitOps.commitChanges("test: prepare crash family", repoRoot);
		}
		return crashCore;
	}

	async function runCrashChild(crashDir: string, crashPoint: string, lifecycleLog: string) {
		const child = spawn(
			process.execPath,
			[join(import.meta.dir, "fixtures", "orchestration-family-crash-child.ts"), crashDir, crashPoint, lifecycleLog],
			{
				cwd: join(import.meta.dir, "..", ".."),
				env: { ...process.env, USE_GLOBAL_TASK_ID_LOCK: "false" },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => resolve({ code, signal }));
		});
		return { ...result, stderr };
	}

	async function listCommittedPaths(repoRoot: string, treeish = "HEAD"): Promise<string[]> {
		return (await $`git ls-tree -r --name-only ${treeish}`.cwd(repoRoot).quiet().text())
			.trim()
			.split("\n")
			.filter(Boolean)
			.sort();
	}

	async function expectCommittedFamilyMove(
		targetCore: Core,
		repoRoot: string,
		activePaths: readonly string[],
	): Promise<void> {
		const completedPaths = (await targetCore.fs.listCompletedTasks())
			.map((task) => task.filePath)
			.filter((filePath): filePath is string => filePath !== undefined)
			.map((filePath) => relative(repoRoot, filePath).replaceAll("\\", "/"))
			.sort();
		const expectedChangedPaths = [...activePaths, ...completedPaths].sort();
		const committedPaths = await listCommittedPaths(repoRoot);
		const changedPaths = (
			await $`git diff-tree --no-commit-id --name-only --no-renames -r HEAD`.cwd(repoRoot).quiet().text()
		)
			.trim()
			.split("\n")
			.filter(Boolean)
			.sort();

		for (const activePath of activePaths) expect(committedPaths).not.toContain(activePath);
		expect(completedPaths).toHaveLength(activePaths.length);
		for (const completedPath of completedPaths) expect(committedPaths).toContain(completedPath);
		expect(changedPaths).toEqual(expectedChangedPaths);
		expect((await $`git diff --cached --name-only`.cwd(repoRoot).quiet().text()).trim()).toBe("");
		expect((await $`git status --porcelain=v1`.cwd(repoRoot).quiet().text()).trim()).toBe("");
	}

	const crashPoints = [
		"receipt.temp_created:TASK-20",
		"receipt.file_synced:TASK-20",
		"receipt.before_stage:TASK-20",
		"receipt.before_install:TASK-20",
		"receipt.replaced:TASK-20",
		"receipt.directory_synced:TASK-20",
		"move.before_stage:TASK-20.1",
		"move.target_linked:TASK-20.1",
		"move.target_directory_synced:TASK-20.1",
		"move.source_unlinked:TASK-20.1",
		"move.source_directory_synced:TASK-20.1",
		"move.before_stage_unlink:TASK-20.1",
		"lifecycle.before_publish:TASK-20.1",
		"lifecycle.after_publish:TASK-20.1",
		"git.before_commit",
		"git.after_commit",
	] as const;

	for (const crashPoint of crashPoints) {
		it(`converges after SIGKILL at family boundary ${crashPoint}`, async () => {
			const crashDir = await mkdtemp(join(tmpdir(), "orchestration-family-crash-"));
			const lifecycleLog = join(crashDir, "lifecycle.jsonl");
			const autoCommit = crashPoint.startsWith("git.");
			try {
				await initializeCrashFamily(crashDir, autoCommit);
				const activePaths = autoCommit
					? (await listCommittedPaths(crashDir)).filter((filePath) => filePath.startsWith("backlog/tasks/"))
					: [];
				const preparedCommitCount = autoCommit
					? Number((await $`git rev-list --count HEAD`.cwd(crashDir).quiet().text()).trim())
					: 0;
				const child = await runCrashChild(crashDir, crashPoint, lifecycleLog);
				expect(child).toMatchObject({ signal: "SIGKILL", stderr: "" });

				const replayed: Array<{ taskId: string; idempotencyKey?: string }> = [];
				const restarted = new Core(crashDir, {
					taskNotifier: {
						notify: async (event) => {
							replayed.push({ taskId: event.task.id, idempotencyKey: event.idempotencyKey });
						},
						notifyRequired: async (event) => {
							replayed.push({ taskId: event.task.id, idempotencyKey: event.idempotencyKey });
						},
					},
				});
				const request = {
					familyRootTaskId: "TASK-20",
					members: [
						{ taskId: "TASK-20.1", expectedStatus: "Done", expectedRevision: 3 },
						{ taskId: "TASK-20.1.1", expectedStatus: "Done", expectedRevision: 2 },
						{ taskId: "TASK-20", expectedStatus: "Done", expectedRevision: 4 },
					],
					actorRole: "orchestrator" as const,
					actorSessionId: "session-parent",
					idempotencyKey: "family-complete:exec-family-crash",
				};
				const previousLockSetting = process.env.USE_GLOBAL_TASK_ID_LOCK;
				process.env.USE_GLOBAL_TASK_ID_LOCK = "false";
				try {
					await restarted.completeOrchestrationTaskFamily(request);
				} finally {
					if (previousLockSetting === undefined) delete process.env.USE_GLOBAL_TASK_ID_LOCK;
					else process.env.USE_GLOBAL_TASK_ID_LOCK = previousLockSetting;
				}

				expect(await restarted.fs.listTasks()).toHaveLength(0);
				expect((await restarted.fs.listCompletedTasks()).map((task) => task.id).sort()).toEqual([
					"TASK-20",
					"TASK-20.1",
					"TASK-20.1.1",
				]);
				if (autoCommit) {
					expect(await restarted.gitOps.isClean()).toBe(true);
					await expectCommittedFamilyMove(restarted, crashDir, activePaths);
					expect(Number((await $`git rev-list --count HEAD`.cwd(crashDir).quiet().text()).trim())).toBe(
						preparedCommitCount + 1,
					);
				}
				const priorLines = await readFile(lifecycleLog, "utf8")
					.then((content) => content.trim().split("\n").filter(Boolean))
					.catch(() => []);
				const attempts = [
					...priorLines.map((line) => JSON.parse(line) as { taskId: string; idempotencyKey?: string }),
					...replayed,
				];
				const byTask = new Map<string, Set<string | undefined>>();
				for (const attempt of attempts) {
					const keys = byTask.get(attempt.taskId) ?? new Set<string | undefined>();
					keys.add(attempt.idempotencyKey);
					byTask.set(attempt.taskId, keys);
				}
				expect([...byTask.keys()].sort()).toEqual(["TASK-20", "TASK-20.1", "TASK-20.1.1"]);
				expect([...byTask.values()].every((keys) => keys.size === 1 && !keys.has(undefined))).toBe(true);
				expect(new Set([...byTask.values()].map((keys) => [...keys][0])).size).toBe(3);
			} finally {
				await safeCleanup(crashDir);
			}
		}, 20_000);
	}

	it("completes an exact guarded family child-first and replays the durable result", async () => {
		const request = await createDoneFamily("exec-family");
		const completed = await core.completeOrchestrationTaskFamily(request);
		expect(completed).toEqual({
			familyRootTaskId: "TASK-20",
			completedMemberIds: ["TASK-20.1", "TASK-20.1.1", "TASK-20"],
			idempotentReplay: false,
		});
		expect(await core.fs.listTasks()).toHaveLength(0);
		expect((await core.fs.listCompletedTasks()).map((task) => task.id).sort()).toEqual([
			"TASK-20",
			"TASK-20.1",
			"TASK-20.1.1",
		]);

		await expect(core.completeOrchestrationTaskFamily(request)).resolves.toEqual({
			...completed,
			idempotentReplay: true,
		});
		await expect(
			core.completeOrchestrationTaskFamily({
				...request,
				members: request.members.map((member) =>
					member.taskId === "TASK-20.1" ? { ...member, expectedRevision: 99 } : member,
				),
			}),
		).rejects.toThrow("idempotency key collision");
	});

	it("uses the configured canonical terminal status for family completion", async () => {
		const config = await core.fs.loadConfig();
		if (!config) throw new Error("Expected config");
		await core.fs.saveConfig({
			...config,
			statuses: ["Backlog", "Active", "In Progress", "Review", "Approved", "Human", "Deferred", "done"],
		});
		const request = await createDoneFamily("exec-family-lowercase-terminal", core, "done");
		const callerCaseVariant = {
			...request,
			members: request.members.map((member) => ({ ...member, expectedStatus: "DONE" })),
		};

		await expect(core.completeOrchestrationTaskFamily(callerCaseVariant)).resolves.toMatchObject({
			idempotentReplay: false,
		});
		expect((await core.fs.listCompletedTasks()).map((task) => task.status)).toEqual(["done", "done", "done"]);
		await expect(core.completeOrchestrationTaskFamily(request)).resolves.toMatchObject({ idempotentReplay: true });
	});

	it("rejects completed-family replay when active membership drifted", async () => {
		const request = await createDoneFamily("exec-family-membership-drift");
		await core.completeOrchestrationTaskFamily(request);
		await core.createTask(
			{
				id: "TASK-20.2",
				title: "Late family child",
				status: "Done",
				assignee: [],
				createdDate: "2026-07-21",
				labels: [],
				dependencies: [],
				parentTaskId: "TASK-20",
				rawContent: "",
				revision: 1,
				orchestration: {
					executionId: "exec-family-membership-drift",
					role: "implementation",
					reviewVerdict: "Accept",
					integrated: true,
				},
			},
			false,
		);

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("membership mismatch");
		expect((await core.fs.listTasks()).map((task) => task.id)).toEqual(["TASK-20.2"]);
	});

	it("rejects completed-family replay when an active duplicate differs", async () => {
		const request = await createDoneFamily("exec-family-duplicate-drift");
		await core.completeOrchestrationTaskFamily(request);
		const completedChild = (await core.fs.listCompletedTasks()).find((task) => task.id === "TASK-20.1");
		if (!completedChild) throw new Error("Expected completed family child");
		const { filePath: _completedPath, ...activeDuplicate } = completedChild;
		await core.fs.saveTask({ ...activeDuplicate, title: "Tampered active duplicate" });

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow(
			"differs between active and completed storage",
		);
		expect((await core.fs.listTasks()).map((task) => task.id)).toEqual(["TASK-20.1"]);
	});

	it("rejects a byte-identical active duplicate with a different filesystem identity", async () => {
		const request = await createDoneFamily("exec-family-duplicate-identity");
		await core.completeOrchestrationTaskFamily(request);
		const completedChild = (await core.fs.listCompletedTasks()).find((task) => task.id === "TASK-20.1");
		if (!completedChild?.filePath) throw new Error("Expected completed family child");
		const activePath = join(core.fs.tasksDir, basename(completedChild.filePath));
		await copyFile(completedChild.filePath, activePath);
		const [active, completed] = await Promise.all([stat(activePath), stat(completedChild.filePath)]);
		expect({ device: active.dev, inode: active.ino }).not.toEqual({ device: completed.dev, inode: completed.ino });

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("duplicate identity");
		expect((await core.fs.listTasks()).map((task) => task.id)).toEqual(["TASK-20.1"]);
	});

	it("resumes linked names created by the durable move even when the object has another hard link", async () => {
		const request = await createDoneFamily("exec-family-hard-link-recovery");
		await core.completeOrchestrationTaskFamily(request);
		const completedChild = (await core.fs.listCompletedTasks()).find((task) => task.id === "TASK-20.1");
		if (!completedChild?.filePath) throw new Error("Expected completed family child");
		const activePath = join(core.fs.tasksDir, basename(completedChild.filePath));
		const extraPath = join(testDir, "family-child-extra-link");
		await link(completedChild.filePath, activePath);
		await link(completedChild.filePath, extraPath);
		const [activeBefore, completedBefore] = await Promise.all([stat(activePath), stat(completedChild.filePath)]);
		expect({ device: activeBefore.dev, inode: activeBefore.ino, links: activeBefore.nlink }).toEqual({
			device: completedBefore.dev,
			inode: completedBefore.ino,
			links: 3,
		});

		await expect(core.completeOrchestrationTaskFamily(request)).resolves.toMatchObject({ idempotentReplay: true });
		expect((await core.fs.listTasks()).map((task) => task.id)).not.toContain("TASK-20.1");
		expect((await stat(completedChild.filePath)).nlink).toBe(2);
	});

	it("preserves every task file mode through receipt publication and replay", async () => {
		const request = await createDoneFamily("exec-family-mode");
		await applyFamilyModes();

		await core.completeOrchestrationTaskFamily(request);
		await expectFamilyModes(await core.fs.listCompletedTasks());

		await core.completeOrchestrationTaskFamily(request);
		await expectFamilyModes(await core.fs.listCompletedTasks());
	});

	it("rejects unsupported family member metadata before replacing the durable receipt", async () => {
		const request = await createDoneFamily("exec-family-mode-preflight");
		const child = await core.fs.loadTask("TASK-20.1");
		const root = await core.fs.loadTask("TASK-20");
		if (!child?.filePath || !root?.filePath) throw new Error("Expected persisted family files");
		const rootBytesBefore = await readFile(root.filePath);
		const childTarget = join(testDir, "family-child-target");
		await rename(child.filePath, childTarget);
		await symlink(childTarget, child.filePath);

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("unsupported file metadata");
		expect(await readFile(root.filePath)).toEqual(rootBytesBefore);
		expect((await core.fs.loadTask("TASK-20"))?.orchestration?.familyCompletionReceipts).toBeUndefined();
	});

	it("rejects a malformed Done descendant before replacing the durable receipt", async () => {
		const request = await createDoneFamily("exec-family-malformed-inventory");
		const child = await core.fs.loadTask("TASK-20.1");
		const root = await core.fs.loadTask("TASK-20");
		if (!child?.filePath || !root?.filePath) throw new Error("Expected persisted family files");
		const rootBytesBefore = await readFile(root.filePath);
		await Bun.write(child.filePath, "---\nid: [\n---\n");

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("could not parse task artifact");
		expect(await readFile(root.filePath)).toEqual(rootBytesBefore);
		expect(
			parseTask((await readFile(root.filePath)).toString("utf8")).orchestration?.familyCompletionReceipts,
		).toBeUndefined();
	});

	it("rejects a malformed completed descendant before replaying a durable receipt", async () => {
		const request = await createDoneFamily("exec-family-malformed-completed-inventory");
		await core.completeOrchestrationTaskFamily(request);
		const completed = await core.fs.listCompletedTasks();
		const child = completed.find((task) => task.id === "TASK-20.1");
		const root = completed.find((task) => task.id === "TASK-20");
		if (!child?.filePath || !root?.filePath) throw new Error("Expected completed family files");
		const rootBytesBefore = await readFile(root.filePath);
		await Bun.write(child.filePath, "---\nid: [\n---\n");

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("could not parse task artifact");
		expect(await readFile(root.filePath)).toEqual(rootBytesBefore);
	});

	it("rejects an unreadable Done descendant before replacing the durable receipt", async () => {
		const request = await createDoneFamily("exec-family-unreadable-inventory");
		const child = await core.fs.loadTask("TASK-20.1");
		const root = await core.fs.loadTask("TASK-20");
		if (!child?.filePath || !root?.filePath) throw new Error("Expected persisted family files");
		const rootBytesBefore = await readFile(root.filePath);
		await chmod(child.filePath, 0o000);
		try {
			await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("could not read task artifact");
		} finally {
			await chmod(child.filePath, 0o600);
		}
		expect(await readFile(root.filePath)).toEqual(rootBytesBefore);
		expect(
			parseTask((await readFile(root.filePath)).toString("utf8")).orchestration?.familyCompletionReceipts,
		).toBeUndefined();
	});

	it("rejects an ambiguous Done descendant inventory before replacing the durable receipt", async () => {
		const request = await createDoneFamily("exec-family-ambiguous-inventory");
		const child = await core.fs.loadTask("TASK-20.1");
		const root = await core.fs.loadTask("TASK-20");
		if (!child?.filePath || !root?.filePath) throw new Error("Expected persisted family files");
		const rootBytesBefore = await readFile(root.filePath);
		const duplicate = parseTask((await readFile(child.filePath)).toString("utf8"));
		await Bun.write(
			join(core.fs.tasksDir, "task-020.01 - Ambiguous family child.md"),
			serializeTask({ ...duplicate, id: "TASK-020.01" }),
		);

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("ambiguous task identity");
		expect(await readFile(root.filePath)).toEqual(rootBytesBefore);
		expect(
			parseTask((await readFile(root.filePath)).toString("utf8")).orchestration?.familyCompletionReceipts,
		).toBeUndefined();
	});

	it("replays lifecycle delivery with deterministic per-member idempotency after publication fails", async () => {
		const request = await createDoneFamily("exec-family-lifecycle-replay");
		const firstAttempts: Array<{ taskId: string; idempotencyKey?: string }> = [];
		(core as unknown as { taskNotifier: TaskLifecycleNotifier }).taskNotifier = {
			notify: async () => undefined,
			notifyRequired: async (event) => {
				firstAttempts.push({ taskId: event.task.id, idempotencyKey: event.idempotencyKey });
				throw new Error("injected lifecycle publication failure");
			},
		};

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow(
			"injected lifecycle publication failure",
		);
		const replayed: Array<{ taskId: string; idempotencyKey?: string }> = [];
		(core as unknown as { taskNotifier: TaskLifecycleNotifier }).taskNotifier = {
			notify: async () => undefined,
			notifyRequired: async (event) => {
				replayed.push({ taskId: event.task.id, idempotencyKey: event.idempotencyKey });
			},
		};

		await expect(core.completeOrchestrationTaskFamily(request)).resolves.toMatchObject({ idempotentReplay: true });
		expect(replayed.map((event) => event.taskId)).toEqual(["TASK-20.1", "TASK-20.1.1", "TASK-20"]);
		expect(firstAttempts[0]?.idempotencyKey).toBe(replayed[0]?.idempotencyKey);
		expect(new Set(replayed.map((event) => event.idempotencyKey)).size).toBe(3);
	});

	it("surfaces production lifecycle failure and retries every member on exact replay", async () => {
		const request = await createDoneFamily("exec-family-production-lifecycle-replay");
		const published: Array<Uint8Array | string> = [];
		let connectCalls = 0;
		(core as unknown as { taskNotifier: TaskLifecycleNotifier }).taskNotifier = createTaskLifecycleNotifier({
			connect: async () => {
				connectCalls += 1;
				if (connectCalls === 1) throw new Error("transient lifecycle connection failure");
				return {
					publish: (_subject, payload) => {
						if (payload !== undefined) published.push(payload);
					},
					flush: async () => undefined,
				};
			},
		});

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow(
			"transient lifecycle connection failure",
		);
		expect(published).toHaveLength(0);

		await expect(core.completeOrchestrationTaskFamily(request)).resolves.toMatchObject({ idempotentReplay: true });
		const replayed = published.map((payload) =>
			JSON.parse(typeof payload === "string" ? payload : new TextDecoder().decode(payload)),
		) as Array<{ task: { id: string }; idempotencyKey?: string }>;
		expect(replayed.map((event) => event.task.id)).toEqual(["TASK-20.1", "TASK-20.1.1", "TASK-20"]);
		expect(new Set(replayed.map((event) => event.task.id)).size).toBe(3);
		expect(new Set(replayed.map((event) => event.idempotencyKey)).size).toBe(3);
		expect(replayed.every((event) => event.idempotencyKey !== undefined)).toBe(true);
		expect(connectCalls).toBe(4);
	});

	it("rejects required family delivery when the notifier has no required-delivery implementation", async () => {
		const request = await createDoneFamily("exec-family-required-notifier-missing");
		let bestEffortAttempts = 0;
		(core as unknown as { taskNotifier: TaskLifecycleNotifier }).taskNotifier = {
			notify: async () => {
				bestEffortAttempts += 1;
			},
		} as unknown as TaskLifecycleNotifier;

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("required lifecycle delivery");
		expect(bestEffortAttempts).toBe(0);
		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("required lifecycle delivery");
	});

	it("rejects required family delivery when lifecycle notifications are disabled", async () => {
		const previous = process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS;
		process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS = "0";
		const disabledCore = new Core(testDir);
		if (previous === undefined) delete process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS;
		else process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS = previous;
		const request = await createDoneFamily("exec-family-required-notifier-disabled", disabledCore);

		await expect(disabledCore.completeOrchestrationTaskFamily(request)).rejects.toThrow(
			"lifecycle notifications are disabled",
		);
		await expect(disabledCore.completeOrchestrationTaskFamily(request)).rejects.toThrow(
			"lifecycle notifications are disabled",
		);
	});

	it("honors configured autoCommit for family completion", async () => {
		const gitDir = await mkdtemp(join(tmpdir(), "orchestration-family-autocommit-"));
		try {
			await $`git init -b main`.cwd(gitDir).quiet();
			await $`git config user.name "Test User"`.cwd(gitDir).quiet();
			await $`git config user.email test@example.com`.cwd(gitDir).quiet();
			const gitCore = new Core(gitDir, {
				taskNotifier: { notify: async () => undefined, notifyRequired: async () => undefined },
			});
			await initializeTestProject(gitCore, "Family autoCommit", true);
			const config = await gitCore.fs.loadConfig();
			if (!config) throw new Error("Expected git-backed config");
			await gitCore.fs.saveConfig({
				...config,
				autoCommit: true,
				remoteOperations: false,
				statuses: ["Backlog", "Active", "In Progress", "Review", "Approved", "Human", "Deferred", "Done"],
			});
			await createDoneFamily("exec-family-autocommit", gitCore);
			const activePaths = (await gitCore.fs.listTasks())
				.map((task) => task.filePath)
				.filter((filePath): filePath is string => filePath !== undefined)
				.map((filePath) => relative(gitDir, filePath).replaceAll("\\", "/"))
				.sort();
			const initialCommitCount = Number((await $`git rev-list --count HEAD`.cwd(gitDir).quiet().text()).trim());
			const repoRoot = await gitCore.gitOps.stageBacklogDirectory(gitCore.fs.backlogDirName);
			await gitCore.gitOps.commitChanges("test: prepare family completion", repoRoot);
			expect(await gitCore.gitOps.isClean()).toBe(true);

			const request = {
				familyRootTaskId: "TASK-20",
				members: [
					{ taskId: "TASK-20.1", expectedStatus: "Done", expectedRevision: 3 },
					{ taskId: "TASK-20.1.1", expectedStatus: "Done", expectedRevision: 2 },
					{ taskId: "TASK-20", expectedStatus: "Done", expectedRevision: 4 },
				],
				actorRole: "orchestrator" as const,
				actorSessionId: "session-parent",
				idempotencyKey: "family-complete:exec-family-autocommit",
			};
			await gitCore.completeOrchestrationTaskFamily(request);
			expect(await gitCore.gitOps.isClean()).toBe(true);
			await expectCommittedFamilyMove(gitCore, gitDir, activePaths);
			expect(Number((await $`git rev-list --count HEAD`.cwd(gitDir).quiet().text()).trim())).toBe(
				initialCommitCount + 2,
			);
		} finally {
			await safeCleanup(gitDir);
		}
	});

	it("resumes an exact replay from a durable receipt after an interrupted partial move", async () => {
		const request = await createDoneFamily("exec-family-resume");
		await applyFamilyModes();
		await core.completeOrchestrationTaskFamily(request);
		const completed = await core.fs.listCompletedTasks();
		for (const taskId of ["TASK-20.1.1", "TASK-20"]) {
			const task = completed.find((candidate) => candidate.id === taskId);
			if (!task?.filePath) throw new Error(`Expected completed ${taskId}`);
			await rename(task.filePath, join(core.fs.tasksDir, basename(task.filePath)));
		}

		await expect(core.completeOrchestrationTaskFamily(request)).resolves.toEqual({
			familyRootTaskId: "TASK-20",
			completedMemberIds: ["TASK-20.1", "TASK-20.1.1", "TASK-20"],
			idempotentReplay: true,
		});
		expect(await core.fs.listTasks()).toHaveLength(0);
		expect((await core.fs.listCompletedTasks()).map((task) => task.id).sort()).toEqual([
			"TASK-20",
			"TASK-20.1",
			"TASK-20.1.1",
		]);
		await expectFamilyModes(await core.fs.listCompletedTasks());
	});

	it("rejects unauthorized, stale, non-Done, and inexact family snapshots before any move", async () => {
		const request = await createDoneFamily("exec-family-guards");
		await expect(core.completeOrchestrationTaskFamily({ ...request, actorRole: "worker" })).rejects.toThrow(
			"Only an orchestrator",
		);
		await expect(core.completeOrchestrationTaskFamily({ ...request, actorSessionId: "wrong-session" })).rejects.toThrow(
			"does not match",
		);
		await expect(
			core.completeOrchestrationTaskFamily({ ...request, members: request.members.slice(1) }),
		).rejects.toThrow("membership mismatch");
		await expect(
			core.completeOrchestrationTaskFamily({
				...request,
				members: request.members.map((member) =>
					member.taskId === "TASK-20.1" ? { ...member, expectedRevision: 99 } : member,
				),
			}),
		).rejects.toThrow("revision mismatch");
		await expect(
			core.completeOrchestrationTaskFamily({
				...request,
				members: request.members.map((member) =>
					member.taskId === "TASK-20.1" ? { ...member, expectedStatus: "Review" } : member,
				),
			}),
		).rejects.toThrow("expected status must be Done");

		const child = await core.fs.loadTask("TASK-20.1");
		if (!child) throw new Error("Expected family child");
		await core.fs.saveTask({ ...child, status: "Review" });
		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow(
			"status mismatch: expected Done, found Review",
		);
		expect((await core.fs.listTasks()).map((task) => task.id).sort()).toEqual(["TASK-20", "TASK-20.1", "TASK-20.1.1"]);
		expect(await core.fs.listCompletedTasks()).toHaveLength(0);
	});

	it("rejects a member replaced after inventory and rolls back earlier family moves", async () => {
		const request = await createDoneFamily("exec-family-concurrent-replacement");
		const victim = await core.fs.loadTask("TASK-20.1.1");
		if (!victim?.filePath) throw new Error("Expected persisted replacement victim");
		let replaced = false;
		(
			core as unknown as { familyCompletionFaultInjector: (point: string, taskId?: string) => Promise<void> }
		).familyCompletionFaultInjector = async (point, taskId) => {
			if (replaced || point !== "move.target_linked" || taskId !== "TASK-20.1") return;
			replaced = true;
			const replacementPath = join(testDir, "concurrent-family-member-replacement.md");
			await Bun.write(replacementPath, serializeTask({ ...victim, status: "Review", revision: 99 }));
			await rename(replacementPath, victim.filePath as string);
		};

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("rolled back");
		expect(replaced).toBe(true);
		expect((await core.fs.listTasks()).map((task) => task.id).sort()).toEqual(["TASK-20", "TASK-20.1", "TASK-20.1.1"]);
		expect(await core.fs.listCompletedTasks()).toHaveLength(0);
		expect(await core.fs.loadTask("TASK-20.1.1")).toMatchObject({ status: "Review", revision: 99 });
		expect((await core.fs.loadTask("TASK-20"))?.orchestration?.familyCompletionReceipts).toBeUndefined();
	});

	it("preserves a member replaced after its target link and rolls back the family", async () => {
		const request = await createDoneFamily("exec-family-linked-source-replacement");
		const victim = await core.fs.loadTask("TASK-20.1");
		if (!victim?.filePath) throw new Error("Expected persisted linked-source victim");
		let replaced = false;
		(
			core as unknown as { familyCompletionFaultInjector: (point: string, taskId?: string) => Promise<void> }
		).familyCompletionFaultInjector = async (point, taskId) => {
			if (replaced || point !== "move.target_linked" || taskId !== victim.id) return;
			replaced = true;
			const replacementPath = join(testDir, "concurrent-linked-source-replacement.md");
			await Bun.write(replacementPath, serializeTask({ ...victim, status: "Review", revision: 99 }));
			await rename(replacementPath, victim.filePath as string);
		};

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("rolled back");
		expect(replaced).toBe(true);
		expect((await core.fs.listTasks()).map((task) => task.id).sort()).toEqual(["TASK-20", "TASK-20.1", "TASK-20.1.1"]);
		expect(await core.fs.listCompletedTasks()).toHaveLength(0);
		expect(await core.fs.loadTask("TASK-20.1")).toMatchObject({ status: "Review", revision: 99 });
		expect((await core.fs.loadTask("TASK-20"))?.orchestration?.familyCompletionReceipts).toBeUndefined();
	});

	it("does not overwrite a root replacement installed after receipt validation", async () => {
		const request = await createDoneFamily("exec-family-receipt-final-race");
		const root = await core.fs.loadTask("TASK-20");
		if (!root?.filePath) throw new Error("Expected persisted receipt-race root");
		let replaced = false;
		(
			core as unknown as { familyCompletionFaultInjector: (point: string, taskId?: string) => Promise<void> }
		).familyCompletionFaultInjector = async (point, taskId) => {
			if (replaced || point !== "receipt.before_stage" || taskId !== root.id) return;
			replaced = true;
			const replacementPath = join(testDir, "receipt-final-race-replacement.md");
			await Bun.write(replacementPath, serializeTask({ ...root, status: "Review", revision: 99 }));
			await rename(replacementPath, root.filePath as string);
		};

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow();
		expect(replaced).toBe(true);
		expect(await core.fs.loadTask(root.id)).toMatchObject({ status: "Review", revision: 99 });
	});

	it("does not unlink a root replacement installed at receipt rollback", async () => {
		const request = await createDoneFamily("exec-family-receipt-rollback-race");
		const root = await core.fs.loadTask("TASK-20");
		if (!root?.filePath) throw new Error("Expected persisted receipt-rollback root");
		let replaced = false;
		(
			core as unknown as { familyCompletionFaultInjector: (point: string, taskId?: string) => Promise<void> }
		).familyCompletionFaultInjector = async (point, taskId) => {
			if (point === "move.target_linked" && taskId === "TASK-20.1") {
				throw new Error("injected rollback trigger");
			}
			if (replaced || point !== "receipt.rollback_before_stage" || taskId !== root.id) return;
			replaced = true;
			const replacementPath = join(testDir, "receipt-rollback-replacement.md");
			await Bun.write(replacementPath, serializeTask({ ...root, status: "Review", revision: 99 }));
			await rename(replacementPath, root.filePath as string);
		};

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow();
		expect(replaced).toBe(true);
		expect(await core.fs.loadTask(root.id)).toMatchObject({ status: "Review", revision: 99 });
	});

	it("does not unlink a source replacement installed after final inode validation", async () => {
		const request = await createDoneFamily("exec-family-unlink-final-race");
		const victim = await core.fs.loadTask("TASK-20.1");
		if (!victim?.filePath) throw new Error("Expected persisted unlink-race victim");
		let replaced = false;
		(
			core as unknown as { familyCompletionFaultInjector: (point: string, taskId?: string) => Promise<void> }
		).familyCompletionFaultInjector = async (point, taskId) => {
			if (replaced || point !== "move.before_stage" || taskId !== victim.id) return;
			replaced = true;
			const replacementPath = join(testDir, "unlink-final-race-replacement.md");
			await Bun.write(replacementPath, serializeTask({ ...victim, status: "Review", revision: 99 }));
			await rename(replacementPath, victim.filePath as string);
		};

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow();
		expect(replaced).toBe(true);
		expect(await core.fs.loadTask(victim.id)).toMatchObject({ status: "Review", revision: 99 });
	});

	it("rejects a new descendant created after the initial family inventory", async () => {
		const request = await createDoneFamily("exec-family-post-inventory-descendant");
		let created = false;
		(
			core as unknown as { familyCompletionFaultInjector: (point: string, taskId?: string) => Promise<void> }
		).familyCompletionFaultInjector = async (point, taskId) => {
			if (created || point !== "move.source_unlinked" || taskId !== "TASK-20.1") return;
			created = true;
			await Bun.write(
				join(core.fs.tasksDir, "task-20.2 - Late-family-child.md"),
				serializeTask({
					id: "TASK-20.2",
					title: "Late family child",
					status: "Done",
					assignee: [],
					createdDate: "2026-07-21",
					labels: [],
					dependencies: [],
					parentTaskId: "TASK-20",
					revision: 1,
					orchestration: {
						executionId: "exec-family-post-inventory-descendant",
						role: "implementation",
						reviewVerdict: "Accept",
						integrated: true,
					},
				}),
			);
		};

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("rolled back");
		expect(created).toBe(true);
		expect((await core.fs.listTasks()).map((task) => task.id).sort()).toEqual([
			"TASK-20",
			"TASK-20.1",
			"TASK-20.1.1",
			"TASK-20.2",
		]);
		expect(await core.fs.listCompletedTasks()).toHaveLength(0);
	});

	it("rejects a completed member replaced after its source is removed", async () => {
		const request = await createDoneFamily("exec-family-post-move-target-replacement");
		const victim = await core.fs.loadTask("TASK-20.1");
		if (!victim?.filePath) throw new Error("Expected persisted post-move replacement victim");
		const completedPath = join(core.fs.completedDir, basename(victim.filePath));
		let replaced = false;
		(
			core as unknown as { familyCompletionFaultInjector: (point: string, taskId?: string) => Promise<void> }
		).familyCompletionFaultInjector = async (point, taskId) => {
			if (replaced || point !== "move.source_unlinked" || taskId !== victim.id) return;
			replaced = true;
			const replacementPath = join(testDir, "post-move-completed-replacement.md");
			await Bun.write(replacementPath, serializeTask({ ...victim, status: "Review", revision: 99 }));
			await rename(replacementPath, completedPath);
		};

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("rolled back");
		expect(replaced).toBe(true);
		expect((await core.fs.loadTask(victim.id))?.status).toBe("Review");
		expect(await core.fs.listCompletedTasks()).toHaveLength(0);
	});

	it("rejects a completed replacement installed at the final staging cleanup boundary", async () => {
		const request = await createDoneFamily("exec-family-final-cleanup-replacement");
		const victim = await core.fs.loadTask("TASK-20.1");
		if (!victim?.filePath) throw new Error("Expected persisted final-cleanup replacement victim");
		const completedPath = join(core.fs.completedDir, basename(victim.filePath));
		let replaced = false;
		(
			core as unknown as { familyCompletionFaultInjector: (point: string, taskId?: string) => Promise<void> }
		).familyCompletionFaultInjector = async (point, taskId) => {
			if (replaced || point !== "move.before_stage_unlink" || taskId !== victim.id) return;
			replaced = true;
			const replacementPath = join(testDir, "final-cleanup-completed-replacement.md");
			await Bun.write(replacementPath, serializeTask({ ...victim, status: "Review", revision: 99 }));
			await rename(replacementPath, completedPath);
		};

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow();
		expect(replaced).toBe(true);
		expect(await core.fs.loadTask(victim.id)).toMatchObject({ status: "Review", revision: 99 });
	});

	it("rolls back every family member and its receipt after a mid-family move failure", async () => {
		const request = await createDoneFamily("exec-family-rollback");
		await applyFamilyModes();
		const bytesBefore = new Map<string, Buffer>();
		for (const task of await core.fs.listTasks()) {
			if (!task.filePath) throw new Error(`Expected persisted ${task.id}`);
			bytesBefore.set(task.id, await readFile(task.filePath));
		}
		let moveCount = 0;
		(
			core as unknown as { familyCompletionFaultInjector: (point: string) => Promise<void> }
		).familyCompletionFaultInjector = async (point) => {
			if (point !== "move.target_linked") return;
			moveCount += 1;
			if (moveCount === 2) throw new Error("injected family move failure");
		};

		await expect(core.completeOrchestrationTaskFamily(request)).rejects.toThrow("rolled back");
		const restoredTasks = await core.fs.listTasks();
		expect(restoredTasks.map((task) => task.id).sort()).toEqual(["TASK-20", "TASK-20.1", "TASK-20.1.1"]);
		expect(await core.fs.listCompletedTasks()).toHaveLength(0);
		for (const task of restoredTasks) {
			if (!task.filePath) throw new Error(`Expected restored ${task.id}`);
			const expectedBytes = bytesBefore.get(task.id);
			if (!expectedBytes) throw new Error(`Expected original bytes for ${task.id}`);
			expect((await readFile(task.filePath)).equals(expectedBytes)).toBe(true);
		}
		await expectFamilyModes(restoredTasks);
		expect((await core.fs.loadTask("TASK-20"))?.orchestration?.familyCompletionReceipts).toBeUndefined();
	});

	it("preserves accepted Approved to Done closure", async () => {
		const { task } = await core.createTaskFromInput({
			title: "Reviewed task",
			status: "Approved",
			acceptanceCriteria: [{ text: "Behavior verified", checked: false }],
			definitionOfDoneAdd: ["Checks pass"],
			disableDefinitionOfDoneDefaults: true,
		});
		await expect(
			core.transitionOrchestrationTask({
				taskId: task.id,
				expectedStatus: "Approved",
				expectedRevision: 1,
				targetStatus: "Done",
				actorRole: "orchestrator",
				idempotencyKey: "review:reject",
				orchestration: { executionId: "exec-review", reviewVerdict: "Reject" },
			}),
		).rejects.toThrow("Accept review verdict");

		const completed = await core.transitionOrchestrationTask({
			taskId: task.id,
			expectedStatus: "Approved",
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
