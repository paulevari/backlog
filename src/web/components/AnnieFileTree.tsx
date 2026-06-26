import { useState } from "react";
import type { AnnieTreeNode } from "../lib/api";

interface AnnieFileTreeProps {
	tree: AnnieTreeNode;
	selectedPath: string | null;
	onSelectFile: (path: string) => void;
}

function TreeNode({
	node,
	selectedPath,
	onSelectFile,
	expanded,
	onToggle,
}: {
	node: AnnieTreeNode;
	selectedPath: string | null;
	onSelectFile: (path: string) => void;
	expanded: Set<string>;
	onToggle: (path: string) => void;
}) {
	const isExpanded = expanded.has(node.path);
	const isSelected = node.path === selectedPath;

	if (node.type === "directory") {
		const sorted = [...(node.children || [])].sort((a, b) => {
			if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

		return (
			<div>
				<button
					type="button"
					onClick={() => onToggle(node.path)}
					className="flex items-center w-full px-2 py-1 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors duration-200"
				>
					<span className="mr-1 text-gray-400 dark:text-gray-500 text-xs">
						{isExpanded ? "▾" : "▸"}
					</span>
					<span className="truncate">{node.name}</span>
				</button>
				{isExpanded && (
					<div className="ml-3 border-l border-gray-200 dark:border-gray-700 pl-1">
						{sorted.map((child) => (
							<TreeNode
								key={child.path}
								node={child}
								selectedPath={selectedPath}
								onSelectFile={onSelectFile}
								expanded={expanded}
								onToggle={onToggle}
							/>
						))}
					</div>
				)}
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={() => onSelectFile(node.path)}
			className={`flex items-center w-full px-2 py-1 text-sm rounded transition-colors duration-200 ${
				isSelected
					? "bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 font-medium"
					: "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
			}`}
		>
			<span className="mr-1 text-gray-400 dark:text-gray-500 text-xs">{"·"}</span>
			<span className="truncate">{node.name}</span>
		</button>
	);
}

export default function AnnieFileTree({ tree, selectedPath, onSelectFile }: AnnieFileTreeProps) {
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));

	const onToggle = (path: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	const sorted = [...(tree.children || [])].sort((a, b) => {
		if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	return (
		<div className="space-y-0.5">
			{sorted.map((child) => (
				<TreeNode
					key={child.path}
					node={child}
					selectedPath={selectedPath}
					onSelectFile={onSelectFile}
					expanded={expanded}
					onToggle={onToggle}
				/>
			))}
		</div>
	);
}
