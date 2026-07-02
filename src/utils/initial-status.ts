export function getInitialStatus(statuses: readonly string[]): string | null {
	if (statuses.length === 0) return null;
	const initialStatus = statuses[0];
	return initialStatus && initialStatus.trim().length > 0 ? initialStatus : null;
}

function normalizeStatusForComparison(status: string | null | undefined): string {
	return (status ?? "").trim().toLowerCase();
}

function statusMatches(status: string | null | undefined, candidates: readonly string[]): boolean {
	const normalizedStatus = normalizeStatusForComparison(status);
	return candidates.some((candidate) => {
		const normalizedCandidate = normalizeStatusForComparison(candidate);
		return normalizedCandidate.length > 0 && normalizedStatus === normalizedCandidate;
	});
}

function isDraftStatus(status: string | null | undefined): boolean {
	return normalizeStatusForComparison(status) === "draft";
}

export function isInitialStatus(status: string | null | undefined, statuses: readonly string[]): boolean {
	const initialStatus = getInitialStatus(statuses);
	return initialStatus !== null && normalizeStatusForComparison(status) === normalizeStatusForComparison(initialStatus);
}

export function isPlanningStatus(status: string | null | undefined, planningStatuses: readonly string[]): boolean {
	return statusMatches(status, planningStatuses);
}

function isPreWorkStatus(
	status: string | null | undefined,
	statuses: readonly string[],
	planningStatuses: readonly string[],
): boolean {
	return isInitialStatus(status, statuses) || isDraftStatus(status) || isPlanningStatus(status, planningStatuses);
}

function getPreWorkStatusDisplayName(
	status: string | null | undefined,
	statuses: readonly string[],
	planningStatuses: readonly string[],
): string {
	const initialStatus = getInitialStatus(statuses);
	if (isInitialStatus(status, statuses) && initialStatus) return initialStatus;
	if (isDraftStatus(status)) return "Draft";

	const matchingPlanningStatus = planningStatuses.find((candidate) => {
		const normalizedCandidate = normalizeStatusForComparison(candidate);
		return normalizedCandidate.length > 0 && normalizedCandidate === normalizeStatusForComparison(status);
	});
	if (matchingPlanningStatus) return matchingPlanningStatus;

	return initialStatus ?? status?.trim() ?? "pre-work status";
}

export function validateInitialStatusReadiness(
	task: {
		acceptanceCriteriaItems?: Array<{ text: string }>;
		definitionOfDoneItems?: Array<{ text: string }>;
	},
	statuses: readonly string[],
	newStatus: string,
	oldStatus?: string,
	planningStatuses: readonly string[] = [],
): void {
	if (!isPreWorkStatus(oldStatus, statuses, planningStatuses)) return;
	if (isPreWorkStatus(newStatus, statuses, planningStatuses)) return;

	const acCount = (task.acceptanceCriteriaItems ?? []).length;
	const dodCount = (task.definitionOfDoneItems ?? []).length;

	if (acCount > 0 && dodCount > 0) return;

	const preWorkStatus = getPreWorkStatusDisplayName(oldStatus, statuses, planningStatuses);
	const parts: string[] = [];
	if (acCount === 0) parts.push("Acceptance Criteria");
	if (dodCount === 0) parts.push("Definition of Done");

	throw new Error(
		`Cannot move task from "${preWorkStatus}": ${parts.join(" and ")} must be defined before work can begin. Please add at least one item for each before changing the status.`,
	);
}
