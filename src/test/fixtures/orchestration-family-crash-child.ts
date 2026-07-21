import { link, open } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Core } from "../../core/backlog.ts";
import { serializeTask } from "../../markdown/serializer.ts";
import type { TaskLifecycleEvent, TaskLifecycleNotifier } from "../../utils/task-lifecycle-notifications.ts";

const [projectRoot, crashPoint, lifecycleLog] = process.argv.slice(2);
if (!projectRoot || !crashPoint || !lifecycleLog) {
	throw new Error("Usage: orchestration-family-crash-child <project-root> <crash-point> <lifecycle-log>");
}
const lifecycleLogPath = lifecycleLog;

function matches(point: string, taskId?: string): boolean {
	return crashPoint === point || (taskId !== undefined && crashPoint === `${point}:${taskId}`);
}

function crash(): never {
	process.kill(process.pid, "SIGKILL");
	throw new Error("SIGKILL did not terminate the process");
}

async function appendLifecycle(event: TaskLifecycleEvent): Promise<void> {
	const handle = await open(lifecycleLogPath, "a");
	try {
		await handle.writeFile(`${JSON.stringify({ taskId: event.task.id, idempotencyKey: event.idempotencyKey })}\n`);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

let lifecycleAttempts = 0;
const notifier: TaskLifecycleNotifier = {
	notify: async (event) => {
		lifecycleAttempts += 1;
		if (lifecycleAttempts === 1 && matches("lifecycle.before_publish", event.task.id)) crash();
		await appendLifecycle(event);
		if (lifecycleAttempts === 1 && matches("lifecycle.after_publish", event.task.id)) crash();
	},
	notifyRequired: async (event) => {
		lifecycleAttempts += 1;
		if (lifecycleAttempts === 1 && matches("lifecycle.before_publish", event.task.id)) crash();
		await appendLifecycle(event);
		if (lifecycleAttempts === 1 && matches("lifecycle.after_publish", event.task.id)) crash();
	},
};

const core = new Core(projectRoot, {
	taskNotifier: notifier,
	// The production hook is deliberately reached only from exact durability
	// boundaries. The cast keeps this fixture RED against the pre-fix constructor.
	familyCompletionFaultInjector: async (point: string, taskId?: string) => {
		if (matches(point, taskId)) crash();
	},
} as ConstructorParameters<typeof Core>[1]);

// Pre-fix fault injection. Once the durable implementation lands these generic
// methods are no longer the family receipt/move path; the exact hook above owns
// the same crash points.
const saveTask = core.fs.saveTask.bind(core.fs);
core.fs.saveTask = async (task) => {
	if (task.id === "TASK-20" && task.orchestration?.familyCompletionReceipts?.length) {
		const taskPath = task.filePath;
		if (!taskPath) throw new Error("family root has no persisted path");
		const temporaryPath = join(dirname(taskPath), `.${basename(taskPath)}.family-crash.tmp`);
		if (matches("receipt.temp_created", task.id)) {
			const handle = await open(temporaryPath, "w");
			await handle.close();
			crash();
		}
		if (matches("receipt.file_synced", task.id)) {
			const handle = await open(temporaryPath, "w");
			try {
				await handle.writeFile(serializeTask(task));
				await handle.sync();
			} finally {
				await handle.close();
			}
			crash();
		}
		if (matches("receipt.replaced", task.id)) {
			await Bun.write(taskPath, "---\nid: TASK-20\nstatus: Done\norchestration: [");
			crash();
		}
		const result = await saveTask(task);
		if (matches("receipt.directory_synced", task.id)) crash();
		return result;
	}
	return await saveTask(task);
};

const completeTask = core.fs.completeTask.bind(core.fs);
core.fs.completeTask = async (taskId) => {
	const active = await core.fs.loadTask(taskId);
	const sourcePath = active?.filePath;
	const completed = await completeTask(taskId);
	if (completed && taskId === "TASK-20.1") {
		if (matches("move.target_linked", taskId) || matches("move.target_directory_synced", taskId)) {
			const moved = (await core.fs.listCompletedTasks()).find((task) => task.id === taskId);
			if (!sourcePath || !moved?.filePath) throw new Error("moved child path missing");
			await link(moved.filePath, sourcePath);
			crash();
		}
		if (matches("move.source_unlinked", taskId) || matches("move.source_directory_synced", taskId)) crash();
	}
	return completed;
};

const commitFiles = core.git.commitFiles.bind(core.git);
core.git.commitFiles = async (...args) => {
	if (matches("git.before_commit")) crash();
	await commitFiles(...args);
	if (matches("git.after_commit")) crash();
};

await core.completeOrchestrationTaskFamily({
	familyRootTaskId: "TASK-20",
	members: [
		{ taskId: "TASK-20.1", expectedStatus: "Done", expectedRevision: 3 },
		{ taskId: "TASK-20.1.1", expectedStatus: "Done", expectedRevision: 2 },
		{ taskId: "TASK-20", expectedStatus: "Done", expectedRevision: 4 },
	],
	actorRole: "orchestrator",
	actorSessionId: "session-parent",
	idempotencyKey: "family-complete:exec-family-crash",
});
