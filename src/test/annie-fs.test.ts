import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAnnieFile, readAnnieTree, validateAnniePath, writeAnnieFile } from "../utils/annie-fs.ts";

describe("annie-fs", () => {
	let tempDir: string;
	let annieDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "annie-fs-test-"));
		annieDir = join(tempDir, ".annie");
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("validateAnniePath", () => {
		beforeEach(() => {
			mkdirSync(annieDir, { recursive: true });
		});

		it("rejects paths containing ..", () => {
			expect(() => validateAnniePath("../etc/passwd", annieDir)).toThrow();
		});

		it("rejects absolute paths", () => {
			expect(() => validateAnniePath("/etc/passwd", annieDir)).toThrow();
		});

		it("rejects empty paths", () => {
			expect(() => validateAnniePath("", annieDir)).toThrow();
		});

		it("accepts valid relative paths", () => {
			const result = validateAnniePath("docs/plans/my-plan.md", annieDir);
			expect(result).toBe(join(annieDir, "docs/plans/my-plan.md"));
		});
	});

	describe("readAnnieTree", () => {
		it("returns exists: false when .annie/ does not exist", async () => {
			const result = await readAnnieTree(tempDir);
			expect(result.exists).toBe(false);
			expect(result.tree).toBeNull();
		});

		it("returns the directory tree when .annie/ exists", async () => {
			mkdirSync(join(annieDir, "docs/plans"), { recursive: true });
			writeFileSync(join(annieDir, "docs/plans/plan-a.md"), "# Plan A");
			writeFileSync(join(annieDir, "docs/plans/plan-b.md"), "# Plan B");

			const result = await readAnnieTree(tempDir);
			expect(result.exists).toBe(true);
			expect(result.tree).not.toBeNull();
			expect(result.tree?.name).toBe(".annie");
			expect(result.tree?.type).toBe("directory");
		});

		it("sorts directories before files, alphabetically", async () => {
			mkdirSync(join(annieDir, "docs"), { recursive: true });
			mkdirSync(join(annieDir, "observations"), { recursive: true });
			writeFileSync(join(annieDir, "README.md"), "readme");

			const result = await readAnnieTree(tempDir);
			const children = result.tree?.children ?? [];
			expect(children[0]?.name).toBe("docs");
			expect(children[1]?.name).toBe("observations");
			expect(children[2]?.name).toBe("README.md");
		});

		it("builds nested tree with correct relative paths", async () => {
			mkdirSync(join(annieDir, "docs/plans"), { recursive: true });
			writeFileSync(join(annieDir, "docs/plans/my-plan.md"), "content");

			const result = await readAnnieTree(tempDir);
			const docs = result.tree?.children?.find((c) => c.name === "docs");
			expect(docs).toBeDefined();
			const plans = docs?.children?.find((c) => c.name === "plans");
			expect(plans).toBeDefined();
			const file = plans?.children?.find((c) => c.name === "my-plan.md");
			expect(file).toBeDefined();

			expect(file?.path).toBe("docs/plans/my-plan.md");
			expect(file?.type).toBe("file");
		});
	});

	describe("readAnnieFile", () => {
		it("reads file content and returns metadata", async () => {
			mkdirSync(join(annieDir, "docs"), { recursive: true });
			writeFileSync(join(annieDir, "docs/test.md"), "# Hello World");

			const result = await readAnnieFile(tempDir, "docs/test.md");
			expect(result.name).toBe("test.md");
			expect(result.path).toBe("docs/test.md");
			expect(result.content).toBe("# Hello World");
			expect(result.size).toBeGreaterThan(0);
		});

		it("throws on path traversal attempt", async () => {
			await expect(readAnnieFile(tempDir, "../package.json")).rejects.toThrow();
		});

		it("throws when file does not exist", async () => {
			mkdirSync(annieDir, { recursive: true });
			await expect(readAnnieFile(tempDir, "nonexistent.md")).rejects.toThrow();
		});
	});

	describe("writeAnnieFile", () => {
		it("writes content to an existing file", async () => {
			mkdirSync(join(annieDir, "docs"), { recursive: true });
			writeFileSync(join(annieDir, "docs/test.md"), "old content");

			await writeAnnieFile(tempDir, "docs/test.md", "new content");

			const result = await readAnnieFile(tempDir, "docs/test.md");
			expect(result.content).toBe("new content");
		});

		it("throws on path traversal attempt", async () => {
			await expect(writeAnnieFile(tempDir, "../evil.md", "hack")).rejects.toThrow();
		});
	});
});
