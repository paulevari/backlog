import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export interface AnnieTreeNode {
	name: string;
	path: string;
	type: "file" | "directory";
	children?: AnnieTreeNode[];
}

export function validateAnniePath(relativePath: string, annieRoot: string): string {
	if (!relativePath || relativePath.length === 0) {
		throw new Error("Path cannot be empty");
	}
	if (relativePath.startsWith("/")) {
		throw new Error("Path must be relative");
	}
	if (relativePath.includes("..")) {
		throw new Error("Path traversal not allowed");
	}
	const resolved = resolve(annieRoot, relativePath);
	if (!resolved.startsWith(resolve(annieRoot))) {
		throw new Error("Path escapes annie root");
	}
	return resolved;
}

async function buildTree(dirPath: string, relativePath: string, depth: number): Promise<AnnieTreeNode[]> {
	if (depth > 5) return [];

	const entries = await readdir(dirPath, { withFileTypes: true });

	const dirs: AnnieTreeNode[] = [];
	const files: AnnieTreeNode[] = [];

	for (const entry of entries) {
		const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			const children = await buildTree(join(dirPath, entry.name), entryRelPath, depth + 1);
			dirs.push({ name: entry.name, path: entryRelPath, type: "directory", children });
		} else if (entry.isFile()) {
			files.push({ name: entry.name, path: entryRelPath, type: "file" });
		}
	}

	dirs.sort((a, b) => a.name.localeCompare(b.name));
	files.sort((a, b) => a.name.localeCompare(b.name));

	return [...dirs, ...files];
}

export async function readAnnieTree(rootDir: string): Promise<{ exists: boolean; tree: AnnieTreeNode | null }> {
	const annieDir = join(rootDir, ".annie");
	try {
		const s = await stat(annieDir);
		if (!s.isDirectory()) return { exists: false, tree: null };
	} catch {
		return { exists: false, tree: null };
	}

	const children = await buildTree(annieDir, "", 0);
	return {
		exists: true,
		tree: { name: ".annie", path: "", type: "directory", children },
	};
}

export async function readAnnieFile(
	rootDir: string,
	relativePath: string,
): Promise<{ path: string; name: string; content: string; size: number }> {
	const annieDir = join(rootDir, ".annie");
	const filePath = validateAnniePath(relativePath, annieDir);

	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		throw new Error(`File not found: ${relativePath}`);
	}

	const content = await file.text();
	return {
		path: relativePath,
		name: basename(filePath),
		content,
		size: file.size,
	};
}

export async function writeAnnieFile(rootDir: string, relativePath: string, content: string): Promise<void> {
	const annieDir = join(rootDir, ".annie");
	const filePath = validateAnniePath(relativePath, annieDir);
	await Bun.write(filePath, content);
}
