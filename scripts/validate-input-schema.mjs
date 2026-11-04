import Ajv from "ajv";
import Ajv2019 from "ajv/dist/2019.js";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export function validateInputSchema(schema) {
  if (!schema || typeof schema !== "object" || schema.type !== "object") {
    throw new Error(
      'input schema must declare an object schema with "type": "object"',
    );
  }
  try {
    const draft =
      schema.$schema ?? "https://json-schema.org/draft/2020-12/schema";
    const Compiler = draft.includes("2020-12")
      ? Ajv2020
      : draft.includes("2019-09")
        ? Ajv2019
        : Ajv;
    const ajv = new Compiler({ strict: false, allErrors: true });
    addFormats(ajv);
    return ajv.compile(schema);
  } catch (error) {
    throw new Error(
      `input schema is not a valid JSON Schema: ${error.message}`,
    );
  }
}
