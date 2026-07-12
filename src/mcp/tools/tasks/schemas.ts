import { generateTaskListSchema, generateTaskSearchSchema } from "../../utils/schema-generators.ts";
import type { JsonSchema } from "../../validation/validators.ts";

export const taskListSchema: JsonSchema = generateTaskListSchema({});

export const taskSearchSchema: JsonSchema = generateTaskSearchSchema({});

export const taskViewSchema: JsonSchema = {
	type: "object",
	properties: {
		id: {
			type: "string",
			minLength: 1,
			maxLength: 50,
		},
	},
	required: ["id"],
	additionalProperties: false,
};

export const taskArchiveSchema: JsonSchema = {
	type: "object",
	properties: {
		id: {
			type: "string",
			minLength: 1,
			maxLength: 50,
		},
	},
	required: ["id"],
	additionalProperties: false,
};

export const taskCompleteSchema: JsonSchema = {
	type: "object",
	properties: {
		id: {
			type: "string",
			minLength: 1,
			maxLength: 50,
		},
	},
	required: ["id"],
	additionalProperties: false,
};

const orchestrationTaskNodeSchema: JsonSchema = {
	type: "object",
	properties: {
		key: { type: "string", minLength: 1, maxLength: 100 },
		title: { type: "string", minLength: 1, maxLength: 200 },
		status: { type: "string", minLength: 1, maxLength: 100 },
		description: { type: "string", maxLength: 10000 },
		implementationPlan: { type: "string", maxLength: 50000 },
		implementationNotes: { type: "string", maxLength: 50000 },
		finalSummary: { type: "string", maxLength: 50000 },
		labels: { type: "array", items: { type: "string", maxLength: 50 } },
		assignee: { type: "array", items: { type: "string", maxLength: 100 } },
		dependsOn: { type: "array", items: { type: "string", maxLength: 100 } },
		references: { type: "array", items: { type: "string", maxLength: 500 } },
		documentation: { type: "array", items: { type: "string", maxLength: 500 } },
		modifiedFiles: { type: "array", items: { type: "string", maxLength: 500 } },
		acceptanceCriteria: { type: "array", items: { type: "string", maxLength: 1000 } },
		definitionOfDone: { type: "array", items: { type: "string", maxLength: 1000 } },
	},
	required: ["key", "title"],
	additionalProperties: false,
};

export const orchestrationCapabilitiesSchema: JsonSchema = {
	type: "object",
	properties: {},
	required: [],
	additionalProperties: false,
};

export const taskGraphMaterializeSchema: JsonSchema = {
	type: "object",
	properties: {
		executionId: { type: "string", minLength: 1, maxLength: 200 },
		idempotencyKey: { type: "string", minLength: 1, maxLength: 500 },
		planRevision: { type: "string", minLength: 1, maxLength: 500 },
		planReference: { type: "string", maxLength: 1000 },
		parentSessionId: { type: "string", minLength: 1, maxLength: 200 },
		parent: orchestrationTaskNodeSchema,
		units: { type: "array", items: orchestrationTaskNodeSchema, maxItems: 500 },
	},
	required: ["executionId", "idempotencyKey", "planRevision", "parent", "units"],
	additionalProperties: false,
};

export const taskGraphListSchema: JsonSchema = {
	type: "object",
	properties: {
		nonTerminal: { type: "boolean" },
	},
	required: [],
	additionalProperties: false,
};

export const taskGraphViewSchema: JsonSchema = {
	type: "object",
	properties: {
		executionId: { type: "string", minLength: 1, maxLength: 200 },
	},
	required: ["executionId"],
	additionalProperties: false,
};

export const taskTransitionSchema: JsonSchema = {
	type: "object",
	properties: {
		taskId: { type: "string", minLength: 1, maxLength: 50 },
		expectedStatus: { type: "string", minLength: 1, maxLength: 100 },
		expectedRevision: { type: "number", minimum: 1 },
		targetStatus: { type: "string", minLength: 1, maxLength: 100 },
		actorRole: { type: "string", enum: ["orchestrator", "worker", "reviewer"] },
		actorSessionId: { type: "string", minLength: 1, maxLength: 200 },
		idempotencyKey: { type: "string", minLength: 1, maxLength: 500 },
		orchestration: { type: "object", additionalProperties: true },
		implementationNotes: { type: "string", maxLength: 50000 },
		finalSummary: { type: "string", maxLength: 50000 },
	},
	required: ["taskId", "expectedStatus", "expectedRevision", "targetStatus", "actorRole", "idempotencyKey"],
	additionalProperties: false,
};

export const taskDemoteSchema: JsonSchema = {
	type: "object",
	properties: {
		id: {
			type: "string",
			minLength: 1,
			maxLength: 50,
		},
	},
	required: ["id"],
	additionalProperties: false,
};
