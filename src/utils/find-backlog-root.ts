import { stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { $ } from "bun";
import { resolveBacklogDirectory } from "./backlog-directory.ts";

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
	try {
		const s = await stat(path);
		return s.isFile();
	} catch {
		return false;
	}
}

/**
 * Checks whether a backlog root has backlog configuration markers.
 */
async function hasBacklogSetup(root: string): Promise<boolean> {
	if (resolveBacklogDirectory(root).configPath) {
		return true;
	}
	return await fileExists(join(root, "backlog.json"));
}

/**
 * Redirects a backlog root found inside a linked git worktree to the
 * equivalent path in the main checkout. Linked worktrees carry a checked-out
 * snapshot of the backlog directory that diverges from the main checkout;
 * task state must always be read from and written to the main checkout.
 *
 * Returns null (no redirect) when the root is not inside a linked worktree,
 * git is unavailable, or the main checkout has no backlog setup.
 */
export async function redirectLinkedWorktreeRoot(foundRoot: string): Promise<string | null> {
	try {
		const topLevelResult = await $`git rev-parse --show-toplevel`.cwd(foundRoot).quiet();
		const topLevel = topLevelResult.stdout.toString().trim();
		if (!topLevel) {
			return null;
		}

		// The first entry of `git worktree list` is always the main worktree.
		const listResult = await $`git worktree list --porcelain`.cwd(foundRoot).quiet();
		const firstLine = listResult.stdout.toString().split("\n")[0] ?? "";
		if (!firstLine.startsWith("worktree ")) {
			return null;
		}
		const mainTopLevel = firstLine.slice("worktree ".length).trim();
		if (!mainTopLevel || mainTopLevel === topLevel) {
			return null;
		}

		const candidate = join(mainTopLevel, relative(topLevel, foundRoot));
		if (await hasBacklogSetup(candidate)) {
			return candidate;
		}
	} catch {
		// Not in a git repository or git not available
	}
	return null;
}

/**
 * Finds the Backlog.md project root by walking up the directory tree.
 *
 * Search order:
 * 1. Walk up from startDir looking for a supported backlog directory or `backlog.json` file
 * 2. If not found, fall back to git repository root (via `git rev-parse --show-toplevel`)
 * 3. Return null if no Backlog.md project found
 *
 * A root found inside a linked git worktree is redirected to the equivalent
 * path in the main checkout, so all worktrees share one task state.
 *
 * @param startDir - The directory to start searching from (typically process.cwd())
 * @returns The project root path, or null if no Backlog.md project found
 */
export async function findBacklogRoot(startDir: string): Promise<string | null> {
	const root = await locateBacklogRoot(startDir);
	if (!root) {
		return null;
	}
	return (await redirectLinkedWorktreeRoot(root)) ?? root;
}

async function locateBacklogRoot(startDir: string): Promise<string | null> {
	let current = startDir;

	// Walk up the directory tree looking for a backlog config or backlog.json
	while (current !== dirname(current)) {
		const backlogResolution = resolveBacklogDirectory(current);
		if (backlogResolution.configPath) {
			return current;
		}

		// Check for backlog.json file
		const backlogJson = join(current, "backlog.json");
		if (await fileExists(backlogJson)) {
			return current;
		}

		current = dirname(current);
	}

	// Fallback: try git repository root
	try {
		const result = await $`git rev-parse --show-toplevel`.cwd(startDir).quiet();
		const gitRoot = result.stdout.toString().trim();

		if (gitRoot && (await hasBacklogSetup(gitRoot))) {
			return gitRoot;
		}
	} catch {
		// Not in a git repository or git not available
	}

	return null;
}

// Cache for the project root within a single CLI execution
let cachedProjectRoot: string | null | undefined;

/**
 * Gets the Backlog.md project root, with caching for performance.
 * Call clearProjectRootCache() to reset the cache if needed.
 */
export async function getProjectRoot(startDir: string): Promise<string | null> {
	if (cachedProjectRoot !== undefined) {
		return cachedProjectRoot;
	}

	cachedProjectRoot = await findBacklogRoot(startDir);
	return cachedProjectRoot;
}

/**
 * Clears the cached project root. Useful for testing.
 */
export function clearProjectRootCache(): void {
	cachedProjectRoot = undefined;
}
