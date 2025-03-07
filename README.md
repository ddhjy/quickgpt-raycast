# QuickGPT

QuickGPT 是一个专为 Raycast 设计的高效提示管理工具，旨在通过快速访问和自定义提示来提升您的生产力。无论您是在编写代码、撰写文档还是进行日常任务，QuickGPT 都能帮助您轻松生成和管理各种提示。

## 特性

- **自定义提示**：根据您的需求创建和管理个性化提示。
- **快捷操作**：通过快捷键快速复制、粘贴或在浏览器中打开提示内容。
- **内容格式化**：支持多种占位符替换，实现动态内容生成。
- **持久化存储**：自动保存和管理您固定的提示，确保常用提示随时可用。
- **多语言支持**：支持中文等多种语言，满足不同用户的需求。

## 安装

要安装 QuickGPT，请确保您已经安装了 [Raycast](https://www.raycast.com/)。然后按照以下步骤操作：

1. **克隆仓库**
   ```bash
   git clone https://github.com/ddhjy/quickgpt-raycast.git
   ```
2. **安装依赖**
   ```bash
   cd quickgpt-raycast
   npm install
   ```
3. **构建项目**
   ```bash
   npm run dev
   ```
4. **在 Raycast 中添加扩展**
   - 打开 Raycast
   - 转到扩展面板
   - 添加新的本地扩展，指向 `quickgpt` 项目目录

## 使用方法

### 启动 QuickGPT

在 Raycast 中输入 `QuickGPT`，即可启动提示管理界面。您可以浏览、搜索和选择不同的提示来快速插入到您的工作流中。

### 创建自定义提示

1. 打开 `assets/prompts.pm.json` 文件或您的自定义提示文件。
2. 按照以下格式添加新的提示：
   ```json
   {
     "identifier": "unique_id",
     "title": "您的提示标题",
     "content": "您的提示内容，例如：Hello {{input}}, your clipboard says {{clipboard}}",
     "options": {
       "input": ["选项1", "选项2"],
       "clipboard": ["选项A", "选项B"]
     }
   }
   ```
3. 保存文件，QuickGPT 将自动加载新的提示。

### 快捷操作

- **复制提示内容**：选择提示后，按下快捷键 `Cmd + Shift + C` 将内容复制到剪贴板。
- **粘贴提示内容**：选择提示后，按下快捷键 `Cmd + Shift + V` 将内容粘贴到当前应用。
- **运行脚本**：您可以配置自定义脚本，通过提示内容执行特定操作。

## 文件结构

```plaintext
quickgpt/
├── __tests__/
│   └── contentFormat.test.ts
├── assets/
│   ├── ChatGPT.applescript
│   └── prompts.pm.json
├── src/
│   ├── components/
│   │   └── Ref.tsx
│   ├── contentFormat.ts
│   ├── getPromptActions.tsx
│   ├── index.tsx
│   ├── lastActionStore.ts
│   ├── pinsManager.ts
│   └── promptManager.ts
├── package.json
└── README.md
```

### 主要文件说明

- `__tests__/contentFormat.test.ts`：内容格式化功能的单元测试。
- `assets/prompts.pm.json`：默认的提示集合，您可以在此文件中添加自定义提示。
- `src/contentFormat.ts`：负责处理和格式化提示内容，包括占位符的替换逻辑。
- `src/promptManager.ts`：管理提示的加载、解析和过滤。
- `src/getPromptActions.tsx`：定义提示的快捷操作，如复制、粘贴和运行脚本。
- `src/index.tsx`：主入口文件，构建提示列表并处理用户交互。
- `src/lastActionStore.ts`：记录和获取用户最后执行的操作。
- `src/pinsManager.ts`：管理用户固定的提示，确保常用提示随时可用。

## 贡献

欢迎任何形式的贡献！如果您发现问题或有改进建议，请提交 [Issue](https://github.com/ddhjy/quickgpt/issues)。欢迎提交 Pull Request 来贡献代码。

## 许可证

本项目基于 [MIT 许可证](LICENSE) 许可，您可以自由地使用、修改和分发。

---

感谢您使用 QuickGPT！如果您喜欢这个项目，请给我们一个星 ⭐️，并分享给更多需要的朋友！

# 联系方式

如果您有任何问题或建议，请通过以下方式与我们联系：

- **GitHub**: [https://github.com/您的用户名/quickgpt](https://github.com/您的用户名/quickgpt)
- **邮箱**: your-email@example.com

# 版本

当前版本：`1.0.0`

# 更新日志

查看 [CHANGELOG.md](CHANGELOG.md) 了解最新的更新和变更。

# 致谢

感谢所有贡献者和支持者，使 QuickGPT 成为可能！

# 支持

如果您喜欢 QuickGPT，请考虑给我们一个 [Star](https://github.com/您的用户名/quickgpt) 或者分享给您的朋友！

# 免责声明

QuickGPT 是基于开源技术开发的，任何使用本项目的风险由您自行承担。我们不对任何直接或间接的损失负责。

# 实例

以下是 QuickGPT 的一些使用实例：

## 替换占位符

```typescript:contentFormat.ts
export function contentFormat(text: string, specificReplacements: SpecificReplacements): string {
  const placeholderPattern = /{{([^}]+)}}/g;

  return text.replace(placeholderPattern, (_, placeholderContent) => {
    const isPrefixed = placeholderContent.startsWith('p:');
    const content = isPrefixed ? placeholderContent.slice(2) : placeholderContent;
    const parts = content.split('|');

    for (const part of parts) {
      const key = aliasMap[part] || (part as keyof SpecificReplacements);
      let replacement: string | undefined;

      if (isPrefixed) {
        replacement = specificReplacements[key] ? placeholders[key]?.literal || `<${key}>` : undefined;
      } else {
        replacement = specificReplacements[key];
      }

      if (replacement) {
        return replacement;
      }
    }

    // 如果没有找到合适的替换，则返回原始占位符
    return _;
  });
}
```

## 快捷操作

```typescript:getPromptActions.tsx
export function getPromptActions(
  getFormattedDescription: () => string,
  actions?: string[]
): React.ReactNode[] {
  // ...实现快捷操作逻辑
}
```

# 联系我们

如果您有任何问题或建议，请在 [GitHub Issues](https://github.com/您的用户名/quickgpt/issues) 中提出，或者通过电子邮件与我们联系。

---

_本项目由 [您的名字](https://github.com/您的用户名) 维护。感谢您的支持！_

# 反馈

我们非常重视您的反馈！请随时通过 GitHub 提交问题或建议。

# 版权信息

© 2023 Your Name. 版权所有。

# 免责声明

本项目仅供学习和交流使用，不得用于任何商业用途。使用本项目需遵守相关法律法规。

# 结语

希望 QuickGPT 能为您的工作带来便利和效率。感谢您的使用与支持！

# License

MIT

# 版本记录

## [1.0.0] - 2023-10-01

### 添加

- 初始发布 QuickGPT，具备基本的提示管理和快捷操作功能。

---

如果您有任何疑问或需要进一步的信息，请随时与我们联系！

# 参考资料

- [Raycast 官方文档](https://developers.raycast.com/)
- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)
- [React 官方文档](https://reactjs.org/docs/getting-started.html)

# 更新与维护

我们定期更新 QuickGPT 以修复漏洞和添加新功能。请确保您使用的是最新版本，以获得最佳体验。

# 贡献指南

如果您想为 QuickGPT 贡献代码，请遵循以下步骤：

1. Fork 本仓库
2. 创建您的分支 (`git checkout -b feature/新功能`)
3. 提交您的更改 (`git commit -m '添加新功能'`)
4. 推送到分支 (`git push origin feature/新功能`)
5. 创建一个新的 Pull Request

我们会尽快审核您的贡献！

# 常见问题

**Q: QuickGPT 如何工作？**
A: QuickGPT 通过读取和管理提示文件，允许您快速访问和使用各种自定义提示。它支持占位符替换和多种快捷操作，以提升您的生产力。

**Q: 我如何添加自定义提示？**
A: 您可以在 `assets/prompts.pm.json` 文件中添加新的提示，或者创建自己的提示文件并配置路径。

**Q: QuickGPT 支持哪些占位符？**
A: QuickGPT 支持包括 `{{input}}`、`{{clipboard}}` 等多种占位符，您可以根据需要进行扩展和定制。

---

感谢您的阅读，祝您使用愉快！

# 标签

- Raycast
- TypeScript
- React
- 提示管理
- 快捷操作
- 内容格式化

# 示例截图

![QuickGPT 界面截图](assets/screenshot.png)

# 代码示例

以下是 QuickGPT 的核心功能代码示例：

```typescript:contentFormat.ts
/**
 * 格式化内容，替换占位符为具体值
 * @param text 要格式化的文本
 * @param specificReplacements 替换的具体值
 * @returns 格式化后的文本
 */
export function contentFormat(text: string, specificReplacements: SpecificReplacements): string {
  const placeholderPattern = /{{([^}]+)}}/g;

  return text.replace(placeholderPattern, (_, placeholderContent) => {
    const isPrefixed = placeholderContent.startsWith('p:');
    const content = isPrefixed ? placeholderContent.slice(2) : placeholderContent;
    const parts = content.split('|');

    for (const part of parts) {
      const key = aliasMap[part] || (part as keyof SpecificReplacements);
      let replacement: string | undefined;

      if (isPrefixed) {
        replacement = specificReplacements[key] ? placeholders[key]?.literal || `<${key}>` : undefined;
      } else {
        replacement = specificReplacements[key];
      }

      if (replacement) {
        return replacement;
      }
    }

    // 如果没有找到合适的替换，则返回原始占位符
    return _;
  });
}
```

---

_本项目基于 MIT 许可发布。_

# 感谢

感谢所有为 QuickGPT 做出贡献的开发者和用户，您的支持是我们不断前进的动力！

# 未来计划

- **多平台支持**：扩展到更多平台，如 VSCode、Slack 等。
- **高级占位符**：支持更复杂的占位符和逻辑替换。
- **用户界面优化**：提升界面的友好性和交互性。
- **插件生态**：开放 API，允许第三方开发者创建插件。

# 版权声明

所有项目文件均遵循 MIT 许可证，详见 [LICENSE](LICENSE)。

# 相关链接

- [项目主页](https://github.com/您的用户名/quickgpt)
- [文档](https://github.com/您的用户名/quickgpt/wiki)
- [问题追踪](https://github.com/您的用户名/quickgpt/issues)

# 快速开始

1. **安装依赖**
   ```bash
   npm install
   ```
2. **启动开发模式**
   ```bash
   npm run dev
   ```
3. **构建项目**
   ```bash
   npm run build
   ```

# 参与讨论

加入我们的 [讨论区](https://github.com/您的用户名/quickgpt/discussions) ，与其他用户交流经验和建议。

---

再次感谢您的关注与支持！希望 QuickGPT 能为您的工作带来更多便利和效率。

# 额外资源

- [如何为 Raycast 创建扩展](https://developers.raycast.com/)
- [TypeScript 入门指南](https://www.typescriptlang.org/docs/handbook/intro.html)
- [React 官方文档](https://reactjs.org/docs/getting-started.html)

# Stack Overflow

如果在使用过程中遇到问题，您可以在 [Stack Overflow](https://stackoverflow.com/) 上搜索相关问题或提出新的问题，标签使用 `quickgpt` 和 `raycast`。

---

_本 README 使用 Markdown 编写，支持丰富的格式和链接，帮助您更好地了解和使用 QuickGPT。_

# 总结

QuickGPT 是一个强大的工具，旨在通过简化提示管理和增强快捷操作来提升您的工作效率。通过灵活的配置和丰富的功能，QuickGPT 能为各类用户提供极大的便利。

快来体验 QuickGPT 吧，让您的工作流程更加高效流畅！

# 最后

如果您喜欢这个项目，请给我们一个星 ⭐️ 并分享给您的朋友！

---

_© 2023 QuickGPT 团队。保留所有权利。_

# Show License

MIT License

版权所有 (c) 2023 Your Name

特此授权，免费向任何获得本软件及相关文档文件（以下简称“软件”）副本的人士，允许运行、复制、修改、合并、出版、分发、再许可及/或销售软件的副本，并允许向其提供软件，符合以下条件：

上述版权声明和本许可声明应包含在软件的所有副本或主要部分中。

本软件按“原样”提供，无任何明示或暗示的担保，包括但不限于对适销性、特定用途的适用性及不侵权的担保。在任何情况下，作者或版权持有人均不对因软件或软件的使用或其他交易中产生的任何索赔、损害或其他责任承担责任。

# 结束

感谢您的阅读和使用，祝您有一个愉快的开发体验！
