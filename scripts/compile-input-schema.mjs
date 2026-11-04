import ts from "typescript";

const SOURCE_NAME = "input_schema.ts";
const ROOT_NAME = "InputParams";

export function compileInputSchema(source, fileName = SOURCE_NAME) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  if (sourceFile.parseDiagnostics.length > 0) {
    throw schemaError(fileName, sourceFile.parseDiagnostics[0]);
  }

  const declarations = new Map();
  for (const statement of sourceFile.statements) {
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      const name = statement.name.text;
      if (declarations.has(name)) {
        failAt(
          fileName,
          statement,
          `type \`${name}\` is declared more than once`,
        );
      }
      if (statement.typeParameters) {
        failAt(
          fileName,
          statement,
          "generic type declarations are not supported",
        );
      }
      declarations.set(name, statement);
      continue;
    }

    if (!ts.isEmptyStatement(statement)) {
      failAt(
        fileName,
        statement,
        "only interface and type declarations are allowed",
      );
    }
  }

  const root = declarations.get(ROOT_NAME);
  if (!root) {
    throw new Error(
      `PoA input schema validation failed: ${fileName} must declare an interface or type named \`${ROOT_NAME}\``,
    );
  }

  const compiler = new SchemaCompiler(sourceFile, declarations, fileName);
  const schema = compiler.declarationSchema(ROOT_NAME, root);
  if (schema.type !== "object") {
    failAt(fileName, root, `\`${ROOT_NAME}\` must resolve to an object schema`);
  }
  for (const name of compiler.reachable) {
    if (name === ROOT_NAME) {
      failAt(fileName, root, `\`${ROOT_NAME}\` cannot reference itself`);
    }
    if (compiler.definitions[name]) continue;
    const declaration = declarations.get(name);
    if (!declaration) {
      failAt(
        fileName,
        root,
        `referenced type \`${name}\` is not declared in ${SOURCE_NAME}`,
      );
    }
    compiler.declarationSchema(name, declaration);
  }
  schema.$schema =
    schema.$schema ?? "https://json-schema.org/draft/2020-12/schema";
  if (Object.keys(compiler.definitions).length > 0) {
    schema.$defs = compiler.definitions;
  }
  return schema;
}

class SchemaCompiler {
  constructor(sourceFile, declarations, fileName) {
    this.sourceFile = sourceFile;
    this.declarations = declarations;
    this.fileName = fileName;
    this.reachable = new Set();
    this.definitions = Object.create(null);
    this.resolvingIntersections = new Set();
  }

  declarationSchema(name, declaration) {
    if (name !== ROOT_NAME && this.definitions[name]) {
      return this.definitions[name];
    }
    if (
      ts.isInterfaceDeclaration(declaration) &&
      declaration.heritageClauses?.length
    ) {
      failAt(
        this.fileName,
        declaration,
        "interface extends is not supported; use an intersection type",
      );
    }
    const schema = ts.isInterfaceDeclaration(declaration)
      ? this.objectSchema(declaration.members, declaration)
      : this.typeSchema(declaration.type, declaration);
    if (ts.isTypeAliasDeclaration(declaration)) {
      applyDocumentation(
        schema,
        declaration,
        this.fileName,
        this,
        declaration.type,
      );
    }

    if (name !== ROOT_NAME) {
      this.definitions[name] = schema;
    }
    return schema;
  }

  typeSchema(node, owner) {
    if (ts.isParenthesizedTypeNode(node))
      return this.typeSchema(node.type, owner);
    if (node.kind === ts.SyntaxKind.StringKeyword) return { type: "string" };
    if (node.kind === ts.SyntaxKind.NumberKeyword) return { type: "number" };
    if (node.kind === ts.SyntaxKind.BooleanKeyword) return { type: "boolean" };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { type: "null" };
    if (
      ts.isLiteralTypeNode(node) &&
      node.literal.kind === ts.SyntaxKind.NullKeyword
    ) {
      return { type: "null" };
    }
    if (ts.isLiteralTypeNode(node))
      return literalSchema(node.literal, this.sourceFile);
    if (ts.isArrayTypeNode(node)) {
      return { type: "array", items: this.typeSchema(node.elementType, owner) };
    }
    if (ts.isTypeLiteralNode(node))
      return this.objectSchema(node.members, node);
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(this.sourceFile);
      if (name === "Array" && node.typeArguments?.length === 1) {
        return {
          type: "array",
          items: this.typeSchema(node.typeArguments[0], owner),
        };
      }
      if (node.typeArguments?.length) {
        failAt(this.fileName, node, "only `Array<T>` is supported");
      }
      if (!this.declarations.has(name)) {
        failAt(this.fileName, node, `unknown schema type \`${name}\``);
      }
      this.reachable.add(name);
      return { $ref: `#/$defs/${name}` };
    }
    if (ts.isUnionTypeNode(node)) {
      const types = node.types.map((child) => this.typeSchema(child, owner));
      const literals = node.types.map((child) =>
        literalValue(child, this.sourceFile),
      );
      if (literals.every((value) => value !== undefined)) {
        return enumSchema(literals);
      }
      return { anyOf: types };
    }
    if (ts.isIntersectionTypeNode(node)) {
      const schemas = node.types.map((child) =>
        this.intersectionOperand(child, owner),
      );
      const types = schemas.map(schemaType);
      const firstType = types[0];
      if (types.some((type) => type !== firstType)) {
        failAt(
          this.fileName,
          node,
          "intersection contains incompatible schema types",
        );
      }
      if (firstType === "object") {
        return mergeObjectSchemas(schemas, this.fileName, node);
      }
      return allOfSchema(schemas);
    }
    failAt(
      this.fileName,
      node,
      `unsupported TypeScript schema construct ${ts.SyntaxKind[node.kind]}`,
    );
  }

  intersectionOperand(node, owner) {
    if (ts.isParenthesizedTypeNode(node)) {
      return this.intersectionOperand(node.type, owner);
    }
    if (!ts.isTypeReferenceNode(node)) {
      return this.typeSchema(node, owner);
    }
    const name = node.typeName.getText(this.sourceFile);
    if (node.typeArguments?.length) return this.typeSchema(node, owner);
    const declaration = this.declarations.get(name);
    if (!declaration) {
      failAt(this.fileName, node, `unknown schema type \`${name}\``);
    }
    if (name === ROOT_NAME || this.resolvingIntersections.has(name)) {
      failAt(
        this.fileName,
        node,
        `recursive intersection through \`${name}\` is not supported`,
      );
    }
    this.reachable.add(name);
    this.resolvingIntersections.add(name);
    try {
      return this.declarationSchema(name, declaration);
    } finally {
      this.resolvingIntersections.delete(name);
    }
  }

  objectSchema(members, owner) {
    const properties = Object.create(null);
    const required = [];
    let additionalProperties = false;
    let hasIndexSignature = false;

    for (const member of members) {
      if (ts.isIndexSignatureDeclaration(member)) {
        if (hasIndexSignature) {
          failAt(
            this.fileName,
            member,
            "object schema has more than one index signature",
          );
        }
        hasIndexSignature = true;
        if (member.parameters.length !== 1) {
          failAt(
            this.fileName,
            member,
            "schema index signatures must have one parameter",
          );
        }
        const parameter = member.parameters[0];
        if (
          !parameter.type ||
          parameter.type.kind !== ts.SyntaxKind.StringKeyword
        ) {
          failAt(
            this.fileName,
            member,
            "schema index signatures must use a string key",
          );
        }
        if (!member.type) {
          failAt(
            this.fileName,
            member,
            "schema index signatures must declare a value type",
          );
        }
        additionalProperties = this.typeSchema(member.type, member);
        continue;
      }
      if (!ts.isPropertySignature(member) || !member.name || !member.type) {
        failAt(
          this.fileName,
          member,
          "object schemas may contain only typed property signatures",
        );
      }
      const name = propertyName(member.name, this.sourceFile);
      if (Object.hasOwn(properties, name)) {
        failAt(
          this.fileName,
          member,
          `property \`${name}\` is declared more than once`,
        );
      }
      const property = this.typeSchema(member.type, member);
      applyDocumentation(property, member, this.fileName, this, member.type);
      properties[name] = property;
      if (!member.questionToken) required.push(name);
    }

    const schema = {
      type: "object",
      properties,
      additionalProperties,
    };
    if (required.length > 0) schema.required = required;
    applyDocumentation(schema, owner, this.fileName, this, owner);
    return schema;
  }
}

function applyDocumentation(
  schema,
  node,
  fileName,
  compiler,
  annotationTarget,
) {
  // Read the leading comment directly: TypeScript omits same-line JSDoc from
  // getJSDocTags, while the PoA schema contract accepts it on object members.
  const source = node.getSourceFile().text;
  const comments = [
    ...(ts.getLeadingCommentRanges(source, node.pos) ?? []),
    ...(ts.getTrailingCommentRanges(source, node.pos) ?? []),
  ]
    .filter((comment) => comment.end <= node.getStart())
    .sort((a, b) => a.pos - b.pos);
  const last = comments.at(-1);
  if (!last) return;
  const comment = source.slice(last.pos, last.end);
  if (!comment.startsWith("/**")) return;
  const description = [];
  const tags = new Map();
  let inTags = false;
  for (const line of comment.slice(3, -2).split(/\r?\n/)) {
    const text = line
      .trim()
      .replace(/^\*\s?/, "")
      .trim();
    if (text.startsWith("@")) {
      inTags = true;
      const match = /^@(\S+)\s*(.*)$/.exec(text);
      if (!match) failAt(fileName, node, "JSDoc tag requires a name");
      const [, name, raw] = match;
      if (tags.has(name)) {
        failAt(fileName, node, `JSDoc tag \`@${name}\` appears more than once`);
      }
      tags.set(name, raw.trim());
    } else if (text && !inTags) {
      description.push(text);
    }
  }
  if (description.length) schema.description = description.join("\n");

  for (const [name, raw] of tags) {
    const tag = node;
    if (name === "schema") {
      schema.$schema = requiredStringTag(name, raw, fileName, tag);
    } else if (
      ["title", "format", "contentEncoding", "pattern"].includes(name)
    ) {
      schema[name] = requiredStringTag(name, raw, fileName, tag);
    } else if (
      ["minLength", "maxLength", "minItems", "maxItems"].includes(name)
    ) {
      schema[name] = unsignedTag(name, raw, fileName, tag);
    } else if (
      [
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
      ].includes(name)
    ) {
      schema[name] = numberTag(name, raw, fileName, tag);
    } else if (name === "uniqueItems") {
      schema.uniqueItems =
        raw === "" ? true : booleanTag(name, raw, fileName, tag);
    } else if (name === "asType") {
      if (raw !== "integer" || schema.type !== "number") {
        failAt(fileName, tag, "`@asType` supports only `integer` on `number`");
      }
      schema.type = "integer";
    } else if (name === "oneOf") {
      if (!ts.isUnionTypeNode(annotationTarget) || raw !== "") {
        failAt(fileName, tag, "`@oneOf` can only annotate a union type");
      }
      if (schema.anyOf) {
        schema.oneOf = schema.anyOf;
        delete schema.anyOf;
      } else if (schema.enum) {
        schema.oneOf = schema.enum.map(literalSchemaFromValue);
        delete schema.enum;
      }
    } else if (name === "additionalProperties") {
      if (schema.type !== "object") {
        failAt(
          fileName,
          tag,
          "`@additionalProperties` requires an object type",
        );
      }
      schema.additionalProperties = additionalPropertiesValue(
        raw,
        fileName,
        tag,
        compiler,
      );
    } else {
      failAt(fileName, tag, `unsupported JSDoc tag \`@${name}\``);
    }
  }
}

function additionalPropertiesValue(raw, fileName, node, compiler) {
  if (raw === "true" || raw === "false") return raw === "true";
  if (raw.startsWith("{")) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      failAt(
        fileName,
        node,
        `invalid \`@additionalProperties\` JSON Schema: ${error.message}`,
      );
    }
  }
  if (!raw || !compiler.declarations.has(raw)) {
    failAt(
      fileName,
      node,
      `\`@additionalProperties\` references unknown schema type \`${raw}\``,
    );
  }
  compiler.reachable.add(raw);
  return { $ref: `#/$defs/${raw}` };
}

function literalValue(node, sourceFile) {
  if (ts.isParenthesizedTypeNode(node))
    return literalValue(node.type, sourceFile);
  if (ts.isLiteralTypeNode(node)) return literalValue(node.literal, sourceFile);
  if (
    ts.isPrefixUnaryExpression(node) &&
    ts.isNumericLiteral(node.operand) &&
    node.operator === ts.SyntaxKind.MinusToken
  ) {
    return -literalValue(node.operand, sourceFile);
  }
  const value = ts.isStringLiteral(node)
    ? node.text
    : ts.isNumericLiteral(node)
      ? Number(node.text)
      : node.kind === ts.SyntaxKind.TrueKeyword
        ? true
        : node.kind === ts.SyntaxKind.FalseKeyword
          ? false
          : node.kind === ts.SyntaxKind.NullKeyword
            ? null
            : undefined;
  if (typeof value === "number" && !Number.isFinite(value)) {
    failAt(sourceFile.fileName, node, "numeric literals must be finite");
  }
  return value;
}

function literalSchema(node, sourceFile) {
  const value = literalValue(node, sourceFile);
  if (value === undefined) {
    throw new Error(
      `PoA input schema validation failed: unsupported literal ${node.getText(sourceFile)}`,
    );
  }
  const type = value === null ? "null" : typeof value;
  return { type, const: value };
}

function enumSchema(values) {
  const unique = [...new Set(values)];
  const types = new Set(
    unique.map((value) => (value === null ? "null" : typeof value)),
  );
  const schema = { enum: unique };
  if (types.size === 1) schema.type = [...types][0];
  return schema;
}

function literalSchemaFromValue(value) {
  const type = value === null ? "null" : typeof value;
  return { type, const: value };
}

function schemaType(schema) {
  if (schema.type === "integer") return "number";
  if (
    ["null", "boolean", "number", "string", "array", "object"].includes(
      schema.type,
    )
  ) {
    return schema.type;
  }
  if (Array.isArray(schema.allOf)) {
    const types = schema.allOf.map(schemaType);
    const firstType = types[0];
    if (firstType !== undefined && types.every((type) => type === firstType)) {
      return firstType;
    }
  }
  return undefined;
}

function allOfSchema(schemas) {
  const flattened = [];
  for (const schema of schemas) {
    if (Object.keys(schema).length === 1 && Array.isArray(schema.allOf)) {
      flattened.push(...schema.allOf);
    } else {
      flattened.push(schema);
    }
  }
  return { allOf: flattened };
}

function mergeObjectSchemas(schemas, fileName, node) {
  const merged = {
    ...schemas[0],
    type: "object",
    properties: Object.create(null),
    additionalProperties: true,
  };
  const required = new Set();
  for (const schema of schemas) {
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      if (
        Object.hasOwn(merged.properties, name) &&
        JSON.stringify(merged.properties[name]) !== JSON.stringify(property)
      ) {
        const leftType = schemaType(merged.properties[name]);
        const rightType = schemaType(property);
        if (leftType !== rightType) {
          failAt(
            fileName,
            node,
            "intersection defines a property with incompatible types",
          );
        }
        merged.properties[name] = allOfSchema([
          merged.properties[name],
          property,
        ]);
      } else {
        merged.properties[name] = property;
      }
    }
    for (const name of schema.required ?? []) required.add(name);
    const left = merged.additionalProperties;
    const right = schema.additionalProperties ?? false;
    merged.additionalProperties =
      left === false || right === false
        ? false
        : left === true
          ? right
          : right === true
            ? left
            : allOfSchema([left, right]);
  }
  if (required.size > 0) merged.required = [...required];
  return merged;
}

function propertyName(node, sourceFile) {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node)
  ) {
    return node.text;
  }
  throw new Error(
    `PoA input schema validation failed: unsupported property name ${node.getText(sourceFile)}`,
  );
}

function requiredStringTag(name, raw, fileName, node) {
  if (!raw) failAt(fileName, node, `@${name} requires a value`);
  return raw;
}

function unsignedTag(name, raw, fileName, node) {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value))
    failAt(fileName, node, `@${name} requires a non-negative integer`);
  return value;
}

function numberTag(name, raw, fileName, node) {
  const value = Number(raw);
  if (
    !/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) ||
    !Number.isFinite(value)
  )
    failAt(fileName, node, `@${name} requires a number`);
  return value;
}

function booleanTag(name, raw, fileName, node) {
  if (raw !== "true" && raw !== "false")
    failAt(fileName, node, `@${name} requires true or false`);
  return raw === "true";
}

function schemaError(fileName, diagnostic) {
  return new Error(
    `PoA input schema validation failed: ${fileName}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
  );
}

function failAt(fileName, node, message) {
  const position = node
    .getSourceFile()
    .getLineAndCharacterOfPosition(node.getStart());
  throw new Error(
    `PoA input schema validation failed: ${fileName}:${position.line + 1}:${position.character + 1}: ${message}`,
  );
}
