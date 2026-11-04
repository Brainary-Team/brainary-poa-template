import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compileInputSchema } from "../scripts/compile-input-schema.mjs";
import { validateInputSchema } from "../scripts/validate-input-schema.mjs";

describe("TypeScript input schema compiler", () => {
  it("compiles the template schema into JSON Schema", async () => {
    const source = await readFile(
      new URL("../input_schema.ts", import.meta.url),
      "utf8",
    );

    expect(compileInputSchema(source)).toEqual({
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Optional message for the example PoA.",
        },
      },
      additionalProperties: false,
      description: "Input accepted by the starter PoA.",
      title: "My PoA input",
      $schema: "https://json-schema.org/draft/2020-12/schema",
    });
  });

  it("requires the InputParams root type", () => {
    expect(() =>
      compileInputSchema("interface Other { value: string }"),
    ).toThrow("must declare an interface or type named `InputParams`");
  });

  it("rejects unsupported declarations", () => {
    expect(() => compileInputSchema("const value = 1;")).toThrow(
      "only interface and type declarations are allowed",
    );
  });

  it("keeps named object intersections inline and supports recursive definitions", () => {
    const schema = compileInputSchema(`
      interface RequiredPart { id: string }
      interface OptionalPart { note?: string }
      type Combined = RequiredPart & OptionalPart
      interface Node { value: string; next?: Node }
      interface InputParams { combined?: Combined; root?: Node }
    `);

    expect(schema).toMatchObject({
      properties: {
        combined: {
          $ref: "#/$defs/Combined",
        },
        root: {
          $ref: "#/$defs/Node",
        },
      },
      $defs: {
        Combined: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            note: { type: "string" },
          },
        },
        Node: {
          properties: {
            next: { $ref: "#/$defs/Node" },
          },
        },
      },
    });
  });

  it("rejects a root schema that references itself", () => {
    expect(() =>
      compileInputSchema("interface InputParams { next?: InputParams }"),
    ).toThrow("`InputParams` cannot reference itself");
  });

  it("matches the runtime rules for null and incompatible intersections", () => {
    expect(
      compileInputSchema("interface InputParams { empty: null }").properties
        .empty,
    ).toEqual({ type: "null" });
    expect(() =>
      compileInputSchema("interface InputParams { value: string & number }"),
    ).toThrow("intersection contains incompatible schema types");
  });

  it("preserves constraints from the Brainary comprehensive example", async () => {
    // Copied from brainary-codex/workflow-demos/poas/01_input_schema_all.
    const schema = compileInputSchema(
      await readFile(
        new URL("./fixtures/input-schema.txt", import.meta.url),
        "utf8",
      ),
    );
    expect(schema.title).toBe("Complete PoA input");
    expect(schema.properties.attempts).toMatchObject({
      type: "integer",
      minimum: 0,
      maximum: 10,
      multipleOf: 1,
    });
    expect(schema.properties.tags).toMatchObject({
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
    });
    expect(schema.$defs.BoundedCode).toEqual({
      allOf: [
        { type: "string", minLength: 2 },
        { type: "string", maxLength: 8 },
      ],
    });
    expect(schema.$defs.CombinedObject).toMatchObject({
      type: "object",
      required: ["id", "shared"],
      additionalProperties: false,
    });
    expect(schema.$defs.ImageBase64Source.properties.data).toMatchObject({
      contentEncoding: "base64",
      minLength: 1,
    });
    expect(schema.$defs.NamedMetadata.additionalProperties).toEqual({
      $ref: "#/$defs/NonEmptyString",
    });
    expect(schema.$defs).toHaveProperty("NonEmptyString", {
      type: "string",
      minLength: 1,
    });
    const validate = validateInputSchema(schema);
    const valid = {
      city: "Singapore",
      attempts: 2,
      confidence: 0.5,
      kind: "complete-example",
      mode: "fast",
      tags: ["a"],
      scores: [1],
      image: {
        type: "image",
        source: { type: "base64", mediaType: "image/png", data: "YWJj" },
      },
      exactValue: "https://example.com",
      boundedCode: "abc",
      combinedObject: { id: "a", shared: "b" },
      namedMetadata: { key: "value" },
    };
    expect(validate(valid)).toBe(true);
    for (const invalid of [
      { city: "" },
      { attempts: 1.5 },
      { confidence: 0 },
      { tags: ["a", "a"] },
      { exactValue: "invalid" },
      { boundedCode: "a" },
      { combinedObject: { id: "a" } },
      { namedMetadata: { key: "" } },
      { unexpected: true },
    ]) {
      expect(validate(invalid), JSON.stringify(invalid)).toBe(false);
    }
  });

  it.each([
    ["@title Demo", "title", "Demo", "string"],
    ["@format uri", "format", "uri", "string"],
    ["@contentEncoding base64", "contentEncoding", "base64", "string"],
    ["@pattern ^abc$", "pattern", "^abc$", "string"],
    ["@minLength 1", "minLength", 1, "string"],
    ["@maxLength 5", "maxLength", 5, "string"],
    ["@minItems 1", "minItems", 1, "string[]"],
    ["@maxItems 5", "maxItems", 5, "string[]"],
    ["@uniqueItems", "uniqueItems", true, "string[]"],
    ["@uniqueItems false", "uniqueItems", false, "string[]"],
    ["@minimum -2", "minimum", -2, "number"],
    ["@maximum 5", "maximum", 5, "number"],
    ["@exclusiveMinimum 0", "exclusiveMinimum", 0, "number"],
    ["@exclusiveMaximum 1", "exclusiveMaximum", 1, "number"],
    ["@multipleOf 0.5", "multipleOf", 0.5, "number"],
    ["@asType integer", "type", "integer", "number"],
  ])(
    "converts same-line %s on properties and type aliases",
    (tag, key, expected, type) => {
      const direct = compileInputSchema(
        `interface InputParams { /** ${tag} */ value: ${type} }`,
      );
      const named = compileInputSchema(
        `interface InputParams { value: Value }\n/** ${tag} */ type Value = ${type}`,
      );
      expect(direct.properties.value[key as string]).toEqual(expected);
      expect(named.$defs.Value[key as string]).toEqual(expected);
    },
  );

  it("preserves literal types, oneOf, negative numbers and quoted keys", () => {
    const schema = compileInputSchema(`interface InputParams {
      /** @oneOf */ level: 1 | 2;
      strict: true;
      mode: "a" | "a" | "b";
      mixed: 1 | "one" | true;
      negative: -2;
      "__proto__"?: string;
      constructor: Constructor;
    }
    interface Constructor { value: string }`);
    expect(schema.properties).toMatchObject({
      level: {
        type: "number",
        oneOf: [
          { type: "number", const: 1 },
          { type: "number", const: 2 },
        ],
      },
      strict: { type: "boolean", const: true },
      mode: { type: "string", enum: ["a", "b"] },
      mixed: { enum: [1, "one", true] },
      negative: { type: "number", const: -2 },
    });
    const parsed = JSON.parse(JSON.stringify(schema));
    expect(Object.hasOwn(parsed.properties, "__proto__")).toBe(true);
    expect(
      validateInputSchema(schema)(
        JSON.parse(
          '{"level":1,"strict":true,"mode":"a","mixed":true,"negative":-2,"constructor":{"value":"ok"}}',
        ),
      ),
    ).toBe(true);
  });

  it("intersects additionalProperties and keeps all property constraints", () => {
    const schema = compileInputSchema(`interface InputParams { value: Combined }
      /** @additionalProperties true */ interface Open { extra?: string }
      interface Closed { /** @minLength 1 */ shared: string }
      type Combined = Open & Closed & { /** @maxLength 5 */ shared: string } & { /** @pattern ^[a-z]+$ */ shared: string };`);
    expect(schema.$defs.Combined.additionalProperties).toBe(false);
    expect(schema.$defs.Combined.properties.shared).toEqual({
      allOf: [
        { type: "string", minLength: 1 },
        { type: "string", maxLength: 5 },
        { type: "string", pattern: "^[a-z]+$" },
      ],
    });
    const validate = validateInputSchema(schema);
    expect(validate({ value: { shared: "abc", extra: "ok" } })).toBe(true);
    expect(validate({ value: { shared: "abc", unknown: true } })).toBe(false);
  });

  it.each([
    ["interface InputParams { value: Missing }", "unknown schema type"],
    ["interface InputParams {", "validation failed"],
    [
      "import { Something } from './other'; interface InputParams {}",
      "only interface and type",
    ],
    [
      "interface Base {} interface InputParams extends Base {}",
      "extends is not supported",
    ],
    ["interface InputParams<T> {}", "generic type declarations"],
    [
      "interface InputParams { value: string; value: number }",
      "declared more than once",
    ],
    [
      "interface InputParams {} interface InputParams {}",
      "declared more than once",
    ],
    ["interface InputParams { value: any }", "unsupported TypeScript"],
    ["interface InputParams { value: 1e309 }", "must be finite"],
    ["interface InputParams { value: -1e309 }", "must be finite"],
    [
      "interface InputParams { value: Record<string, string> }",
      "only `Array<T>`",
    ],
    [
      "interface InputParams { value: [string, number] }",
      "unsupported TypeScript",
    ],
    ["interface InputParams { method(): string }", "typed property signatures"],
    ["interface InputParams { [key: number]: string }", "string key"],
    [
      "interface InputParams { [key: string]: string; [other: string]: string }",
      "more than one index",
    ],
    [
      "interface InputParams { value: Node } interface Node { root: InputParams }",
      "cannot reference itself",
    ],
    [
      "interface InputParams { value: A } type A = A & {a: string}",
      "recursive intersection",
    ],
    [
      "interface InputParams { value: {a:string} & {a:number} }",
      "incompatible types",
    ],
    ["/** @oneOf */ interface InputParams {}", "can only annotate a union"],
    [
      "interface InputParams { /** @asType integer */ value: string }",
      "only `integer` on `number`",
    ],
    [
      "interface InputParams { /** @minLength */ value: string }",
      "non-negative integer",
    ],
    [
      "interface InputParams { /** @minLength -1 */ value: string }",
      "non-negative integer",
    ],
    [
      "interface InputParams { /** @maxLength 1.5 */ value: string }",
      "non-negative integer",
    ],
    [
      "interface InputParams { /** @minimum */ value: number }",
      "requires a number",
    ],
    [
      "interface InputParams { /** @uniqueItems yes */ value: string[] }",
      "true or false",
    ],
    [
      "interface InputParams { /** @unknown */ value: string }",
      "unsupported JSDoc",
    ],
    [
      "/** @additionalProperties Missing */ interface InputParams {}",
      "unknown schema type",
    ],
    [
      "/** @additionalProperties {bad json} */ interface InputParams {}",
      "invalid `@additionalProperties`",
    ],
    [
      "/** @title A\n * @title B */ interface InputParams {}",
      "appears more than once",
    ],
  ])("rejects invalid schemas: %s", (source, message) => {
    expect(() => compileInputSchema(source)).toThrow(message);
  });

  it.each([
    { type: "object", properties: { value: { type: "unknown" } } },
    { type: "object", properties: { value: { pattern: "[" } } },
    { type: "object", properties: { value: { minLength: -1 } } },
    { type: "object", properties: { value: { $ref: "#/$defs/Missing" } } },
  ])("rejects invalid generated JSON Schema %#", (schema) => {
    expect(() => validateInputSchema(schema)).toThrow(
      "not a valid JSON Schema",
    );
  });
});
