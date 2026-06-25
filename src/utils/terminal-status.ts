export function getTerminalStatus(statuses: readonly string[]): string | null {
	if (statuses.length === 0) return null;
	const terminalStatus = statuses[statuses.length - 1];
	return terminalStatus && terminalStatus.trim().length > 0 ? terminalStatus : null;
}

function normalizeStatusForComparison(status: string | null | undefined): string {
	return (status ?? "").trim().toLowerCase();
}

export function isTerminalStatus(status: string | null | undefined, statuses: readonly string[]): boolean {
	const terminalStatus = getTerminalStatus(statuses);
	return (
		terminalStatus !== null && normalizeStatusForComparison(status) === normalizeStatusForComparison(terminalStatus)
	);
}

export function validateTerminalStatusCompleteness(
	task: {
		acceptanceCriteriaItems?: Array<{ checked: boolean }>;
		definitionOfDoneItems?: Array<{ checked: boolean }>;
	},
	statuses: readonly string[],
	newStatus: string,
	oldStatus?: string,
): void {
	if (!isTerminalStatus(newStatus, statuses)) return;
	if (isTerminalStatus(oldStatus, statuses)) return;

	const uncheckedAC = (task.acceptanceCriteriaItems ?? []).filter((item) => !item.checked).length;
	const uncheckedDoD = (task.definitionOfDoneItems ?? []).filter((item) => !item.checked).length;

	if (uncheckedAC === 0 && uncheckedDoD === 0) return;

	const terminalStatus = getTerminalStatus(statuses);
	const parts: string[] = [];
	if (uncheckedAC > 0) parts.push(`${uncheckedAC} Acceptance Criteria`);
	if (uncheckedDoD > 0) parts.push(`${uncheckedDoD} Definition of Done`);

	throw new Error(
		`Cannot move task to "${terminalStatus}": ${parts.join(" and ")} item(s) are not complete. Please ensure all Acceptance Criteria and Definition of Done items are actually complete and if so, update the ticket by marking them as done.`,
	);
}
