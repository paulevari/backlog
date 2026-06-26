import { join } from "node:path";
import type { ListInterface } from "neo-neo-bblessed";
import { box, list, scrollabletext } from "neo-neo-bblessed";
import type { Core } from "../core/backlog.ts";
import type { AnnieTreeNode } from "../utils/annie-fs.ts";
import { readAnnieFile, readAnnieTree } from "../utils/annie-fs.ts";
import { addScrollKeys, createScreen } from "./tui.ts";

interface FlatEntry {
	node: AnnieTreeNode;
	depth: number;
	expanded: boolean;
}

function flattenTree(nodes: AnnieTreeNode[], depth: number, expandedSet: Set<string>): FlatEntry[] {
	const result: FlatEntry[] = [];
	for (const node of nodes) {
		const expanded = node.type === "directory" && expandedSet.has(node.path);
		result.push({ node, depth, expanded });
		if (expanded && node.children) {
			result.push(...flattenTree(node.children, depth + 1, expandedSet));
		}
	}
	return result;
}

function formatEntry(entry: FlatEntry): string {
	const indent = "  ".repeat(entry.depth);
	if (entry.node.type === "directory") {
		const arrow = entry.expanded ? "▾" : "▸";
		return `${indent}${arrow} {bold}${entry.node.name}{/bold}`;
	}
	return `${indent}  ${entry.node.name}`;
}

export async function viewAnnieBrowser(options: { core: Core; onTabPress?: () => Promise<void> }): Promise<void> {
	const cwd = process.cwd();
	const { exists, tree } = await readAnnieTree(cwd);

	const screen = createScreen({ title: ".annie Browser" });

	const container = box({
		parent: screen,
		width: "100%",
		height: "100%",
	});

	const treePane = box({
		parent: container,
		top: 0,
		left: 0,
		width: "40%",
		height: "100%-1",
		border: { type: "line" },
		style: { border: { fg: "yellow" } },
		label: " .annie ",
	});

	const detailPane = box({
		parent: container,
		top: 0,
		left: "40%",
		right: 0,
		height: "100%-1",
		border: { type: "line" },
		style: { border: { fg: "gray" } },
		label: " Preview ",
	});

	box({
		parent: container,
		bottom: 0,
		left: 0,
		width: "100%",
		height: 1,
		tags: true,
		content:
			" {cyan-fg}[Tab]{/} View | {cyan-fg}[↑↓]{/} Nav | {cyan-fg}[Enter]{/} Expand/Select | {cyan-fg}[e]{/} Edit | {cyan-fg}[q]{/} Quit",
	});

	if (!exists || !tree?.children?.length) {
		box({
			parent: treePane,
			top: "center",
			left: "center",
			width: "shrink",
			height: "shrink",
			content: "No .annie/ directory found in this project",
			tags: true,
			style: { fg: "gray" },
		});

		screen.key(["q", "escape", "C-c"], () => {
			screen.destroy();
		});
		if (options.onTabPress) {
			screen.key(["tab"], () => {
				screen.destroy();
				void options.onTabPress?.();
			});
		}
		screen.render();
		return new Promise<void>((resolve) => {
			screen.on("destroy", () => resolve());
		});
	}

	let treeChildren = tree.children;
	const expandedSet = new Set<string>();
	let flatEntries = flattenTree(treeChildren, 0, expandedSet);
	let currentFocus: "tree" | "detail" = "tree";

	const treeList: ListInterface = list({
		parent: treePane,
		top: 0,
		left: 1,
		width: "100%-4",
		height: "100%-2",
		keys: true,
		vi: true,
		mouse: true,
		tags: true,
		scrollable: true,
		style: {
			selected: { inverse: true },
		},
	});

	let detailContent: ReturnType<typeof scrollabletext> | null = null;

	function rebuildList() {
		flatEntries = flattenTree(treeChildren, 0, expandedSet);
		const items = flatEntries.map(formatEntry);
		treeList.setItems(items);
		screen.render();
	}

	function setActivePane(pane: "tree" | "detail") {
		const treeBorder = treePane.style as { border?: { fg?: string } };
		const detailBorder = detailPane.style as { border?: { fg?: string } };
		if (treeBorder.border) treeBorder.border.fg = pane === "tree" ? "yellow" : "gray";
		if (detailBorder.border) detailBorder.border.fg = pane === "detail" ? "yellow" : "gray";
	}

	function focusTree() {
		currentFocus = "tree";
		setActivePane("tree");
		treeList.focus();
		screen.render();
	}

	function focusDetail() {
		if (!detailContent) return;
		currentFocus = "detail";
		setActivePane("detail");
		detailContent.focus();
		screen.render();
	}

	async function showFileContent(entry: FlatEntry) {
		if (detailContent) {
			detailContent.destroy();
			detailContent = null;
		}

		if (entry.node.type === "directory") {
			const count = entry.node.children?.length ?? 0;
			detailContent = scrollabletext({
				parent: detailPane,
				top: 0,
				left: 1,
				right: 1,
				bottom: 0,
				tags: true,
				wrap: true,
				content: `{bold}${entry.node.name}/{/bold}\n\n{gray-fg}Directory with ${count} item${count !== 1 ? "s" : ""}{/}`,
			});
			detailPane.setLabel?.(` ${entry.node.name}/ `);
			screen.render();
			return;
		}

		try {
			const file = await readAnnieFile(cwd, entry.node.path);
			detailContent = scrollabletext({
				parent: detailPane,
				top: 0,
				left: 1,
				right: 1,
				bottom: 0,
				keys: true,
				vi: true,
				mouse: true,
				tags: false,
				wrap: true,
				scrollbar: { ch: " ", inverse: true },
				style: { scrollbar: { bg: "gray" } },
				content: file.content,
			});
			detailPane.setLabel?.(` ${file.name} `);

			addScrollKeys(detailContent, screen);

			detailContent.key(["left", "h"], () => {
				focusTree();
				return false;
			});
			detailContent.key(["escape"], () => {
				focusTree();
				return false;
			});
			detailContent.on("focus", () => {
				currentFocus = "detail";
				setActivePane("detail");
				screen.render();
			});
		} catch {
			detailContent = scrollabletext({
				parent: detailPane,
				top: 0,
				left: 1,
				right: 1,
				bottom: 0,
				tags: true,
				wrap: true,
				content: "{red-fg}Failed to read file{/}",
			});
		}
		screen.render();
	}

	function getSelectedEntry(): FlatEntry | null {
		const selected = (treeList as ListInterface & { selected?: number }).selected ?? 0;
		return flatEntries[selected] ?? null;
	}

	function handleSelect() {
		const entry = getSelectedEntry();
		if (!entry) return;

		if (entry.node.type === "directory") {
			if (expandedSet.has(entry.node.path)) {
				expandedSet.delete(entry.node.path);
			} else {
				expandedSet.add(entry.node.path);
			}
			const selectedIndex = (treeList as ListInterface & { selected?: number }).selected ?? 0;
			rebuildList();
			const maxIndex = flatEntries.length - 1;
			treeList.select(Math.min(selectedIndex, maxIndex));
		}
		void showFileContent(entry);
	}

	// Show first entry on load
	treeList.setItems(flatEntries.map(formatEntry));
	if (flatEntries[0]) {
		void showFileContent(flatEntries[0]);
	}

	treeList.on("select item", () => {
		const entry = getSelectedEntry();
		if (entry) {
			void showFileContent(entry);
		}
	});

	treeList.key(["enter"], () => {
		handleSelect();
		return false;
	});

	treeList.key(["right", "l"], () => {
		const entry = getSelectedEntry();
		if (!entry) return false;
		if (entry.node.type === "directory" && !expandedSet.has(entry.node.path)) {
			expandedSet.add(entry.node.path);
			const selectedIndex = (treeList as ListInterface & { selected?: number }).selected ?? 0;
			rebuildList();
			treeList.select(selectedIndex);
			void showFileContent(entry);
		} else if (entry.node.type === "file" && detailContent) {
			focusDetail();
		}
		return false;
	});

	treeList.key(["left", "h"], () => {
		const entry = getSelectedEntry();
		if (!entry) return false;
		if (entry.node.type === "directory" && expandedSet.has(entry.node.path)) {
			expandedSet.delete(entry.node.path);
			const selectedIndex = (treeList as ListInterface & { selected?: number }).selected ?? 0;
			rebuildList();
			treeList.select(Math.min(selectedIndex, flatEntries.length - 1));
			void showFileContent(entry);
		}
		return false;
	});

	screen.key(["e", "E"], async () => {
		const entry = getSelectedEntry();
		if (!entry || entry.node.type !== "file") return;

		const filePath = join(cwd, ".annie", entry.node.path);
		await options.core.openEditor(filePath, screen);

		const { tree: refreshedTree } = await readAnnieTree(cwd);
		if (refreshedTree?.children) {
			treeChildren = refreshedTree.children;
			const selectedIndex = (treeList as ListInterface & { selected?: number }).selected ?? 0;
			rebuildList();
			treeList.select(Math.min(selectedIndex, flatEntries.length - 1));
		}
		const refreshedEntry = getSelectedEntry();
		if (refreshedEntry) {
			void showFileContent(refreshedEntry);
		}
	});

	if (options.onTabPress) {
		screen.key(["tab"], () => {
			screen.destroy();
			void options.onTabPress?.();
		});
	}

	screen.key(["q", "C-c"], () => {
		screen.destroy();
		process.exit(0);
	});

	screen.key(["escape"], () => {
		if (currentFocus === "detail") {
			focusTree();
		} else {
			screen.destroy();
			process.exit(0);
		}
	});

	focusTree();
	screen.render();

	return new Promise<void>((resolve) => {
		screen.on("destroy", () => resolve());
	});
}
