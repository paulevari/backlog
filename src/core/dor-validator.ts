import type { Task } from "../types/index.ts";
import { resolveDependencies } from "../utils/task-dependencies.ts";

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

	const { unresolvable } = resolveDependencies(task.dependencies ?? [], allTasks);
	const depsResolvable = unresolvable.length === 0;
	checks.push({
		name: "dependencies",
		pass: depsResolvable,
		detail: depsResolvable ? undefined : `Unresolvable dependencies: ${unresolvable.join(", ")}`,
	});

	const pass = checks.every((check) => check.pass);

	return { pass, checks };
}
