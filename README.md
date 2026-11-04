![Brainary TUI running the PoA template](assets/poa-tui-demo.png)

# Brainary PoA Template

This repository is a TypeScript-first starter for Brainary PoA projects. It also accepts a
JavaScript entry point when `src/main.ts` is replaced with `src/main.js`. It produces a JavaScript
entry point and a `.poa` package without requiring the Brainary binary during development.

## Requirements

- Node.js 22 or newer (latest LTS recommended)
- pnpm 12

Some toolchain dependencies declare a narrower Node.js range. Strict engine checks require
Node.js 22.12+ (22.x), 24.x, or 26+.

## Workflow

```bash
pnpm install
pnpm test
pnpm package
```

`pnpm package` builds `src/main.ts`, converts the optional `input_schema.ts` into
`input_schema.json`, validates `manifest.toml`, collects the generated schema and `mcp/` files, and
writes `dist/my-poa.poa`. The starter schema accepts an optional `message`; when it is omitted, the
example returns its default greeting.

The schema file must declare `InputParams` using interfaces or type aliases. It is a declarative
TypeScript subset, not executable application code: imports, functions, generics, and interface
inheritance are rejected. Supported annotations include `@minLength`, `@minimum`, and `@oneOf`.
Packaging validates the resulting JSON Schema before writing the archive. If both schema files
exist, TypeScript takes precedence; JSON-only projects remain supported. Generated JSON and the
updated manifest are written into the archive without modifying source files.

The package manifest uses the current PoA contract:

```toml
runtime = "codex-v8"
poa_api_version = 1
entry = "main.js"
```

The PoA identity (`namespace`, `name`, and `version`) belongs to the project author. Runtime and
API version values are fixed by the template and checked by the packaging script.

## Project layout

```text
src/main.ts           PoA entry point
input_schema.ts       optional TypeScript input schema; compiled during packaging
agents/               agent implementations
prompts/              prompt resources
memory/               reserved runtime memory adapter directory
tools/                tool adapters
mcp/                  optional stdio MCP files shipped in the package
tests/                Vitest tests
types/runtime.d.ts    Brainary Runtime API declarations
scripts/compile-input-schema.mjs  TypeScript Schema to JSON Schema compiler
scripts/package.mjs   fflate-based .poa packager
dist/                 generated build and package output
```

The `mcp/` directory is optional. If a project needs an MCP server, add the server using the MCP
SDK and declare its command in `manifest.toml`. The first version supports `stdio` MCP servers.

## Commands

```bash
pnpm lint       # Biome checks
pnpm format     # Biome formatting
pnpm typecheck  # TypeScript checks
pnpm test       # Vitest
pnpm build      # dist/main.js
pnpm package    # dist/my-poa.poa
```
