import { execFile as execFileCallback } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { parse } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = `[poa]
namespace = "brainary"
name = "test_poa"
version = "0.1.0"
runtime = "codex-v8"
poa_api_version = 1
entry = "main.js"
`;
let root: string;

async function pack(env = process.env) {
  return execFile(process.execPath, [join(root, "scripts/package.mjs")], {
    cwd: root,
    env,
  });
}

async function archive() {
  return unzipSync(await readFile(join(root, "dist/my-poa.poa")));
}

function json(bytes: Uint8Array) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe("standalone PoA packaging", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "poa package test "));
    await cp(join(projectRoot, "scripts"), join(root, "scripts"), {
      recursive: true,
    });
    await symlink(
      join(projectRoot, "node_modules"),
      join(root, "node_modules"),
      "junction",
    );
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist/main.js"), "text({ok: true});\n");
    await writeFile(join(root, "manifest.toml"), manifest);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prefers TS over stale JSON, updates only the archived manifest, and never executes schema code", async () => {
    const source = `export interface InputParams { /** @minLength 2 */ message: string }`;
    const stale = '{"type":"object","properties":{"old":{"type":"number"}}}';
    await writeFile(join(root, "input_schema.ts"), source);
    await writeFile(join(root, "input_schema.json"), stale);
    await pack();
    const files = await archive();
    expect(Object.keys(files).sort()).toEqual([
      "input_schema.json",
      "main.js",
      "manifest.toml",
    ]);
    expect(json(files["input_schema.json"])).toMatchObject({
      type: "object",
      properties: { message: { type: "string", minLength: 2 } },
      required: ["message"],
    });
    expect(
      parse(new TextDecoder().decode(files["manifest.toml"])).poa,
    ).toMatchObject({ input_schema: "input_schema.json" });
    expect(await readFile(join(root, "manifest.toml"), "utf8")).toBe(manifest);
    expect(await readFile(join(root, "input_schema.ts"), "utf8")).toBe(source);
    expect(await readFile(join(root, "input_schema.json"), "utf8")).toBe(stale);
  });

  it("supports hand-written JSON without a TS file", async () => {
    const schema = {
      type: "object",
      properties: { count: { type: "integer", minimum: 0 } },
      required: ["count"],
      additionalProperties: false,
    };
    await writeFile(join(root, "input_schema.json"), JSON.stringify(schema));
    await pack();
    expect(json((await archive())["input_schema.json"])).toEqual(schema);
    await expect(readFile(join(root, "input_schema.ts"))).rejects.toThrow();
  });

  it("supports a PoA with no input schema", async () => {
    await pack();
    const files = await archive();
    expect(Object.keys(files).sort()).toEqual(["main.js", "manifest.toml"]);
    expect(new TextDecoder().decode(files["manifest.toml"])).toBe(manifest);
  });

  it("keeps MCP declarations and nested resources while excluding development files", async () => {
    const fullManifest = `${manifest}\n[[capabilities.mcp]]\nname = "example"\ntype = "stdio"\nshell = "node mcp/server.mjs"\n`;
    await writeFile(join(root, "manifest.toml"), fullManifest);
    await writeFile(join(root, "input_schema.ts"), "interface InputParams {}");
    await mkdir(join(root, "mcp/resources"), { recursive: true });
    await writeFile(
      join(root, "mcp/server.mjs"),
      "// external MCP server fixture",
    );
    await writeFile(join(root, "mcp/resources/prompt.txt"), "你好 PoA");
    await writeFile(join(root, "mcp/.gitkeep"), "");
    await writeFile(join(root, "secret.txt"), "must not ship");
    await pack();
    const files = await archive();
    expect(Object.keys(files).sort()).toEqual([
      "input_schema.json",
      "main.js",
      "manifest.toml",
      "mcp/resources/prompt.txt",
      "mcp/server.mjs",
    ]);
    expect(
      parse(new TextDecoder().decode(files["manifest.toml"])).capabilities,
    ).toEqual({
      mcp: [{ name: "example", type: "stdio", shell: "node mcp/server.mjs" }],
    });
    expect(new TextDecoder().decode(files["mcp/resources/prompt.txt"])).toBe(
      "你好 PoA",
    );
  });

  it("produces identical bytes across repeated runs and time zones", async () => {
    await writeFile(
      join(root, "input_schema.ts"),
      "interface InputParams {message: string}",
    );
    await pack({ ...process.env, TZ: "UTC" });
    const first = await readFile(join(root, "dist/my-poa.poa"));
    await pack({ ...process.env, TZ: "Asia/Singapore" });
    expect(await readFile(join(root, "dist/my-poa.poa"))).toEqual(first);
  });

  it.each([
    ["interface InputParams {", "validation failed"],
    ["type InputParams = string", "object schema"],
    ["interface InputParams { value: Unknown }", "unknown schema type"],
    ["console.log('must never execute')", "only interface and type"],
    [
      "interface InputParams { /** @pattern [ */ value: string }",
      "not a valid JSON Schema",
    ],
    [
      "interface InputParams { /** @multipleOf 0 */ value: number }",
      "not a valid JSON Schema",
    ],
  ])("fails packaging invalid TS: %s", async (source, message) => {
    await writeFile(join(root, "input_schema.ts"), source);
    await expect(pack()).rejects.toThrow(message);
    await expect(readFile(join(root, "dist/my-poa.poa"))).rejects.toThrow();
  });

  it.each([
    "{bad json}",
    '{"type":"array"}',
    '{"type":"object","properties":{"x":{"type":"wrong"}}}',
    '{"type":"object","properties":{"x":{"$ref":"#/$defs/Missing"}}}',
  ])("fails packaging invalid JSON: %s", async (source) => {
    await writeFile(join(root, "input_schema.json"), source);
    await expect(pack()).rejects.toThrow();
    await expect(readFile(join(root, "dist/my-poa.poa"))).rejects.toThrow();
  });

  it.each([
    `${manifest}input_schema = "missing.json"\n`,
    manifest.replace('runtime = "codex-v8"', 'runtime = "other"'),
    manifest.replace("poa_api_version = 1", "poa_api_version = 2"),
    manifest.replace('entry = "main.js"', 'entry = "../main.js"'),
    manifest.replace('name = "test_poa"', 'name = ""'),
    "invalid TOML [",
  ])("rejects invalid manifests %#", async (source) => {
    await writeFile(join(root, "manifest.toml"), source);
    await expect(pack()).rejects.toThrow();
    await expect(readFile(join(root, "dist/my-poa.poa"))).rejects.toThrow();
  });

  it("rejects missing build output", async () => {
    await rm(join(root, "dist/main.js"));
    await expect(pack()).rejects.toThrow("run the build first");
  });

  it("rejects an MCP directory linked outside the package", async () => {
    await symlink(join(root, "scripts"), join(root, "mcp"), "junction");
    await expect(pack()).rejects.toThrow("regular directory");
  });

  it("rejects linked MCP resources", async () => {
    await mkdir(join(root, "mcp"));
    await symlink(
      join(root, "scripts"),
      join(root, "mcp/external"),
      "junction",
    );
    await expect(pack()).rejects.toThrow("regular file");
  });
});
