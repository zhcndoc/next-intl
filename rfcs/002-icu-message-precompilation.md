# RFC：ICU 消息的预先编译

开始日期：2025-01-28

## 摘要

本 RFC 提议使用名为 [`icu-minify`](../packages/icu-minify) 的新库，在构建时预编译 ICU 消息，以减小包体积并提升运行时性能。

本文档介绍了这一优化的动机、设计决策和权衡。

**目录：**

- [动机](#motivation)
- [提议的解决方案](#proposed-solution)
- [实现](#implementation)
- [权衡](#tradeoffs)
- [已有方案](#prior-art)

## 动机

目前，`next-intl` 使用 `intl-messageformat` 在运行时解析和格式化 ICU 消息。

这会带来两个缺点：

1. 对服务器端和客户端而言，都会为 bundle 增加约 15KB（压缩 + 压缩编码后的大小）
2. 会影响运行时性能，因为每条消息都必须先解析，然后才能进行格式化

目前已经可以采用一些缓解策略，例如将更多（或全部）消息的使用移至服务器组件。此外，解析结果会被缓存，但初始页面加载时的总阻塞时间仍可能受到影响。

## 提议的解决方案

### 概述

本 RFC 通过一个名为 `icu-minify` 的新库，引入了 ICU 消息的提前编译。

这样就不再需要打包 ICU 解析器，并将编译过程移至构建步骤。借助这一点，我们可以有效减少对性能要求较高的应用的总阻塞时间。

### 中间表示

传统上，虽然提前编译可以减少运行时工作量，但由于 ICU 消息 AST 通常相当庞大，也可能导致包体积增加。

作为替代方案，一些 i18n 库会将消息编译为函数，从而减小包体积。不过，这种方式的问题在于，将函数传递给客户端组件时，函数无法通过 RSC 桥进行序列化。一种解决方法是在需要的地方导入这些函数，但这会破坏按 locale 对消息进行拆分的能力。

相比之下，`icu-minify` 会将消息编译为纯 JSON 中的最小中间表示：

```json
"Hello {name}!"
```

```json
["Hello ", ["name"], "!"]
```

这种方式几乎不会带来额外的体积开销，并且可以由一个仅 650 字节的运行时配套程序进行求值，该程序利用了原生的 `Intl` API。

此外，尽管这种方式可以扩展到包含 `plural`、`select` 等功能的非常复杂的消息，但一个普遍现象是，大多数应用消息往往都是普通字符串。对于这些消息，中间表示完全不会带来任何额外开销（`"Welcome"` → `"Welcome"`）。

### API

对于最终用户而言，`next-intl` 的公共 API 保持不变，而 `icu-minify` 只是一个实现细节。

可以通过一个全局启用的标志来开启此优化：

```tsx
// next.config.ts
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin({
  experimental: {
    messages: {
      path: './messages',
      format: 'json',

      // 启用预编译
      precompile: true
    }
  }
});

export default withNextIntl();
```

启用预编译后，`useTranslations` 和 `useExtracted` 都可以从中受益：

```tsx
// ✅ 可以进行预编译
const t = useTranslations();
t('hello', {name: 'World'});

// ✅ 同样会进行预编译
const t = useExtracted();
t('Hello {name}!', {name: 'World'});
```

（仅限服务端的 API，如 `getTranslations` 和 `getExtracted`，也会得到优化。）

## 实现

### 架构

提前编译借助了此前为 [`useExtracted`](../docs/usage/extraction.md) 实现的基础设施。

它使用 Turbo 或 Webpack 加载器，在应用的构建步骤中编译导入的消息。之后，当 `precompile` 设置为 `true` 时，`next-intl` 会将其基础库 `use-intl` 中的运行时编译器替换为一个调用 `icu-minify` 运行时的替代实现。

```
┌────────────────────────────────────────────────────────────┐
│ Build Time (next-intl plugin)                              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Catalog Loader                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ messages/en.json: {"hello": "Hello {name}!"}         │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                      │
│                     ▼                                      │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ icu-minify/compile                                    │ │
│  │ Compiles ICU → Compact JSON                           │ │
│  └──────────────────┬────────────────────────────────────┘ │
│                     │                                      │
│                     ▼                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Compiled catalog: {"hello": ["Hello ", ["name"]]}    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ Runtime (use-intl)                                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ import formatMessage from 'use-intl/format-message'  │  │
│  │ (aliased to 'use-intl/format-message/format-only')   │  │
│  └──────────────────┬───────────────────────────────────┘  │
│                     │                                      │
│                     ▼                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ icu-minify/format                                    │  │
│  │ Formats precompiled JSON → string/ReactNode          │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 编译格式

编译后的格式使用基于紧凑数组的表示形式，具有以下特点：

- **压缩效果好**：大量使用数组来避免对象属性
- **纯 JSON**：可以无问题地通过 RSC 桥进行序列化
- **遍历速度快**：直接访问，无需解析开销

#### 节点类型

| 节点          | 格式                     | 示例                                        |
| ------------- | ------------------------ | -------------------------------------------- |
| 字符串        | `"text"`                   | `"Hello"`                                      |
| 井号          | `0`                        | `0`（在复数中表示 `#`）                 |
| 简单参数      | `["name"]`                 | `["name"]`                                     |
| 标签          | `["tagName", ...children]` | `["b", "bold"]`                                |
| 选择          | `["name", 1, {options}]`   | `["gender", 1, {male: "He", other: "They"}]`   |
| 复数          | `["name", 2, {options}]`   | `["n", 2, {one: "item", other: "items"}]`      |
| 序数          | `["name", 3, {options}]`   | `["n", 3, {one: [0, "st"], other: [0, "th"]}]` |
| 数字格式      | `["name", 4, style?]`      | `["val", 4, "percent"]`                        |
| 日期格式      | `["name", 5, style?]`      | `["d", 5, "short"]`                            |
| 时间格式      | `["name", 6, style?]`      | `["t", 6, "medium"]`                           |

#### 示例

| 输入                                          | 编译后的输出                                             |
| --------------------------------------------- | ------------------------------------------------------- |
| `"Hello world"`                               | `"Hello world"`                                         |
| `"Hello {name}"`                              | `["Hello ", ["name"]]`                                  |
| `"<b>bold</b>"`                               | `[["b", "bold"]]`                                       |
| `"<b>{name}</b>"`                             | `[["b", ["name"]]]`                                     |
| `"{n, plural, one {# item} other {# items}}"` | `[["n", 2, {one: [0, " item"], other: [0, " items"]}]]` |

## 权衡

### 1. 不支持 `t.raw`

使用预编译消息时，[`t.raw`](https://next-intl.dev/docs/usage/translations#raw-messages) API 将无法正常工作。当你尝试将 ICU 消息以外的任何内容放入本地化目录时，会遇到解析错误；如果你对预编译消息调用 `t.raw`，则只会收到中间表示，而不是原始消息。这是因为消息必须先经过解析，我们才能知道你是否打算对其调用 `t.raw`。

历史上，添加 `t.raw` 是为了支持消息中的原始 HTML 内容。然而，实践证明，对于长篇内容而言，这种方式仍然很繁琐，而且还有更好的替代方案：

1. **本地内容使用 MDX**：对于版权声明页面等内容，将本地化内容分别整理到 `content.en.mdx` 和 `content.es.mdx` 等文件中，会更易于管理。
2. **远程内容使用 CMS**：内容管理系统通常会提供一种可移植的格式，以一种与 HTML 无关的方式表达富文本，从而也能让你在移动应用等场景中复用相同的内容（例如参见 [Sanity 的 Portable Text](https://www.sanity.io/docs/developer-guides/presenting-block-text)）。

过去 `t.raw` 的另一个常见（滥用）场景，是用于处理消息数组。对此，推荐的模式一直是为每个字符串使用单独的消息，详见文档中的[消息数组](https://next-intl.dev/docs/usage/translations#arrays-of-messages)。此外，这种模式还具备[可进行静态分析](https://next-intl.dev/docs/workflows/messages)的优点。

与此相关，最近推出的 [`useExtracted`](./001-message-extraction.md) API 同样不支持 `t.raw`，因为它本身就不符合这一范式。

因此，如果你希望从提前编译中受益，建议迁移到上述替代方案之一。如果你大量使用 `t.raw`，当然也可以暂时选择关闭此优化。

未来的某个版本中，`t.raw` 可能会被弃用——目前仍在讨论中。

### 2. 远程消息的编译

对于运行时从远程来源加载的消息，无法自动使用预编译。

当消息动态加载时（例如来自 TMS、CMS、API 或 CDN），目录加载器无法在构建过程中对其进行预编译。不过，你可以在获取远程消息后，使用 `i18n/request.ts` 文件中的 `icu-minify/compile` 手动编译，然后将结果作为 `messages` 返回。

## 既有方案

预先编译深受 [Jan Nicklas](https://x.com/jantimon) 的 [`icu-to-json`](https://github.com/jantimon/icu-to-json) 启发。后来我还发现了 [`@lingui/message-utils`](https://github.com/lingui/js-lingui/tree/main/packages/message-utils)，这是另一个探索过这种方法的库。

### 对比

| 方面         | icu-minify                         | icu-to-json                        | Lingui                   |
| ------------ | ---------------------------------- | ---------------------------------- | ------------------------ |
| 解析器       | @formatjs/icu-messageformat-parser | @formatjs/icu-messageformat-parser | @messageformat/parser    |
| 简单参数     | `["name"]`                         | `["name"]`                         | `["name"]`               |
| 数字格式     | `["n", 4]`                         | `["n", 4, "number"]`               | `["n", "number"]`        |
| 日期格式     | `["d", 5]`                         | `["d", 4, "date"]`                 | `["d", "date"]`          |
| 复数         | `["n", 2, {...}]`                  | `["n", 2, {...}]`                  | `["n", "plural", {...}]` |
| 选择         | `["g", 1, {...}]`                  | `["g", 1, {...}]`                  | `["g", "select", {...}]` |
| 井号         | `0`                                | `0`                                | `"#"`                    |
| 标签         | `["b", child1, ...]`               | `["b", 5, child1, ...]`            | 不支持                   |
| 复数偏移量   | 不支持                             | 支持                               | 支持                     |

### `icu-minify` 中的设计选择

- **数字类型常量**：比使用字符串类型标识符更加紧凑（例如，`2` 比 `"plural"` 更紧凑）
- **为格式使用不同的类型常量（4/5/6）**：由于子类型已编码在常量本身中，因此比例如 `[name, 4, "number"]` 更加紧凑
- **标签不使用类型常量**：通过 `typeof node[1] !== 'number'` 检测标签，以节省每个标签所占用的字节
- **不支持复数偏移量**：简化运行时，并且在实践中很少需要
- **零运行时依赖**：使用原生 `Intl` API
