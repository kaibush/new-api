export const meta = {
  apiVersion: 1,
  key: "error-mask",
  name: { en: "Error masking", zh: "错误屏蔽" },
  description: {
    en: "Replaces public error messages when any keyword matches",
    zh: "命中任意关键词时替换对外错误提示",
  },
  version: "1.1.0",
  author: { name: "QuantumNous" },
  requiredCapabilities: ["error-response@1"],
  configSchema: {
    type: "object",
    properties: {
      field: {
        type: "string",
        title: { en: "Match field", zh: "匹配字段" },
        enum: ["message", "type", "code"],
        enumTitles: [
          { en: "Message", zh: "错误消息" },
          { en: "Error type", zh: "错误类型" },
          { en: "Error code", zh: "错误代码" },
        ],
        default: "message",
      },
      match: {
        type: "string",
        title: { en: "Match mode", zh: "匹配模式" },
        enum: ["keywords", "regex"],
        enumTitles: [
          { en: "Contains keywords", zh: "包含关键词" },
          { en: "Regular expression", zh: "正则表达式" },
        ],
        default: "keywords",
      },
      pattern: {
        type: "string",
        format: "regex",
        title: { en: "Regular expression", zh: "正则表达式" },
        default: "",
        maxLength: 1024,
        visibleWhen: { match: "regex" },
      },
      action: {
        type: "string",
        title: { en: "Error action", zh: "错误处理方式" },
        enum: ["replace", "redact"],
        enumTitles: [
          { en: "Replace entire message", zh: "替换整个消息" },
          { en: "Replace matching text", zh: "替换匹配文本" },
        ],
        default: "replace",
      },
      keywords: {
        type: "string",
        format: "keywords",
        title: { en: "Keywords", zh: "关键词" },
        description: {
          en: "One per line, matching any keyword replaces the message",
          zh: "每行一个，命中任意关键词即替换提示",
        },
        default: "",
        maxLength: 16384,
        visibleWhen: { match: "keywords" },
      },
      caseSensitive: {
        type: "boolean",
        title: { en: "Case sensitive", zh: "区分大小写" },
        default: false,
      },
      matchAll: {
        type: "boolean",
        title: { en: "Match all errors", zh: "匹配所有错误" },
        description: { en: "Replace errors regardless of keywords", zh: "不检查关键词，直接替换错误提示" },
        default: false,
      },
      statuses: {
        type: "array",
        title: { en: "HTTP statuses", zh: "HTTP 状态码" },
        description: { en: "An empty list matches every status", zh: "留空时匹配所有状态码" },
        default: [],
        maxItems: 32,
        uniqueItems: true,
        items: { type: "integer", title: { en: "Status", zh: "状态码" }, minimum: 100, maximum: 599 },
      },
      replacement: {
        type: "string",
        format: "textarea",
        title: { en: "Replacement message", zh: "替换提示" },
        default: "The request could not be completed. Please try again later.",
        maxLength: 1024,
      },
    },
  },
};

export function validateConfig(config) {
  if (!config.matchAll && config.match === "keywords" && config.action === "redact" && config.keywords.count > 32) {
    throw new Error("Partial replacement supports at most 32 keywords");
  }
  if (config.match === "regex" && !config.matchAll) {
    if (!config.pattern) throw new Error("A regular expression is required");
    new RegExp(config.pattern, config.caseSensitive ? "g" : "gi").test("");
  }
}

// Each instance is one rule. The host stops at the first replacement, including
// partial replacement, preserving legacy rule order. Native keyword matchers
// are cached by the host; regular expressions use the runtime's RE2 engine.
export function errorResponse(ctx, error) {
  const config = ctx.config;
  if (config.statuses.length && !config.statuses.includes(error.status)) {
    return { action: "continue" };
  }
  if (config.matchAll) return { action: "replace", message: config.replacement };
  let pattern;
  if (config.match === "regex") {
    pattern = new RegExp(config.pattern, config.caseSensitive ? "g" : "gi");
    if (!pattern.test(error[config.field])) return { action: "continue" };
    pattern.lastIndex = 0;
  } else {
    const matches = utils.keywords("keywords", error[config.field], {
      caseSensitive: config.caseSensitive,
    });
    if (!matches.length) return { action: "continue" };
    if (config.action === "redact") {
      // Literal keywords and literal replacements must not interpret regex or
      // replacement metacharacters. Longer overlapping keywords take priority.
      const terms = matches.slice().sort((a, b) => b.length - a.length);
      pattern = new RegExp(terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), config.caseSensitive ? "g" : "gi");
    }
  }
  if (config.action !== "redact") return { action: "replace", message: config.replacement };
  const message = config.match === "regex" ? error.message.replace(pattern, config.replacement) : error.message.replace(pattern, () => config.replacement);
  return { action: "redact", message };
}
