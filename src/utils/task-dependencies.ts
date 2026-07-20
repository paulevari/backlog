import type { Task } from "../types/index.ts";
import { canonicalTaskId } from "./task-id.ts";

export interface DependencyResolution {
	resolvable: string[];
	unresolvable: string[];
}

/**
 * Resolve task dependencies against a list of tasks.
 * Returns which dependencies can be resolved (exist in the task list)
 * and which cannot be resolved (missing or deleted).
 */
export function resolveDependencies(dependencies: string[], allTasks: Task[]): DependencyResolution {
	const canonicalIdSet = new Set<string>();
	for (const task of allTasks) {
		canonicalIdSet.add(canonicalTaskId(task.id));
	}

	const resolvable: string[] = [];
	const unresolvable: string[] = [];

	for (const depId of dependencies) {
		const canonical = canonicalTaskId(depId);
		if (canonicalIdSet.has(canonical)) {
			resolvable.push(depId);
		} else {
			unresolvable.push(depId);
		}
	}

	return { resolvable, unresolvable };
}
