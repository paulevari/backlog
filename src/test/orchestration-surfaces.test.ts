import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "../mcp/server.ts";
import { registerTaskTools } from "../mcp/tools/tasks/index.ts";
import { initializeTestProject, safeCleanup } from "./test-utils.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");

const graphInput = {
	executionId: "exec-surface",
	idempotencyKey: "materialize:exec-surface",
	planRevision: "sha256:surface",
	parentSessionId: "session-surface",
	parent: { key: "plan", title: "Surface plan", status: "Active" },
	units: [{ key: "O1", title: "Surface unit", status: "Active" }],
};

async function runCli(cwd: string, args: string[], stdin?: string) {
	const process = Bun.spawn(["bun", CLI, ...args], {
		cwd,
		env: { ...globalThis.process.env, BACKLOG_BELLEROPHON_NOTIFICATIONS: "0" },
		stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function configureProject(server: McpServer) {
	await initializeTestProject(server, "Orchestration Surfaces");
	const config = await server.fs.loadConfig();
	if (!config) throw new Error("Expected config");
	const next = {
		...config,
		remoteOperations: false,
		defaultStatus: "Backlog",
		statuses: ["Backlog", "Active", "In Progress", "Review", "Human", "Deferred", "Done"],
	};
	await server.fs.saveConfig(next);
	return next;
}

describe("orchestration CLI surface", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "orchestration-cli-"));
		const server = new McpServer(testDir, "test");
		await configureProject(server);
		await server.stop();
	});

	afterEach(async () => {
		await safeCleanup(testDir);
	});

	it("discovers capabilities, materializes, views, and transitions using JSON", async () => {
		const capabilities = await runCli(testDir, ["capabilities", "--json"]);
		expect(capabilities.exitCode, capabilities.stderr).toBe(0);
		expect(JSON.parse(capabilities.stdout)).toMatchObject({ contractVersion: 1, ready: true });

		const materialized = await runCli(testDir, [
			"task",
			"graph",
			"materialize",
			"--input",
			JSON.stringify(graphInput),
			"--json",
		]);
		expect(materialized.exitCode, materialized.stderr).toBe(0);
		const graph = JSON.parse(materialized.stdout);
		expect(graph.tasks).toHaveLength(2);

		const viewed = await runCli(testDir, ["task", "graph", "view", "--execution-id", "exec-surface", "--json"]);
		expect(viewed.exitCode, viewed.stderr).toBe(0);
		expect(JSON.parse(viewed.stdout)).toEqual(graph);

		const listed = await runCli(testDir, ["task", "graph", "list", "--non-terminal", "--json"]);
		expect(listed.exitCode, listed.stderr).toBe(0);
		expect(JSON.parse(listed.stdout)).toContainEqual({
			executionId: "exec-surface",
			parentSessionId: "session-surface",
			status: "Active",
			parentTaskId: graph.parent.task.id,
			planRevision: "sha256:surface",
			revision: 1,
		});

		const unit = graph.tasks.find((entry: { key: string }) => entry.key === "O1").task;
		const transitioned = await runCli(testDir, [
			"task",
			"transition",
			unit.id,
			"--expected-status",
			"Active",
			"--expected-revision",
			"1",
			"--target-status",
			"In Progress",
			"--actor-role",
			"orchestrator",
			"--actor-session-id",
			"session-surface",
			"--idempotency-key",
			"claim:surface",
			"--json",
		]);
		expect(transitioned.exitCode, transitioned.stderr).toBe(0);
		expect(JSON.parse(transitioned.stdout)).toMatchObject({ status: "In Progress", revision: 2 });
	});

	it("updates configured statuses through the CLI for orchestrator rollout", async () => {
		const updated = await runCli(testDir, [
			"config",
			"set",
			"statuses",
			"Backlog,Active,In Progress,Review,Human,Deferred,Done",
		]);
		expect(updated.exitCode, updated.stderr).toBe(0);
		const capabilities = await runCli(testDir, ["capabilities", "--json"]);
		expect(JSON.parse(capabilities.stdout)).toMatchObject({ ready: true, missingStatuses: [] });
	});

	it("materializes a graph from bounded stdin JSON", async () => {
		const result = await runCli(
			testDir,
			["task", "graph", "materialize", "--input", "-", "--json"],
			JSON.stringify({ ...graphInput, executionId: "exec-stdin", idempotencyKey: "materialize:exec-stdin" }),
		);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ executionId: "exec-stdin" });
	});

	it("rejects oversized graph JSON from stdin", async () => {
		const result = await runCli(
			testDir,
			["task", "graph", "materialize", "--input", "-", "--json"],
			JSON.stringify({
				...graphInput,
				executionId: "exec-oversized",
				idempotencyKey: "materialize:exec-oversized",
				parent: { ...graphInput.parent, implementationPlan: "x".repeat(1_048_576) },
			}),
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("1 MiB");
	});
});

describe("orchestration MCP surface", () => {
	let testDir: string;
	let server: McpServer;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "orchestration-mcp-"));
		server = new McpServer(testDir, "test");
		const config = await configureProject(server);
		registerTaskTools(server, config);
	});

	afterEach(async () => {
		await server.stop().catch(() => undefined);
		await safeCleanup(testDir);
	});

	it("exposes machine-readable capability, graph, view, and transition tools", async () => {
		const listed = await server.testInterface.listTools();
		const names = listed.tools.map((tool) => tool.name);
		expect(names).toContain("orchestration_capabilities");
		expect(names).toContain("task_graph_materialize");
		expect(names).toContain("task_graph_view");
		expect(names).toContain("task_graph_list");
		expect(names).toContain("task_transition");

		const materialized = await server.testInterface.callTool({
			params: { name: "task_graph_materialize", arguments: graphInput },
		});
		expect(materialized.content).toBeDefined();
		const materializedText = (materialized.content[0] as { text: string }).text;
		expect(materializedText).not.toStartWith("Validation");
		const graph = JSON.parse(materializedText);
		const viewed = await server.testInterface.callTool({
			params: { name: "task_graph_view", arguments: { executionId: "exec-surface" } },
		});
		expect(viewed.content).toBeDefined();
		expect(JSON.parse((viewed.content[0] as { text: string }).text)).toEqual(graph);
		const graphList = await server.testInterface.callTool({
			params: { name: "task_graph_list", arguments: { nonTerminal: true } },
		});
		expect(graphList.content).toBeDefined();
		expect(JSON.parse((graphList.content[0] as { text: string }).text)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					executionId: "exec-surface",
					parentSessionId: "session-surface",
					status: "Active",
				}),
			]),
		);
	});
});
