import type { BacklogConfig } from "../../../types/index.ts";
import type { McpServer } from "../../server.ts";
import type { McpToolHandler } from "../../types.ts";
import {
	generateTaskCreateSchema,
	generateTaskEditSchema,
	generateTaskListSchema,
	generateTaskSearchSchema,
} from "../../utils/schema-generators.ts";
import { createSimpleValidatedTool } from "../../validation/tool-wrapper.ts";
import type { TaskCreateArgs, TaskEditRequest, TaskListArgs, TaskSearchArgs } from "./handlers.ts";
import { TaskHandlers } from "./handlers.ts";
import {
	orchestrationCapabilitiesSchema,
	taskArchiveSchema,
	taskCompleteSchema,
	taskGraphListSchema,
	taskGraphMaterializeSchema,
	taskGraphViewSchema,
	taskTransitionSchema,
	taskViewSchema,
} from "./schemas.ts";

export function registerTaskTools(server: McpServer, config: BacklogConfig): void {
	const handlers = new TaskHandlers(server);

	const taskCreateSchema = generateTaskCreateSchema(config);
	const taskEditSchema = generateTaskEditSchema(config);
	const taskListSchema = generateTaskListSchema(config);
	const taskSearchSchema = generateTaskSearchSchema(config);
	const orchestrationCapabilitiesTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "orchestration_capabilities",
			description: "Report Backlog.md orchestration contract support and required-status readiness",
			inputSchema: orchestrationCapabilitiesSchema,
			annotations: { title: "Orchestration Capabilities", readOnlyHint: true, destructiveHint: false },
		},
		orchestrationCapabilitiesSchema,
		async () => handlers.orchestrationCapabilities(),
	);

	const taskGraphMaterializeTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_graph_materialize",
			description: "Atomically and idempotently materialize a durable orchestration task graph",
			inputSchema: taskGraphMaterializeSchema,
			annotations: { title: "Materialize Task Graph", destructiveHint: false },
		},
		taskGraphMaterializeSchema,
		async (input) => handlers.materializeTaskGraph(input as never),
	);

	const taskGraphViewTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_graph_view",
			description: "Read the authoritative persisted parent and child snapshots for an execution",
			inputSchema: taskGraphViewSchema,
			annotations: { title: "View Task Graph", readOnlyHint: true, destructiveHint: false },
		},
		taskGraphViewSchema,
		async (input) => handlers.viewTaskGraph(String(input.executionId)),
	);

	const taskGraphListTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_graph_list",
			description: "List execution parents for reconciliation and active-monitor recovery",
			inputSchema: taskGraphListSchema,
			annotations: { title: "List Task Graphs", readOnlyHint: true, destructiveHint: false },
		},
		taskGraphListSchema,
		async (input) => handlers.listTaskGraphs(Boolean(input.nonTerminal)),
	);

	const taskTransitionTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_transition",
			description: "Apply an idempotent role-aware task transition guarded by expected status and revision",
			inputSchema: taskTransitionSchema,
			annotations: { title: "Transition Orchestration Task", destructiveHint: false },
		},
		taskTransitionSchema,
		async (input) => handlers.transitionTask(input as never),
	);

	const createTaskTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_create",
			description: "Create a new task using Backlog.md",
			inputSchema: taskCreateSchema,
			annotations: { title: "Create Task", destructiveHint: false },
		},
		taskCreateSchema,
		async (input) => handlers.createTask(input as TaskCreateArgs),
	);

	const listTaskTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_list",
			description:
				"List Backlog.md tasks with optional filtering by status, type, assignee (or unassigned: true for tasks with no assignee), milestone, labels, and search",
			inputSchema: taskListSchema,
			annotations: { title: "List Tasks", readOnlyHint: true, destructiveHint: false },
		},
		taskListSchema,
		async (input) => handlers.listTasks(input as TaskListArgs),
	);

	const searchTaskTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_search",
			description: "Search Backlog.md tasks by title, description, task type, and modified file path filters",
			inputSchema: taskSearchSchema,
			annotations: { title: "Search Tasks", readOnlyHint: true, destructiveHint: false },
		},
		taskSearchSchema,
		async (input) => handlers.searchTasks(input as TaskSearchArgs),
	);

	const editTaskTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_edit",
			description:
				"Edit a Backlog.md task, including metadata (status, priority, type), implementation plan/notes, dependencies, acceptance criteria, and task-specific Definition of Done items",
			inputSchema: taskEditSchema,
			annotations: { title: "Edit Task", destructiveHint: false },
		},
		taskEditSchema,
		async (input) => handlers.editTask(input as unknown as TaskEditRequest),
	);

	const viewTaskTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_view",
			description: "View a Backlog.md task details",
			inputSchema: taskViewSchema,
			annotations: { title: "View Task", readOnlyHint: true, destructiveHint: false },
		},
		taskViewSchema,
		async (input) => handlers.viewTask(input as { id: string }),
	);

	const archiveTaskTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_archive",
			description: "Archive a Backlog.md task",
			inputSchema: taskArchiveSchema,
			annotations: { title: "Archive Task", destructiveHint: true },
		},
		taskArchiveSchema,
		async (input) => handlers.archiveTask(input as { id: string }),
	);

	const completeTaskTool: McpToolHandler = createSimpleValidatedTool(
		{
			name: "task_complete",
			description: "Complete a Backlog.md task (move it to the completed folder)",
			inputSchema: taskCompleteSchema,
			annotations: { title: "Complete Task", destructiveHint: true },
		},
		taskCompleteSchema,
		async (input) => handlers.completeTask(input as { id: string }),
	);

	server.addTool(createTaskTool);
	server.addTool(orchestrationCapabilitiesTool);
	server.addTool(taskGraphMaterializeTool);
	server.addTool(taskGraphListTool);
	server.addTool(taskGraphViewTool);
	server.addTool(taskTransitionTool);
	server.addTool(listTaskTool);
	server.addTool(searchTaskTool);
	server.addTool(editTaskTool);
	server.addTool(viewTaskTool);
	server.addTool(archiveTaskTool);
	server.addTool(completeTaskTool);
}

export type { TaskCreateArgs, TaskEditArgs, TaskListArgs, TaskSearchArgs } from "./handlers.ts";
export {
	orchestrationCapabilitiesSchema,
	taskArchiveSchema,
	taskCompleteSchema,
	taskGraphListSchema,
	taskGraphMaterializeSchema,
	taskGraphViewSchema,
	taskListSchema,
	taskSearchSchema,
	taskTransitionSchema,
	taskViewSchema,
} from "./schemas.ts";
