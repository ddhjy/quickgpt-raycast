import fs from "fs";
import os from "os";
import path from "path";
import configurationManager from "../managers/configuration-manager";
import promptManager from "../managers/prompt-manager";

describe("PromptManager refresh change detection", () => {
  it("reports a change only when the library content differs from what is loaded", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quickgpt-prompts-"));
    const promptFile = path.join(directory, "prompts.hjson");
    fs.writeFileSync(promptFile, '[{ title: "First", content: "one" }]');

    const directoriesSpy = jest.spyOn(configurationManager, "getDirectories").mockReturnValue([directory]);
    const changeEvents: boolean[] = [];
    const unsubscribe = promptManager.subscribe((promptsChanged) => changeEvents.push(promptsChanged));

    try {
      await promptManager.refreshPrompts();
      expect(promptManager.findPrompt((prompt) => prompt.title === "First")).toBeDefined();

      await promptManager.refreshPrompts();

      fs.writeFileSync(promptFile, '[{ title: "Second", content: "two" }]');
      await promptManager.refreshPrompts();
      expect(promptManager.findPrompt((prompt) => prompt.title === "First")).toBeUndefined();
      expect(promptManager.findPrompt((prompt) => prompt.title === "Second")).toBeDefined();

      expect(changeEvents).toEqual([true, false, true]);
    } finally {
      unsubscribe();
      directoriesSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("joins a running refresh, while a reload runs again after it", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quickgpt-prompts-"));
    fs.writeFileSync(path.join(directory, "prompts.hjson"), '[{ title: "Joined", content: "one" }]');

    const directoriesSpy = jest.spyOn(configurationManager, "getDirectories").mockReturnValue([directory]);
    const changeEvents: boolean[] = [];
    const unsubscribe = promptManager.subscribe((promptsChanged) => changeEvents.push(promptsChanged));

    try {
      await Promise.all([promptManager.refreshPrompts(), promptManager.refreshPrompts()]);
      expect(changeEvents).toHaveLength(1);

      await Promise.all([promptManager.refreshPrompts(), promptManager.reloadPrompts()]);
      expect(changeEvents).toHaveLength(3);
    } finally {
      unsubscribe();
      directoriesSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
