import type { Task } from "../types/index.ts";

/** Open Ripple issue statuses shown as board columns (done/cancelled deliberately excluded). */
export const RIPPLE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"];

const HIDDEN_STATUSES = new Set(["done", "cancelled"]);

export interface RippleIssue {
	id: string;
	identifier: string;
	title: string;
	description?: string | null;
	status: string;
	priority?: string;
	assignee_id?: string | null;
	parent_issue_id?: string | null;
	position?: number;
	created_at: string;
	updated_at?: string;
	labels?: Array<{ name: string }> | null;
}

function isoDate(value: string | undefined): string | undefined {
	return value ? value.slice(0, 10) : undefined;
}

export function mapRippleIssues(issues: RippleIssue[], names: Map<string, string>): Task[] {
	const identifierByUuid = new Map(issues.map((issue) => [issue.id, issue.identifier]));
	return issues
		.filter((issue) => !HIDDEN_STATUSES.has(issue.status))
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
		.map((issue) => {
			const parentIdentifier = issue.parent_issue_id ? identifierByUuid.get(issue.parent_issue_id) : undefined;
			return {
				id: issue.identifier,
				title: issue.title,
				status: issue.status,
				priority: issue.priority,
				description: issue.description ?? "",
				labels: issue.labels?.map((label) => label.name) ?? [],
				assignee: issue.assignee_id ? [names.get(issue.assignee_id) ?? issue.assignee_id.slice(0, 8)] : [],
				dependencies: [],
				createdDate: isoDate(issue.created_at) ?? "",
				updatedDate: isoDate(issue.updated_at),
				ordinal: issue.position,
				source: "ripple",
				...(parentIdentifier ? { parentTaskId: parentIdentifier } : {}),
			};
		});
}

async function runRipple<T>(prefix: string, args: string): Promise<T> {
	const proc = Bun.spawn(["sh", "-c", `${prefix} ${args}`], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(`ripple ${args} failed (exit ${exitCode}): ${stderr.trim()}`);
	}
	return JSON.parse(stdout) as T;
}

async function loadNames(prefix: string, args: string): Promise<Array<{ id: string; name: string }>> {
	try {
		return await runRipple<Array<{ id: string; name: string }>>(prefix, args);
	} catch (error) {
		if (process.env.DEBUG) console.warn(`ripple ${args} unavailable:`, error);
		return [];
	}
}

/** Load open Ripple issues via the configured `ripple_command` prefix, resolving agent/squad assignee names. */
export async function loadRippleIssues(rippleCommand: string): Promise<Task[]> {
	const [issueList, agents, squads] = await Promise.all([
		runRipple<{ issues: RippleIssue[] }>(rippleCommand, "issue list --output json --limit 500"),
		loadNames(rippleCommand, "agent list --output json"),
		loadNames(rippleCommand, "squad list --output json"),
	]);
	const names = new Map([...agents, ...squads].map((entity) => [entity.id, entity.name]));
	return mapRippleIssues(issueList.issues ?? [], names);
}
