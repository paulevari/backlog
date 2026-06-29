import type { Task } from "../types/index.ts";

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
	previousStatus?: string;
	timestamp?: string;
}

export interface TaskLifecycleNotificationPayload extends TaskLifecycleEvent {
	version: 1;
	timestamp: string;
	newState: string;
}

export interface TaskLifecycleNotifier {
	notify(event: TaskLifecycleEvent): Promise<void>;
}

interface TaskLifecycleNotifierOptions {
	connect?: BellerophonConnect;
	now?: () => string;
	projectRoot?: string;
	subject?: string;
	url?: string;
}

const noopTaskLifecycleNotifier: TaskLifecycleNotifier = {
	async notify() {
		return undefined;
	},
};

let defaultNotifier: TaskLifecycleNotifier | undefined;

function isTestProcess(): boolean {
	return process.argv.includes("test") || process.env.BACKLOG_BELLEROPHON_NOTIFICATIONS === "0";
}

async function defaultConnect(options?: ConnectionOptions): Promise<BellerophonConnection> {
	const sdkPath = "../../vendor/bellerophon-ts/index.ts";
	const sdk = await import(sdkPath);
	return await sdk.connect(options);
}

function encodePayload(payload: TaskLifecycleNotificationPayload): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(payload));
}

export function createTaskLifecycleNotifier(options: TaskLifecycleNotifierOptions = {}): TaskLifecycleNotifier {
	const connect = options.connect ?? defaultConnect;
	const subject = options.subject ?? TASK_LIFECYCLE_SUBJECT;
	const url = options.url ?? DEFAULT_BELLEROPHON_URL;
	const now = options.now ?? (() => new Date().toISOString());
	let disabled = false;

	const openConnection = async (): Promise<BellerophonConnection | null> => {
		try {
			return await connect({
				servers: url,
				name: "backlog.md-task-lifecycle",
				timeout: 500,
				reconnect: false,
				maxReconnectAttempts: 0,
			});
		} catch (error) {
			disabled = true;
			if (process.env.DEBUG) {
				console.warn(`Bellerophon task lifecycle notifications disabled: ${String(error)}`);
			}
			return null;
		}
	};

	return {
		async notify(event: TaskLifecycleEvent): Promise<void> {
			if (disabled) {
				return;
			}

			const connection = await openConnection();
			if (!connection) {
				return;
			}

			const payload: TaskLifecycleNotificationPayload = {
				version: 1,
				timestamp: event.timestamp ?? now(),
				projectRoot: event.projectRoot || options.projectRoot || process.cwd(),
				action: event.action,
				newState: event.task.status,
				task: event.task,
				...(event.previousStatus !== undefined && { previousStatus: event.previousStatus }),
			};

			try {
				connection.publish(subject, encodePayload(payload));
				await connection.flush?.();
			} catch (error) {
				disabled = true;
				if (process.env.DEBUG) {
					console.warn(`Bellerophon task lifecycle publish failed; notifications disabled: ${String(error)}`);
				}
			} finally {
				await connection.close?.().catch(() => undefined);
			}
		},
	};
}

export function getTaskLifecycleNotifier(): TaskLifecycleNotifier {
	if (isTestProcess()) {
		return noopTaskLifecycleNotifier;
	}

	defaultNotifier ??= createTaskLifecycleNotifier();
	return defaultNotifier;
}
