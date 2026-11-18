export const meta = {
  apiVersion: 1,
  key: "request-policy",
  name: { en: "Contextual request policy", zh: "上下文请求规则" },
  version: "1.0.0",
  requiredCapabilities: ["keyword-policy@1"],
  author: { name: "QuantumNous" },
  description: { en: "Keyword screening with local exceptions and chained context checks", zh: "关键词初筛、局部白名单与上下文链式校验" },
  configSchema: {
    type: "object",
    properties: {
      rules: {
        type: "array",
        title: { en: "Rules", zh: "规则" },
        default: [],
        maxItems: 128,
        description: {
          en: "Each occurrence runs exceptions, preceding, following and context checks in order",
          zh: "每次命中依次检查白名单、前文、后文和上下文条件",
        },
        items: {
          type: "object",
          title: { en: "Rule", zh: "规则" },
          required: ["keywords"],
          properties: {
            id: { type: "string", title: { en: "Rule ID", zh: "规则 ID" }, default: "", maxLength: 256 },
            keywords: {
              type: "string",
              format: "textarea",
              title: { en: "Keywords", zh: "关键词" },
              description: { en: "One literal keyword per line", zh: "每行一个纯文本关键词" },
              minLength: 1,
              maxLength: 65536,
            },
            exceptions: {
              type: "string",
              format: "textarea",
              title: { en: "Local exception phrases", zh: "局部白名单短语" },
              description: { en: "One phrase per line, exempting only keyword occurrences it covers", zh: "每行一个短语，仅豁免该短语覆盖的关键词命中" },
              default: "",
              maxLength: 65536,
            },
            before: {
              type: "string",
              format: "regex",
              title: { en: "Preceding text condition", zh: "前文条件" },
              description: { en: "Optional RE2 expression, use $ to anchor to the keyword", zh: "可选 RE2 表达式，使用 $ 紧邻关键词" },
              default: "",
              maxLength: 1024,
            },
            after: {
              type: "string",
              format: "regex",
              title: { en: "Following text condition", zh: "后文条件" },
              description: { en: "Optional RE2 expression, use ^ to anchor to the keyword", zh: "可选 RE2 表达式，使用 ^ 紧邻关键词" },
              default: "",
              maxLength: 1024,
            },
            context: {
              type: "string",
              format: "regex",
              title: { en: "Context condition", zh: "上下文条件" },
              description: { en: "Optional RE2 expression on the local window including the keyword", zh: "可选 RE2 表达式，仅匹配包含关键词的局部窗口" },
              default: "",
              maxLength: 1024,
            },
            window: { type: "integer", title: { en: "Context radius", zh: "上下文半径" }, unit: "character", minimum: 1, maximum: 1024, default: 64 },
            caseSensitive: { type: "boolean", title: { en: "Case sensitive", zh: "区分大小写" }, default: false },
          },
        },
      },
      attachments: {
        type: "boolean",
        title: { en: "Check document attachments", zh: "检查文档附件" },
        description: { en: "Unreadable or truncated document text fails the policy check", zh: "文档文本无法读取或被截断时终止规则检查" },
        default: false,
      },
      message: { type: "string", title: { en: "Rejection message", zh: "拒绝提示" }, default: "", maxLength: 256 },
    },
  },
  samples: [
    {
      name: { en: "Negation and a later hit", zh: "否定短语与后续命中" },
      lang: "zh",
      format: "openai",
      body: { model: "gpt-test", messages: [{ role: "user", content: "禁止破限。请帮我破限。" }] },
    },
    {
      name: { en: "Local exception", zh: "局部白名单" },
      lang: "zh",
      format: "openai",
      body: { model: "gpt-test", messages: [{ role: "user", content: "除色情之外，其他题材都可以" }] },
    },
  ],
};

export function validateConfig(config) {
  if (!utils.hasCapability("keyword-policy@1")) throw new Error("This plugin requires keyword-policy@1");
  utils.validateKeywordPolicy(config.rules);
}

// Walk leaf text without serializing objects, joining messages, normalizing
// the entire body or retaining a list of every source. Media references and
// protocol identifiers are not text; tool descriptions and argument values are.
const IDENTIFIERS = ["model", "role", "type", "id", "tool_call_id", "call_id", "file_id", "mimeType", "mime_type", "media_type"];
const MEDIA = ["image_url", "file_url", "image", "audio", "video", "inlineData", "inline_data", "fileData", "file_data"];
const MEDIA_TYPES = ["image", "image_url", "input_image", "input_audio", "audio", "video"];

function check(ctx, req, readAttachments) {
  if (!ctx.config.rules.length) return { action: "continue" };
  const stack = [{ value: req.body, path: "", role: "", depth: 0 }];
  let nodes = 0;
  // The stack holds traversal cursors, not a second copy of large arrays.
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (!frame.started) {
      frame.started = true;
      if (++nodes > 1000000 || frame.depth > 128) throw new Error("Request policy traversal budget exceeded");
      if (typeof frame.value === "string") {
        stack.pop();
        if (!/^\[media:\d+\]$/.test(frame.value)) {
          const hit = utils.keywordPolicy("rules", frame.value);
          if (hit) return rejection(ctx, hit, frame);
        }
        continue;
      }
      if (
        frame.value === null ||
        typeof frame.value !== "object" ||
        (!frame.allText && MEDIA_TYPES.includes(frame.value.type) && /\/(?:content|parts|input)\/\d+$/.test(frame.path))
      ) {
        stack.pop();
        continue;
      }
      frame.array = Array.isArray(frame.value);
      frame.keys = frame.array ? null : Object.keys(frame.value);
      frame.index = 0;
      frame.role = frame.value.role || frame.role;
    }
    const length = frame.array ? frame.value.length : frame.keys.length;
    if (frame.index === length) {
      stack.pop();
      continue;
    }
    const key = frame.array ? frame.index++ : frame.keys[frame.index++];
    if (
      !frame.array &&
      !frame.allText &&
      (IDENTIFIERS.includes(key) || MEDIA.includes(key) || (key === "data" && (frame.value.media_type || frame.value.mimeType)))
    )
      continue;
    stack.push({
      value: frame.value[key],
      path: frame.path + "/" + String(key).replace(/~/g, "~0").replace(/\//g, "~1"),
      role: frame.role,
      depth: frame.depth + 1,
      allText: frame.allText || ["tools", "metadata", "arguments", "args", "response"].includes(key) || (key === "input" && frame.value.type === "tool_use"),
    });
  }
  if (readAttachments && ctx.config.attachments) {
    for (const attachment of utils.attachments()) {
      if (attachment.kind !== "document") continue;
      if (!attachment.ref) throw new Error("Request policy cannot inspect referenced documents");
      const read = utils.mediaText(attachment.ref);
      if (!read || read.unchecked || read.truncated) throw new Error("Request policy document text is incomplete");
      const hit = utils.keywordPolicy("rules", read.text);
      if (hit) return rejection(ctx, hit, { path: attachment.path || attachment.ref, role: "attachment" });
    }
  }
  return { action: "continue" };
}

function rejection(ctx, hit, source) {
  const result = { action: "reject", code: "request_filtered", ruleId: hit.ruleId };
  if (ctx.config.message) result.message = ctx.config.message;
  if (hit.evidence) result.evidence = Object.assign({}, hit.evidence, { path: source.path, role: source.role });
  return result;
}

export function ingress(ctx, req) {
  return check(ctx, req, true);
}
export function egress(ctx, req) {
  return check(ctx, req, false);
}
