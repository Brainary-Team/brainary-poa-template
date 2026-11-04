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

运行 `pnpm package` 后，模板会：

1. 把 `src/main.ts`（或 `src/main.js`）构建成 `dist/main.js`。
2. 如果有 `input_schema.ts`，把其中定义的输入参数转换成 `input_schema.json`。
3. 检查 `manifest.toml` 和输入参数的格式定义，有问题就报错。
4. 把入口文件、配置文件、输入参数定义以及 `mcp/` 下的文件（如果有）打成一个包，保存为 `dist/my-poa.poa`。

## 输入参数怎么写

在项目根目录的 `input_schema.ts` 中，用名为 `InputParams` 的 `interface` 或 `type` 定义 PoA 可以接收哪些参数。例如：

```ts
export interface InputParams {
  message?: string;
}
```

这表示 `message` 是一个字符串，`?` 表示可以不传。模板自带的示例会返回你传入的消息，不传时返回默认问候语。

打包脚本只读取类型声明来生成 JSON，不会执行这个文件里的代码。
目前不支持 `import`、函数、自定义泛型或 `interface extends`。
可以通过 `@minLength`、`@minimum`、`@oneOf` 等注解补充输入限制，例如字符串的最短长度。

如果想直接写 JSON，也可以删除 `input_schema.ts`，改用 `input_schema.json`。
两个文件同时存在时，打包脚本使用 TS 文件，忽略 JSON 文件。

生成的 JSON 会直接放进 `.poa` 包，包内的 `manifest.toml` 也会自动加上
`input_schema = "input_schema.json"`。项目中的源码文件不会被改写。

## 项目配置怎么改

在 `manifest.toml` 中，按自己的项目填写 `namespace`、`name` 和 `version`。

下面三项分别指定 Brainary 运行时、PoA API 版本和包内入口文件，保持模板的默认值即可：

```toml
runtime = "codex-v8"
poa_api_version = 1
entry = "main.js"
```

打包时会检查这三项是否与模板要求一致。

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
