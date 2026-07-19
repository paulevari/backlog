import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import type { Task } from "../types/index.ts";
import BoardPage from "../web/components/BoardPage.tsx";
import { apiClient } from "../web/lib/api.ts";

const createTask = (overrides: Partial<Task>): Task => ({
	id: "task-1",
	title: "Task",
	status: "To Do",
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-01-01",
	...overrides,
});

const tasks: Task[] = [
	createTask({ id: "task-101", title: "Fix login bug", status: "To Do" }),
	createTask({ id: "task-102", title: "Improve board", status: "In Progress" }),
];

const draft: Task = createTask({ id: "draft-1", title: "Intake capture entry", status: "Draft" });

let activeRoot: Root | null = null;
const originalFetchDrafts = apiClient.fetchDrafts;

const setupDom = (url = "http://localhost/board") => {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.window = dom.window as unknown as Window & typeof globalThis;
	globalThis.document = dom.window.document as unknown as Document;
	globalThis.navigator = dom.window.navigator as unknown as Navigator;
	globalThis.localStorage = dom.window.localStorage as unknown as Storage;

	if (!window.matchMedia) {
		window.matchMedia = () =>
			({
				matches: false,
				media: "",
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false,
			}) as MediaQueryList;
	}
};

const boardPageElement = (renderedTasks: Task[]) => (
	<BrowserRouter>
		<BoardPage
			tasks={renderedTasks}
			statuses={["To Do", "In Progress", "Done"]}
			milestones={[]}
			availableLabels={[]}
			milestoneEntities={[]}
			archivedMilestones={[]}
			isLoading={false}
			onEditTask={() => {}}
			onNewTask={() => {}}
		/>
	</BrowserRouter>
);

const renderBoardPage = (): HTMLElement => {
	setupDom();
	const container = document.getElementById("root");
	expect(container).toBeTruthy();
	activeRoot = createRoot(container as HTMLElement);
	act(() => {
		activeRoot?.render(boardPageElement(tasks));
	});
	return container as HTMLElement;
};

const waitFor = async (predicate: () => boolean) => {
	for (let attempts = 0; attempts < 20; attempts += 1) {
		if (predicate()) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
	expect(predicate()).toBe(true);
};

afterEach(() => {
	apiClient.fetchDrafts = originalFetchDrafts;
	act(() => {
		activeRoot?.unmount();
	});
	activeRoot = null;
});

describe("web board drafts column", () => {
	it("renders a leading read-only Draft column when drafts exist", async () => {
		apiClient.fetchDrafts = async () => [draft];

		const container = renderBoardPage();
		await waitFor(() => (container.textContent ?? "").includes("Intake capture entry"));

		const text = container.textContent ?? "";
		expect(text.indexOf("Draft")).toBeGreaterThanOrEqual(0);
		expect(text.indexOf("Draft")).toBeLessThan(text.indexOf("To Do"));

		const draftCard = Array.from(container.querySelectorAll("[draggable]")).find((element) =>
			element.textContent?.includes("Intake capture entry"),
		);
		expect(draftCard).toBeTruthy();
		expect(draftCard?.getAttribute("draggable")).toBe("false");
	});

	it("refreshes drafts when the board tasks change", async () => {
		apiClient.fetchDrafts = async () => [draft];

		const container = renderBoardPage();
		await waitFor(() => (container.textContent ?? "").includes("Intake capture entry"));

		apiClient.fetchDrafts = async () => [];
		act(() => {
			activeRoot?.render(boardPageElement([...tasks]));
		});

		await waitFor(() => !(container.textContent ?? "").includes("Intake capture entry"));
	});

	it("omits the Draft column when there are no drafts", async () => {
		apiClient.fetchDrafts = async () => [];

		const container = renderBoardPage();
		await waitFor(() => (container.textContent ?? "").includes("Fix login bug"));

		expect(container.textContent ?? "").not.toContain("Intake capture entry");
		expect(container.textContent ?? "").not.toContain("Draft");
	});
});
