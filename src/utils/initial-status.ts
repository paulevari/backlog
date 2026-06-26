export function getInitialStatus(statuses: readonly string[]): string | null {
	if (statuses.length === 0) return null;
	const initialStatus = statuses[0];
	return initialStatus && initialStatus.trim().length > 0 ? initialStatus : null;
}

function normalizeStatusForComparison(status: string | null | undefined): string {
	return (status ?? "").trim().toLowerCase();
}

export function isInitialStatus(status: string | null | undefined, statuses: readonly string[]): boolean {
	const initialStatus = getInitialStatus(statuses);
	return initialStatus !== null && normalizeStatusForComparison(status) === normalizeStatusForComparison(initialStatus);
}

export function validateInitialStatusReadiness(
	task: {
		acceptanceCriteriaItems?: Array<{ text: string }>;
		definitionOfDoneItems?: Array<{ text: string }>;
	},
	statuses: readonly string[],
	newStatus: string,
	oldStatus?: string,
): void {
	if (!isInitialStatus(oldStatus, statuses) && normalizeStatusForComparison(oldStatus) !== "draft") return;
	if (isInitialStatus(newStatus, statuses)) return;
	if (normalizeStatusForComparison(newStatus) === "draft") return;

	const acCount = (task.acceptanceCriteriaItems ?? []).length;
	const dodCount = (task.definitionOfDoneItems ?? []).length;

	if (acCount > 0 && dodCount > 0) return;

	const initialStatus = getInitialStatus(statuses);
	const parts: string[] = [];
	if (acCount === 0) parts.push("Acceptance Criteria");
	if (dodCount === 0) parts.push("Definition of Done");

	throw new Error(
		`Cannot move task from "${initialStatus}": ${parts.join(" and ")} must be defined before work can begin. Please add at least one item for each before changing the status.`,
	);
}
