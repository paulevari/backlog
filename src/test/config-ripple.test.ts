import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { Core } from "../index.ts";
import { createUniqueTestDir, initializeTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;

describe("ripple_command config", () => {
	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-config-ripple");
		await mkdir(TEST_DIR, { recursive: true });
	});
	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("round-trips ripple_command through save and load", async () => {
		const core = new Core(TEST_DIR);
		await initializeTestProject(core, "Ripple Config");
		const config = await core.filesystem.loadConfig();
		expect(config?.rippleCommand).toBeUndefined();
		if (!config) throw new Error("config missing");
		await core.filesystem.saveConfig({ ...config, rippleCommand: "ssh puddle ripple" });
		const reloaded = await new Core(TEST_DIR).filesystem.loadConfig();
		expect(reloaded?.rippleCommand).toBe("ssh puddle ripple");
	});
});
