![Brainary TUI running the PoA template](assets/poa-tui-demo.png)

# Brainary PoA 模板

这是一套独立的 Brainary PoA 开发模板，默认使用 TypeScript，也支持将 `src/main.ts` 替换为
`src/main.js` 后使用 JavaScript 开发。模板提供安装依赖、代码检查、测试、构建和打包命令，
可生成 JavaScript 入口文件和 `.poa` 包。构建和打包不依赖 Brainary 二进制，生成的包交给 Brainary 加载执行。

## 环境要求

- Node.js 22 或更新版本（推荐使用最新 LTS 版本）
- pnpm 12

部分工具链依赖声明的 Node.js 支持范围更窄。开启严格版本检查时，需要使用 Node.js 22.x 中的
22.12 或更新版本、24.x，或 26 及以上版本。

## 使用流程

```bash
pnpm install
pnpm test
pnpm package
```

`pnpm package` 会构建 `src/main.ts`，将可选的 `input_schema.ts` 转换为 `input_schema.json`，
校验 `manifest.toml`，收集输入 Schema 和 `mcp/` 文件，最终生成 `dist/my-poa.poa`。
默认示例接受一个可选的 `message` 字段；不传入时，返回默认问候语。

`input_schema.ts` 必须通过接口（`interface`）或类型别名（`type`）声明 `InputParams`。
它用于描述输入结构，只支持约定的 TypeScript 类型语法，不会作为业务代码执行；
不支持导入、函数、自定义泛型和接口继承。支持的注解包括 `@minLength`、`@minimum` 和 `@oneOf`。
打包脚本会先校验转换后的 JSON Schema，再生成 `.poa` 包。

如果 `input_schema.ts` 和 `input_schema.json` 同时存在，优先使用 TypeScript 文件；
也支持仅提供手写 JSON Schema。生成的 JSON 和补充了 Schema 路径的 manifest 只写入包内，不会修改源码文件。

`manifest.toml` 使用当前 PoA 约定：

```toml
runtime = "codex-v8"
poa_api_version = 1
entry = "main.js"
```

PoA 的业务身份和版本（`namespace`、`name`、`version`）由开发者维护。
Runtime 和 API 版本由模板固定，打包脚本负责校验。

## 目录结构

```text
src/main.ts                       PoA 总入口
input_schema.ts                   可选的 TypeScript 输入 Schema，打包时转换为 JSON
agents/                           Agent 实现
prompts/                          提示词资源
memory/                           预留的记忆和状态适配目录
tools/                            工具调用适配
mcp/                              可选的 stdio MCP 文件，打包时放入 .poa
tests/                            Vitest 测试
types/runtime.d.ts                Brainary Runtime 类型声明
scripts/compile-input-schema.mjs  TypeScript Schema 转 JSON Schema
scripts/package.mjs               使用 fflate 生成 .poa 包
dist/                             构建和打包产物
```

`mcp/` 目录可按需使用。项目需要 MCP 服务时，可以使用 MCP SDK 编写服务，
并在 `manifest.toml` 中声明启动命令。第一期支持 `stdio` MCP 服务。

## 常用命令

```bash
pnpm lint       # 使用 Biome 检查代码
pnpm format     # 使用 Biome 格式化代码
pnpm typecheck  # 使用 TypeScript 检查类型
pnpm test       # 使用 Vitest 运行测试
pnpm build      # 构建生成 dist/main.js
pnpm package    # 构建并打包生成 dist/my-poa.poa
```
