# RFC：消息提取

开始日期：2025-09-24

## 摘要

本 RFC 提议一种以内联方式定义消息的新方法，无需管理键。

```tsx
import {useExtracted} from 'next-intl';

function InlineMessages() {
  const t = useExtracted();
  return <h1>{t('Look ma, no keys!')}</h1>;
}
```

本文档包含大量关于 API 设计的背景信息和思考，旨在面向有兴趣提供反馈的早期采用者。对于最终用户而言，我们的目标是让他们无需阅读太多解释即可开始使用，因此如果你只是对未来使用此 API 感兴趣，不必强行深入了解这些内容。

→ [**讨论**](https://github.com/amannn/next-intl/discussions/2036)

**目录：**

- [动机](#motivation)
- [提议的 API](#proposed-api)
  - [简单的纯字符串](#simple-plain-strings)
  - [可静态分析](#statically-analyzable)
  - [ICU 功能](#icu-features)
  - [提供更多上下文](#provide-more-context)
  - [显式 ID](#explicit-ids)
  - [可选命名空间](#optional-namespace)
  - [开发者工作流](#developer-workflow)
- [实现细节](#implementation-details)
  - [文件格式与 AI 翻译](#file-formats--ai-translation)
  - [生成最小化键](#generating-minified-keys)
  - [目录生成](#catalog-generation)
  - [打包器集成](#bundler-integration)
- [迁移](#migration)
- [权衡](#tradeoffs)
- [考虑过的替代方案](#considered-alternatives)
  - [直接拼接参数](#direct-concatenation-of-arguments)
  - [支持将人类可读字符串作为键](#supporting-human-readable-strings-as-keys)
  - [用于定义消息的宏](#macro-for-defining-messages)
- [先例与致谢](#prior-art--credits)

## 动机

这份 RFC 源于这样一个问题：“i18n 的 Tailwind 会是什么样的？”

如果我们考虑 Tailwind 的设计理念，可以看出，一个遵循相同原则的 i18n 解决方案可能会是这样的：

1. **就地共置**：类似于 Tailwind 避免了管理独立样式表的需要，在添加、更新或删除消息时，也不应该需要手动管理 JSON 消息目录。不过，消息目录仍然可以作为编译目标。
2. **AI 优先**：得益于本地推理和较小的上下文窗口，生成式 AI 非常擅长使用 Tailwind。如果必须读取完整的消息目录，就会导致上下文污染，因此这应该不是必要条件（至少不应在没有工具调用的情况下成为必要条件）。
3. **无需为事物命名**：不必想出各种名称能够极大提升生产力，因此应尽可能避免手动设置键名。
4. **清除无用内容**：类似于 Tailwind 可以清除未使用的样式，我们也应该自动清除未使用的消息。与此相关的是，发生变更的消息可能需要被失效处理。
5. **压缩**：Tailwind 的类名占用的资源极少，消息也应使用经过压缩的键（例如 `uxV9Xq`）。
6. **适合原型开发，同时满足生产需求**：无论 Tailwind 用于快速原型还是生产应用，其表现都完全一致。同样地，应该提供一套统一的 API，避免根据项目的规模和复杂程度预先做出结构性决策。
7. **渐进式采用**：Tailwind 可以与传统样式表并用，因此便于迁移。同样，也应该能够将内联消息与现有翻译结合使用。
8. **便于重构**：使用 Tailwind 时，在组件之间移动代码非常顺畅；内联消息也应该支持这一点。

虽然 `next-intl` 已经回答了其中一些问题，但归根结底，目前仍有一些潜力尚未被充分挖掘。因此，本 RFC 旨在引入一个新的 API，以改善使用 `next-intl` 时的开发者体验。

**重要提示：** 这个新 API 完全是增量式的。所有现有功能都将继续正常工作，并且很可能也会在幕后被这个新 API 使用。

## 提议的 API

### 简单的纯字符串

对于最简单的情况，API 如下所示：

```tsx
import {useExtracted} from 'next-intl';

function InlineMessages() {
  const t = useExtracted();
  return <h1>{t('Look ma, no keys!')}</h1>;
}
```

**注意：**

1. 不需要命名空间或键。
2. 从 Hook 中获取 `t`，可以让我们继续从 React Context（客户端组件）或 `i18n/request.ts`（服务端组件）访问消息。
3. 无需更新键，即可将 `t` 的调用移至另一个组件。唯一的要求是其中存在对 `useExtracted` 的调用。
4. 服务端组件、服务端操作以及其他仅限服务端的代码可以使用该 Hook 的可等待版本，例如 `const t = await getExtracted()`。
5. 不允许使用 `t(keyName)` 这样的动态调用，并且会打印错误（相关内容：[可静态分析](#statically-analyzable)）。
6. 不再需要 [i18n Ally](https://next-intl.dev/docs/workflows/vscode-integration) 等 IDE 工具。
7. 如果同一个标签在多个地方使用，它会被自动复用（相关内容：[显式 ID](#explicit-ids)）。
8. 此 API 不支持 `t.raw`。

### 可静态分析

由于提取器需要能够静态分析代码，因此用户不能使用动态调用：

```tsx
// ❌ 将打印错误
t(keyName);
```

例如，对于项目数组，建议使用以下模式：

```tsx
const items = [
  {
    title: t('Years of service'),
    value: 34
  },
  {
    title: t('Happy clients'),
    value: 1000
  }
];
```

除了消息提取之外，未来还可能会将消息的静态分析用于[摇树优化](https://github.com/amannn/next-intl/issues/1)，因此这一限制的重要性不仅限于本 RFC 的范围。

### ICU 功能

对于参数插值等 ICU 功能，可以在行内定义 ICU 字符串，并使用值对其进行丰富。

**参数插值**

```tsx
t('Hello, {name}!', {name: 'John'});
```

**基数复数**

```tsx
t(
  'You have {count, plural, =0 {no followers yet} =1 {one follower} other {# followers}}.',
  {count: 3580}
);
```

**序数复数**

```tsx
t(
  "It's your {year, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} birthday!",
  {year: 22}
);
```

**选择值**

```tsx
t('{gender, select, female {She is} male {He is} other {They are}} online.', {
  gender: 'female'
});
```

**富文本**

```tsx
t.rich('Please refer to the <link>guidelines</link>.', {
  link: (chunks) => <Link href="/guidelines">{chunks}</Link>
});
```

请注意，我们可以利用最近引入的[严格类型化 ICU 参数](https://next-intl.dev/blog/next-intl-4-0#strictly-typed-icu-arguments)，来验证以下方面：

1. 是否提供了正确的值？
2. 传递此类值时，是否使用了 `number` 和 `date` 格式化器？

行内 API 的另一个好处是，我们不再受 [TypeScript#32063](https://github.com/microsoft/TypeScript/issues/32063) 的限制。

相关内容：[参数的直接拼接](#direct-concatenation-of-arguments)

### 提供更多上下文

如果开发者希望明确消息的意图，可以通过传递对象来提供额外上下文：

```tsx
t({
  message: 'Right',
  description: 'Advance to the next slide'
});
```

相关内容：[文件格式与 AI 翻译](#file-formats--ai-translation)

### 显式 ID

用户可以选择显式设置一个键：

```tsx
const t = useExtracted();
t({
  id: 'carousel.next',
  message: 'Right'
});
```

一种使用场景是：某个标签在多个地方使用，但在其他语言中应当拥有不同的翻译。这是一种逃生口，通常很少有必要使用。

### 可选命名空间

用户可以提供一个可选的命名空间：

```tsx
function Modal() {
  const t = useExtracted('design-system');
  t('Close');
}
```

……将生成例如以下内容：

```json
{
  "design-system": {
    "5VpL9Z": "Close"
  }
}
```

这对于以下情况很有用：

1. **库**：例如，如果你有一个包含多个包的 monorepo，可能希望将多个包中的消息合并到一个运行时使用的目录中。这可以确保不同包之间的重复键不会被合并。
2. **拆分**：虽然 [`next-intl#1`](https://github.com/amannn/next-intl/issues/1) 是自动拆分消息的最终目标，但目前用户可能希望通过命名空间手动拆分消息。

### 开发者工作流

从开发者的角度来看，工作流如下：

1. 使用 Next.js 插件配置 `next-intl`
2. 运行开发服务器
3. 使用行内消息编写代码
4. 所有目录都会持续更新（相关内容：[目录生成](#catalog-generation)）
5. 提交一个功能
6. 可选：使用 AI 或手动翻译新消息或发生变化的消息

## 实现细节

### 文件格式与 AI 翻译

由于键将自动生成且不具描述性，因此消息提取需要一种能够描述上下文的等价形式，例如消息的使用位置以及其意图表达的内容。

例如，如果你考虑以下目录：

```json
{
  "5VpL9Z": "Right"
}
```

……那么就无法确定“right”指的是方向（左/右），还是表示某件事是正确的。

虽然为翻译人员提供上下文一直很重要，尤其是随着 AI 翻译的兴起，这一点变得越来越重要，但更重要的是以结构化的方式提供上下文，而不是尝试在运行中的应用中查找消息。

目前正在考虑以下文件格式：

#### 1. 可移植对象目录（.po）

```
#. Advance to the next slide
#: src/components/Carousel.tsx
msgid "5VpL9Z"
msgstr "Right"

...
```

**优点：**

- 标准化格式
- 可以附加上下文描述
- 在提取过程中可以自动添加文件路径（如果调用位置发生移动，也可以更新文件路径，而不会使键失效）

**缺点：**

- 对部分开发者来说可能不太熟悉（但 `next-intl` 会自动处理解析，因此用户端无需付出额外 effort）

**未来探索：** 通过 AI 自动为翻译提供补充描述（相关内容：[Crowdin Context Harvester](https://store.crowdin.com/crowdin-context-harvester-cli)）

#### 2. 结构化 JSON

```json
{
  "5VpL9Z": {
    "description": "Advance to the next slide",
    "message": "Right"
  }
}
```

这是 [`chrome.i18n`](https://developer.chrome.com/docs/extensions/reference/api/i18n) 使用的示例。

遗憾的是，这并不是一个通用标准——这里只列举几个：

1. [Crowdin 支持的 Chrome JSON](https://store.crowdin.com/chrome-json)
2. [Lokalise 支持的结构化 JSON](https://docs.lokalise.com/en/articles/3229161-structured-json)
3. [Smartling 支持的结构化 JSON](https://help.smartling.com/hc/en-us/articles/360008000733-JSON#StringInstructions)
4. [Transifex 支持的结构化 JSON](https://help.transifex.com/en/articles/6220899-structured-json)

**优点：**

- 可以附加上下文描述

**缺点：**

- 没有通用标准
- 可能需要将文件元数据与描述合并

#### 3. 简单 JSON

```json
{
  "5VpL9Z": "Right"
}
```

**优点：**

- 流行且广泛使用
- 几乎所有 `next-intl` 用户都可能使用

**缺点：**

- 没有上下文描述

---

因此，`.po` 似乎可以作为默认格式的最佳选择，因为它不会迫使用户在将来需要上下文描述时迁移到其他格式。不过，让格式可配置并同时支持简单 JSON 也很重要。

**未来探索：** 提供从一种格式迁移到另一种格式的迁移脚本。

### 生成压缩键

需要考虑的一个重要问题是，生成压缩键时应使用消息的哪些方面。

为了避免消息在组件之间移动时失效，文件路径和名称将_不会_包含在键中。

相反，键应只对消息内容进行哈希：

```tsx
const message = 'Hello {name}';
const hash = crypto.createHash('sha512').update(message).digest();
const base64 = hash.toString('base64url');
const key = base64.slice(0, 6);

key === 'QM7ITA';
```

**注意：**

- 在我使用 2019 年款 MacBook Pro 进行的基准测试中，对于实际使用场景，SHA-512 的表现似乎与 SHA-256 相近，没有明显的优胜者。FormatJS 使用 SHA-512，因此在此保持兼容可能会有所帮助。
- Base64 有助于降低冲突风险（例如与十六进制相比），同时保持键的可读性。使用 URL 安全的 Base64 可以避免出现 `+` 和 `/` 字符，因为当这些字符出现在序列化的页面数据中时，可能会被误解为 URL 路径。
- 描述也可以作为哈希的候选内容，但这可能会增加意外失效的情况。如果需要避免某条消息发生冲突，则应改用[显式 ID](#explicit-ids)。

### 目录生成

**工作流：**

- **添加新消息**：将消息提取到源语言目录，并为所有次要语言添加空翻译
- **更新消息**：将消息提取到源语言目录，并重置所有次要语言的翻译
- **删除消息**：将消息从源语言目录中提取并删除，同时移除所有次要语言的翻译

**未来探索：**

- **修复拼写错误**：考虑添加一种工作流，在保留现有翻译的同时修复源语言中的拼写错误（例如使用类似 `t(/* keep */ 'Fixed message')` 的魔法注释，并在提取期间自动移除该注释）
- **源文本审查**：除修复拼写错误之外，一些项目还要求在翻译工作开始前进行广泛的 [STR](https://support.crowdin.com/enterprise/source-text-review/)。针对这种情况，如果有一个工具能够将更新后的源语言目录同步回源代码，可能会很有帮助。或者，对于源文本在外部系统中频繁变化的项目，基于键的方法可能仍然更加方便。与此相关的还有一个架构层面的考虑：是否应该将频繁变化的营销标签放入 CMS。

### 打包器集成

该提取功能主要设计为配合正在运行的开发服务器使用。Turbopack 插件将分析相关代码，提取消息，并转换源文件，使其使用通过 `useTranslations()` 引用的生成键。

为了将提取出的消息重新加载到应用中，Turbopack loader 会即时将消息目录转换为简单 JSON 消息，这些消息可以从 `i18n/request.ts` 返回。这一过程在后台完成，无需公开 API。

对于边缘情况，将支持一次性提取，但可能只提供 Node.js API，而不提供单独的 CLI。原因是需要进行一些配置，这样可以在 `next.config.ts` 中的 Next.js 插件与潜在的自定义脚本之间共享配置。应避免使用类似 `next-intl.config.js` 的配置文件。

## 迁移

首先，如果 `next-intl` 当前的 API 正是你想使用的 API，那么一开始就没有迁移的必要。

除此之外，还有两种使用场景：

1. **混合代码库**：用户可能希望在某些地方试用此 API，以了解它是否适合自己，同时保留所有现有翻译不变。
2. **完整迁移**：如果用户有兴趣完全迁移到新 API，理想情况下应提供自动化迁移方案。

**未来探索：** 考虑使用 [Codemod](https://codemod.com/) 将 `useTranslations` 的用法迁移到 `useExtracted`。

## 权衡

1. **依赖构建步骤：** 当前使用 `useTranslations` 的 API 理论上可以在没有构建步骤的情况下运行，但尤其是随着 `'use client'` 等近期创新的出现，显然构建步骤将会长期存在。
2. **翻译重置：** 如果源语言中的翻译被修复，次要语言的翻译将被重置。虽然对于重大变更而言这可能是期望的行为，但例如修复拼写错误时，这可能会令人烦恼。不过，我认为仍有针对这种情况进行特殊处理的空间（相关内容：[目录生成](#catalog-generation)）。
3. **在 TMS 中更改源语言翻译：** 这会导致一种奇怪的情况：代码中包含的标签在应用中并不会以这种形式出现。对于本 RFC 的当前范围，预计由开发者负责更改源语言标签。不过，工具可以帮助支持其他工作流（相关内容：[目录生成](#catalog-generation)）。

**未来探索：** 考虑添加验证，以确保提取出的消息与源语言目录匹配。在此基础上，考虑添加一种工作流，将差异同步回应用代码中。

## 考虑过的替代方案

本节列出了一些曾考虑过的替代方案，但它们似乎并不适合 `next-intl`。

### 直接拼接参数

定义消息的另一种方式是直接将值插入翻译中：

```tsx
t(`Hello ${name}!`);
```

如果再考虑一些 ICU 功能，可以写成这样：

```tsx
t(`Published on ${t.date(publishedAt)}!`);
t(`Page {${t.number(index)} out of ${t.number(total)}}`);
t(
  `You have ${t.plural(count, {
    one: 'one follower',
    other: '# followers'
  })}`
);
t(`It's your ${t.ordinal(year)} birthday!`);
t(
  `${t.select(gender, {
    female: 'She',
    male: 'He',
    other: 'They'
  })} is online.`
);
```

这可能没什么问题，但对于富文本来说，情况会变得更加复杂：

```tsx
// ❌ 我们无法将字符串与 JSX 元素拼接
t.rich('This is ' + <b>{userName}</b> + '.');

// 假设我们将各个部分分别传入……
t.rich('This is ', <b>{userName}</b>, '.');

// ❌ 但现在，如何在 JSX 中定义静态文本？再调用一次 `t`？
t.rich('This is ', <b>{t('important')}</b>, '.');
```

在这里，基于 JSX 的替代方案似乎效果更好：

```tsx
<t.rich>
  This is <b>important</b>.
</t.rich>
```

……不过，与基于函数调用的 `t` 结合使用时，这并不像一个统一的 API。

对于某些使用场景而言，拥有非 JSX 版本非常重要：

```tsx
function onClick() {
  setNotification(t('Successfully sent'));
}

<img alt={t('Red running shoes on white background')} src="/shoes.jpg" />;
```

这可能属于个人偏好，但对于复杂场景，基于 JSX 的方式也可能变得相当不透明：

```tsx
// 将会被提取的静态部分是什么？🤔
<t.rich>
  Visit
  <Link
    className="underline text-blue-600 hover:text-blue-800 font-semibold transition-colors"
    to="/users/jane"
  >
    {(await getUser()).name}'s profile
  </Link>
  to learn more
</t.rich>;

// ……与下面的方式相比：
t('Visit <link>{name}‘s profile</link> to learn more', {
  name: (await getUser()).name,
  link: (chunks) => (
    <Link
      className="underline text-blue-600 hover:text-blue-800 font-semibold transition-colors"
      to="/users/jane"
    >
      {chunks}
    </Link>
  )
});
```

此外，还有一种涉及 [HTML 标记](https://next-intl.dev/docs/usage/translations#html-markup) 的情况，这同样需要使用不同的调用方式。

除了富文本之外，还有进一步的权衡：

1. 提取器需要猜测变量名（例如上面第一个示例中的 `name`）。对于简单场景，这种方式可以正常工作，但对于 `Hello ${getName()}` 这类更复杂的场景就会失效，因此最终我们不得不使用 `$0`、`$1` 等通用名称。
2. 对于 `Page {index, number} out of {total, number}` 这样的字符串，我们目前可以通过 TypeScript 进行静态分析，确认你在消息定义中使用了 `number` 格式化器。`date` 也是如此。如果使用上面基于简单字符串拼接的 API，则无法实现这一点。
3. 我们可以提供类型安全，避免传入 `undefined` 这类会导致翻译失效的无效值。
4. 如果我们以后添加用于定义消息的 [宏](#macro-for-defining-messages)，由于定义消息的位置可能无法访问参数，因此无法使用这种方式。

因此，要找到一种既运行良好、又易于正确实现的方案，需要投入相当多的设计工作，实现本身也可能需要更多精力。如果我们直接使用内联 ICU 字符串，就可以避免这些问题。

这在很大程度上取决于项目，但我反复观察到，典型应用中的大多数消息都是简单字符串，只有相对较少的场景需要 ICU 功能。因此，我的印象是，对于常见情况而言，这种差异无论如何都不会造成影响，所以可能不值得投入精力继续探索这条路径。

### 支持以人类可读的字符串作为键

如果允许使用人类可读的消息作为键，那么本提案中讨论的一些优势将可以实现。目前不支持这一点，因为 `next-intl` 不允许在键中使用 `.`。

即使允许这样做，也会带来一些权衡，例如必须自行提取消息、无法压缩键名等。因此，全面采用完善的消息提取方案似乎更为可取。

### 用于定义消息的宏

其他方案允许在组件之外定义消息，例如：

```tsx
// 定义一条消息……
const message = msg`Hello {name}`;

// ……稍后使用
t(message, {name: 'John'});
```

这种模式的问题在于，我们无法静态分析哪些模块图使用了哪些消息（与 [next-intl#1](https://github.com/amannn/next-intl/issues/1) 相关）。

此外，为了避免 [翻译过期](https://next-intl.dev/blog/translations-outside-of-react-components)，我们已经限制 `t` 的调用必须位于组件中，因此不允许在组件外定义消息，也有可能进一步简化开发者的心智模型。

相关内容：[可进行静态分析](#statically-analyzable)

## 先前成果与致谢

本 RFC 从以下项目中汲取了大量灵感：

[**gettext**](https://en.wikipedia.org/wiki/Gettext)

- 代码示例：`printf(_("My name is %s."), my_name)`
- 默认键策略：使用消息作为键
- 默认格式：`.pot`

[**Lingui**](https://lingui.dev/)

- 代码示例：`<Trans>My name is {name}.</Trans>`
- 默认键策略：`hexToBase64(sha256(msg + UNIT_SEPARATOR + (context | ""))).slice(0, 6)`
- 默认格式：`.po`

[**FormatJS**](https://formatjs.github.io/)

- 代码示例：`<FormattedMessage defaultMessage="My name is {name}." values={{name: 'John'}} />`
- 默认键策略：`[sha512:contenthash:base64:6]`
- 默认格式：Chrome JSON

[**@wordpress/i18n**](https://www.npmjs.com/package/@wordpress/i18n)

- 代码示例：`sprintf(__( 'Hello %s', 'my-text-domain' ), name)`
- 默认键策略：使用消息作为键
- 默认格式：`.pot`

[**Zendesk 的 i18n**](https://www.youtube.com/watch?v=fUQAXo2DayQ)

- 代码示例：`t('Hello ${name}')`
- 默认键策略：哈希值 + 消息作为键
- 默认格式：结构化 JSON

---

衷心感谢这些项目的作者，感谢他们的工作与启发！
