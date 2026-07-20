import type { Task } from "../types/index.ts";
import { canonicalTaskId } from "../utils/task-id.ts";

export interface DorCheckResult {
	name: string;
	pass: boolean;
	detail?: string;
}

export interface DorValidationResult {
	pass: boolean;
	checks: DorCheckResult[];
}

export function validateDefinitionOfReady(task: Task, allTasks: Task[]): DorValidationResult {
	const checks: DorCheckResult[] = [];

	const hasDescription = Boolean(task.description?.trim());
	checks.push({
		name: "description",
		pass: hasDescription,
		detail: hasDescription ? undefined : "Description is empty",
	});

	const hasAcceptanceCriteria = (task.acceptanceCriteriaItems?.length ?? 0) > 0;
	checks.push({
		name: "acceptance-criteria",
		pass: hasAcceptanceCriteria,
		detail: hasAcceptanceCriteria ? undefined : "No acceptance criteria defined",
	});

	const hasDefinitionOfDone = (task.definitionOfDoneItems?.length ?? 0) > 0;
	checks.push({
		name: "definition-of-done",
		pass: hasDefinitionOfDone,
		detail: hasDefinitionOfDone ? undefined : "No definition of done items",
	});

	const hasComplexityLabel = (task.labels ?? []).some((label) => label.toLowerCase().startsWith("complexity:"));
	checks.push({
		name: "complexity-label",
		pass: hasComplexityLabel,
		detail: hasComplexityLabel ? undefined : "No complexity:* label found",
	});

	const hasMilestone = Boolean(task.milestone);
	checks.push({
		name: "milestone",
		pass: hasMilestone,
		detail: hasMilestone ? undefined : "No milestone assigned",
	});

	const taskIdMap = new Map<string, Task>();
	for (const t of allTasks) {
		taskIdMap.set(canonicalTaskId(t.id), t);
	}

	const unresolvedDeps: string[] = [];
	if (task.dependencies && task.dependencies.length > 0) {
		for (const depId of task.dependencies) {
			const canonical = canonicalTaskId(depId);
			if (!taskIdMap.has(canonical)) {
				unresolvedDeps.push(depId);
			}
		}
	}

	const depsResolvable = unresolvedDeps.length === 0;
	checks.push({
		name: "dependencies",
		pass: depsResolvable,
		detail: depsResolvable ? undefined : `Unresolvable dependencies: ${unresolvedDeps.join(", ")}`,
	});

	const pass = checks.every((check) => check.pass);

	return { pass, checks };
}
