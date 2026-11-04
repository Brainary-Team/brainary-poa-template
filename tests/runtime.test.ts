import { exec as execCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { parse } from "smol-toml";
import { describe, expect, it, vi } from "vitest";

const exec = promisify(execCallback);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

describe("PoA package contract", () => {
  it("uses the current Brainary runtime contract", async () => {
    const manifest = parse(
      await readFile(new URL("../manifest.toml", import.meta.url), "utf8"),
    ) as {
      poa: {
        runtime: string;
        poa_api_version: number;
        entry: string;
      };
    };

    expect(manifest.poa).toMatchObject({
      runtime: "codex-v8",
      poa_api_version: 1,
      entry: "main.js",
    });
  });

  it("emits the runtime entry output from POA_INPUT", async () => {
    const output: unknown[] = [];
    vi.resetModules();
    vi.stubGlobal("POA_INPUT", { message: "from runtime" });
    vi.stubGlobal("text", (value: unknown) => output.push(value));

    try {
      await import("../src/main.js");
    } finally {
      vi.unstubAllGlobals();
    }

    expect(output).toEqual([
      {
        ok: true,
        message: "from runtime",
      },
    ]);
  });

  it("packages the entry, manifest, and input schema", async () => {
    // The fixed command uses the platform shell so Windows can launch pnpm.cmd.
    await exec("pnpm package", { cwd: projectRoot });

    const archive = unzipSync(
      await readFile(new URL("../dist/my-poa.poa", import.meta.url)),
    );

    expect(Object.keys(archive).sort()).toEqual([
      "input_schema.json",
      "main.js",
      "manifest.toml",
    ]);
    const manifest = parse(new TextDecoder().decode(archive["manifest.toml"]));
    expect(manifest.poa).toMatchObject({
      entry: "main.js",
      input_schema: "input_schema.json",
    });
    expect(
      JSON.parse(new TextDecoder().decode(archive["input_schema.json"])),
    ).toMatchObject({
      type: "object",
      description: "Input accepted by the starter PoA.",
      properties: {
        message: {
          type: "string",
        },
      },
    });
  });
});
