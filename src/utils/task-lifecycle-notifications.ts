import type { OrchestrationActorRole, Task } from "../types/index.ts";

export const TASK_LIFECYCLE_SUBJECT = "backlog.task.lifecycle";
const DEFAULT_BELLEROPHON_URL = "evari://localhost:9000";

type ConnectionOptions = {
	servers?: string[] | string;
	name?: string;
	timeout?: number;
	reconnect?: boolean;
	maxReconnectAttempts?: number;
};

type BellerophonConnection = {
	publish(subject: string, payload?: Uint8Array | string): void;
	flush?: () => Promise<void>;
	close?: () => Promise<void>;
};

type BellerophonConnect = (options?: ConnectionOptions) => Promise<BellerophonConnection>;

export type TaskLifecycleEventAction = "created" | "updated" | "status_changed" | "archived" | "completed";

export interface TaskLifecycleEvent {
	action: TaskLifecycleEventAction;
	task: Task;
	projectRoot: string;
	projectName?: string;
	previousStatus?: string;
	timestamp?: string;
	actorRole?: OrchestrationActorRole;
	correlationId?: string;
	idempotencyKey?: string;
}

export interface TaskLifecycleNotificationPayload extends TaskLifecycleEvent {
	version: 2;
	timestamp: string;
	newState: string;
	taskRevision: number;
	executionId?: string;
	planRevision?: string;
}

/** Legacy envelope retained as a documented decoder shape for v1 consumers. */
export interface TaskLifecycleNotificationPayloadV1
	extends Omit<TaskLifecycleNotificationPayload, "version" | "taskRevision" | "executionId" | "planRevision"> {
	version: 1;
}

export interface TaskLifecycleNotifier {
	notify(event: TaskLifecycleEvent): Promise<void>;
	notifyRequired(event: TaskLifecycleEvent): Promise<void>;
}

interface TaskLifecycleNotifierOptions {
	connect?: BellerophonConnect;
	now?: () => string;
	projectName?: string;
	projectRoot?: string;
	subject?: string;
	url?: string;
}

const testTaskLifecycleNotifier: TaskLifecycleNotifier = {
	async notify() {
		return undefined;
	},
	async notifyRequired() {
		return undefined;
	},
};

const disabledTaskLifecycleNotifier: TaskLifecycleNotifier = {
	async notify() {
		return undefined;
	},
	async notifyRequired() {
		throw new Error("Required lifecycle delivery is unavailable because lifecycle notifications are disabled.");
	},
};

let defaultNotifier: TaskLifecycleNotifier | undefined;

function isTestProcess(): boolean {
	return process.env.NODE_ENV === "test" || process.argv.includes("test");
}

async function defaultConnect(options?: ConnectionOptions): Promise<BellerophonConnection> {
	const sdkPath = "../../vendor/bellerophon-ts/index.ts";
	const sdk = await import(sdkPath);
	return await sdk.connect(options);
}

function encodePayload(payload: TaskLifecycleNotificationPayload): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(payload));
}

export function normalizeBellerophonSubjectToken(value: string | undefined): string {
	return (value ?? "")
		.trim()
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export function scopedBellerophonSubject(baseSubject: string, projectName?: string): string {
	const prefix = normalizeBellerophonSubjectToken(projectName || process.env.BACKLOG_BELLEROPHON_SUBJECT_PREFIX);
	return prefix ? `${prefix}.${baseSubject}` : baseSubject;
}

export function createTaskLifecycleNotifier(options: TaskLifecycleNotifierOptions = {}): TaskLifecycleNotifier {
	const connect = options.connect ?? defaultConnect;
	const url = options.url ?? DEFAULT_BELLEROPHON_URL;
	const now = options.now ?? (() => new Date().toISOString());
	let disabled = false;

	const openConnection = async (required: boolean): Promise<BellerophonConnection | null> => {
		try {
			return await connect({
				servers: url,
				name: "backlog.md-task-lifecycle",
				timeout: 500,
				reconnect: false,
				maxReconnectAttempts: 0,
			});
		} catch (error) {
			if (required) throw error;
			disabled = true;
			if (process.env.DEBUG) {
				console.warn(`Bellerophon task lifecycle notifications disabled: ${String(error)}`);
			}
			return null;
		}
	};

	const publish = async (event: TaskLifecycleEvent, required: boolean): Promise<void> => {
		if (disabled && !required) return;

		const connection = await openConnection(required);
		if (!connection) return;

		const payload: TaskLifecycleNotificationPayload = {
			version: 2,
			timestamp: event.timestamp ?? now(),
			projectRoot: event.projectRoot || options.projectRoot || process.cwd(),
			action: event.action,
			newState: event.task.status,
			task: event.task,
			taskRevision: event.task.revision ?? 1,
			...(event.task.orchestration?.executionId !== undefined && {
				executionId: event.task.orchestration.executionId,
			}),
			...(event.task.orchestration?.planRevision !== undefined && {
				planRevision: event.task.orchestration.planRevision,
			}),
			...(event.projectName !== undefined && { projectName: event.projectName }),
			...(event.previousStatus !== undefined && { previousStatus: event.previousStatus }),
			...(event.actorRole !== undefined && { actorRole: event.actorRole }),
			...(event.correlationId !== undefined && { correlationId: event.correlationId }),
			...(event.idempotencyKey !== undefined && { idempotencyKey: event.idempotencyKey }),
		};

		try {
			const subject =
				options.subject ?? scopedBellerophonSubject(TASK_LIFECYCLE_SUBJECT, event.projectName ?? options.projectName);
			connection.publish(subject, encodePayload(payload));
			await connection.flush?.();
		} catch (error) {
			if (required) throw error;
			disabled = true;
			if (process.env.DEBUG) {
				console.warn(`Bellerophon task lifecycle publish failed; notifications disabled: ${String(error)}`);
			}
		} finally {
			await connection.close?.().catch(() => undefined);
		}
	};

	return {
		notify: async (event) => publish(event, false),
		notifyRequired: async (event) => publish(event, true),
	};
}

export function getTaskLifecycleNotifier(): TaskLifecycleNotifier {
	if (process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS === "0") {
		return disabledTaskLifecycleNotifier;
	}
	if (isTestProcess()) {
		return testTaskLifecycleNotifier;
	}

	defaultNotifier ??= createTaskLifecycleNotifier();
	return defaultNotifier;
}
