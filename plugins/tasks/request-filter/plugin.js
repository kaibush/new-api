export const meta = {
  apiVersion: 1,
  requiredCapabilities: ["user-allowlist@1"],
  key: "request-filter",
  name: { en: "Request filter", zh: "请求过滤" },
  description: {
    en: "Rejects requests whose text matches a keyword or regular expression",
    zh: "拒绝文本命中关键词或正则表达式的请求",
  },
  version: "1.1.1",
  author: { name: "QuantumNous" },
  configSchema: {
    type: "object",
    properties: {
      normalizeText: {
        type: "boolean",
        title: { en: "Normalize text", zh: "规范化文本" },
        description: { en: "Normalize full-width characters and remove invisible separators", zh: "规范化全角字符并移除不可见分隔符" },
        default: false,
      },
      rules: {
        type: "array",
        title: { en: "Rules", zh: "规则" },
        description: { en: "The request is rejected when any rule matches", zh: "命中任一规则时拒绝请求" },
        default: [],
        maxItems: 500,
        items: {
          type: "object",
          title: { en: "Rule", zh: "规则" },
          description: { en: "Text that causes a rejection", zh: "会导致拒绝的文本" },
          required: ["pattern"],
          properties: {
            pattern: {
              type: "string",
              title: { en: "Keyword or expression", zh: "关键词或表达式" },
              description: { en: "Keyword or regular expression to match", zh: "要匹配的关键词或正则表达式" },
              minLength: 1,
              maxLength: 1024,
              examples: ["internal use only"],
            },
            type: {
              type: "string",
              title: { en: "Match type", zh: "匹配方式" },
              description: { en: "How the pattern is matched", zh: "匹配内容的方式" },
              enum: ["keyword", "regex"],
              enumTitles: [
                { en: "Keyword", zh: "关键词" },
                { en: "Regular expression", zh: "正则表达式" },
              ],
              default: "keyword",
            },
            caseSensitive: {
              type: "boolean",
              title: { en: "Case sensitive", zh: "区分大小写" },
              description: { en: "Whether letter case must match", zh: "是否区分大小写" },
              default: false,
            },
            id: {
              type: "string",
              title: { en: "Rule ID", zh: "规则 ID" },
              description: {
                en: "Recorded in logs when the rule matches; leave empty to number rules in order",
                zh: "命中时记录在日志中，留空时按顺序编号",
              },
              maxLength: 64,
              examples: ["internal-docs"],
            },
          },
        },
      },
      keywords: {
        type: "string",
        format: "keywords",
        title: { en: "Keyword list", zh: "关键词列表" },
        description: {
          en: "One per line; the request is rejected when any of them appears",
          zh: "每行一个，请求中出现任意一个时拒绝",
        },
        default: "",
        maxLength: 1048576,
      },
      keywordsCaseSensitive: {
        type: "boolean",
        title: { en: "Keywords are case sensitive", zh: "关键词区分大小写" },
        default: false,
      },
      message: {
        type: "string",
        title: { en: "Rejection message", zh: "拒绝提示" },
        description: {
          en: "Shown to the client; leave empty for the default message",
          zh: "返回给客户端，留空时使用默认提示",
        },
        default: "",
        maxLength: 256,
        examples: ["This request contains content that is not allowed"],
      },
      replies: {
        type: "boolean",
        title: { en: "Check replies", zh: "检查回复" },
        description: {
          en: "Also stop model replies that match a rule",
          zh: "同时中止命中规则的模型回复",
        },
        default: false,
      },
    },
  },
  samples: [
    {
      name: { en: "Internal memo", zh: "内部备忘录" },
      lang: "en",
      format: "openai",
      body: {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Summarize this memo. It is marked internal use only: Q3 revenue grew 12 percent." }],
      },
      reply: "This memo is for internal use only. It reports that Q3 revenue grew 12 percent.",
    },
    {
      name: { en: "Internal memo", zh: "内部备忘录" },
      lang: "zh",
      format: "openai",
      body: {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "总结这份备忘录，它标注了仅限内部使用：第三季度收入增长 12%。" }],
      },
      reply: "这份备忘录仅限内部使用，内容是第三季度收入增长 12%。",
    },
  ],
};

const TEXT_PART_TYPES = ["text", "input_text", "output_text"];
const MEDIA_PLACEHOLDER = /^\[media:\d+\]$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pushText(texts, value, path = "", role = "", serialized = false) {
  if (typeof value === "string" && value !== "" && !MEDIA_PLACEHOLDER.test(value)) texts.push({ text: value, path, role, serialized });
}

// pushJSON adds a string as it is and any other value, such as a parameter
// schema or the arguments of a tool call, as its JSON text.
function pushJSON(texts, value, path = "", role = "") {
  if (typeof value === "string") pushText(texts, value, path, role);
  else if (value !== undefined && value !== null) pushText(texts, JSON.stringify(value), path, role, true);
}

// Message content: a string, or parts in the OpenAI, Responses, Claude or
// Gemini shape. Claude tool calls and results and Gemini function calls and
// responses count too; a tool result block other than text or a file counts
// as its JSON. A Claude document may carry its text in the body.
function collectContent(texts, content, path = "", role = "", inToolResult = false) {
  if (typeof content === "string") {
    pushText(texts, content, path, role);
    return;
  }
  if (!Array.isArray(content)) return;
  for (let index = 0; index < content.length; index++) {
    const part = content[index];
    const partPath = path + "/" + index;
    if (typeof part === "string") {
      pushText(texts, part, partPath, role);
      continue;
    }
    if (!isObject(part) || part.thought === true) continue;
    const call = part.functionCall || part.function_call;
    const response = part.functionResponse || part.function_response;
    if (typeof part.text === "string" && (part.type === undefined || TEXT_PART_TYPES.includes(part.type))) {
      pushText(texts, part.text, partPath + "/text", role);
    } else if (part.type === "tool_use") {
      pushText(texts, part.name, partPath + "/name", role);
      pushJSON(texts, part.input, partPath + "/input", role);
    } else if (part.type === "tool_result") {
      collectContent(texts, part.content, partPath + "/content", "tool", true);
    } else if (part.type === "document" && isObject(part.source)) {
      if (part.source.type === "text") pushText(texts, part.source.data, partPath + "/source/data", role);
      else if (part.source.type === "content") collectContent(texts, part.source.content, partPath + "/source/content", role);
    } else if (isObject(call)) {
      pushText(texts, call.name, partPath + (part.functionCall ? "/functionCall/name" : "/function_call/name"), role);
      pushJSON(texts, call.args, partPath + (part.functionCall ? "/functionCall/args" : "/function_call/args"), role);
    } else if (isObject(response)) {
      pushText(texts, response.name, partPath + (part.functionResponse ? "/functionResponse/name" : "/function_response/name"), "tool");
      if (isObject(response.response)) {
        for (const key of Object.keys(response.response)) pushJSON(texts, response.response[key], partPath + (part.functionResponse ? "/functionResponse/response/" : "/function_response/response/") + key.replace(/~/g, "~0").replace(/\//g, "~1"), "tool");
      }
    } else if (inToolResult && part.type !== "image") {
      pushJSON(texts, part, partPath, "tool");
    }
  }
}

// Responses input items: messages, tool calls with their names, arguments or
// input, and tool outputs.
const OUTPUT_ITEM_TYPES = ["function_call_output", "custom_tool_call_output", "local_shell_call_output"];

function collectInputItems(texts, items, path) {
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const itemPath = path + "/" + index;
    const role = isObject(item) ? (item.role || item.type || "") : "";
    if (typeof item === "string") {
      pushText(texts, item, itemPath, role);
      continue;
    }
    if (!isObject(item)) continue;
    pushText(texts, item.name, itemPath + "/name", role);
    if (item.content !== undefined) collectContent(texts, item.content, itemPath + "/content", role);
    else if (item.type === "function_call") pushJSON(texts, item.arguments, itemPath + "/arguments", role);
    else if (item.type === "custom_tool_call") pushJSON(texts, item.input, itemPath + "/input", role);
    else if (OUTPUT_ITEM_TYPES.includes(item.type)) collectContent(texts, item.output, itemPath + "/output", role);
    else if (TEXT_PART_TYPES.includes(item.type)) pushText(texts, item.text, itemPath + "/text", role);
  }
}

// Task text fields beside prompt: negative prompts, and song lyrics and
// descriptions.
const TASK_TEXT_KEYS = ["negative_prompt", "negativePrompt", "lyrics", "gpt_description_prompt"];
// Members of a Responses request that hold text as JSON.
const RESPONSES_JSON_KEYS = ["metadata", "text", "tool_choice"];
// Formats whose whole body is text to check: Codex web search, and DeepSeek
// search and fetch.
const WHOLE_BODY_FORMATS = ["openai_alpha_search", "deepseek_tools"];

// The text of a request in any format: chat messages with their names and
// tool calls, Claude system, Responses instructions and input items, Gemini
// contents and system instruction, tool declarations, the prompt of image
// and completion requests, embedding inputs and rerank queries and
// documents. A Responses compaction is checked as the JSON of its
// instructions and input. Task submissions add their prompts: at the top
// level, under input or parameters, in instances and in content parts.
function collectTexts(body, format) {
  const texts = [];
  if (!isObject(body)) return texts;
  if (WHOLE_BODY_FORMATS.includes(format)) {
    pushJSON(texts, body);
    return texts;
  }
  if (format === "openai_responses_compaction") {
    pushJSON(texts, body.instructions, "/instructions");
    pushJSON(texts, body.input, "/input");
    return texts;
  }
  if (Array.isArray(body.messages)) {
    for (let i = 0; i < body.messages.length; i++) {
      const message = body.messages[i];
      const path = "/messages/" + i;
      if (!isObject(message)) continue;
      collectContent(texts, message.content, path + "/content", message.role || "");
      pushText(texts, message.name, path + "/name", message.role || "");
      // Tools a message declares count as top-level tools do.
      pushJSON(texts, message.tools, path + "/tools", message.role || "");
      if (!Array.isArray(message.tool_calls)) continue;
      for (let j = 0; j < message.tool_calls.length; j++) {
        const call = message.tool_calls[j];
        const callPath = path + "/tool_calls/" + j;
        if (!isObject(call)) continue;
        if (call.custom !== undefined) {
          pushJSON(texts, call.custom, callPath + "/custom", message.role || "");
        } else if (isObject(call.function)) {
          pushText(texts, call.function.name, callPath + "/function/name", message.role || "");
          pushJSON(texts, call.function.arguments, callPath + "/function/arguments", message.role || "");
        }
      }
    }
  }
  collectContent(texts, body.system, "/system", "system");
  if (Array.isArray(body.instructions)) collectInputItems(texts, body.instructions, "/instructions");
  else pushText(texts, body.instructions, "/instructions", "system");
  if (isObject(body.prompt)) pushJSON(texts, body.prompt, "/prompt");
  else collectContent(texts, body.prompt, "/prompt");
  if (typeof body.input === "string") pushText(texts, body.input, "/input");
  else if (Array.isArray(body.input)) collectInputItems(texts, body.input, "/input");
  if (Array.isArray(body.contents)) {
    for (let i = 0; i < body.contents.length; i++) {
      const content = body.contents[i];
      if (isObject(content)) collectContent(texts, content.parts, "/contents/" + i + "/parts", content.role || "");
    }
  }
  for (const key of ["systemInstruction", "system_instruction"]) {
    const instruction = body[key];
    if (isObject(instruction)) collectContent(texts, instruction.parts, "/" + key + "/parts", "system");
  }
  // Tool names, descriptions and parameter schemas, in every format.
  pushJSON(texts, body.tools, "/tools");
  if (format === "openai_responses") {
    for (const key of RESPONSES_JSON_KEYS) pushJSON(texts, body[key], "/" + key);
  }
  // Gemini embedding requests: one content, or a batch of requests.
  if (isObject(body.content)) collectContent(texts, body.content.parts, "/content/parts", body.content.role || "");
  if (Array.isArray(body.requests)) {
    for (let i = 0; i < body.requests.length; i++) {
      const request = body.requests[i];
      if (isObject(request) && isObject(request.content)) collectContent(texts, request.content.parts, "/requests/" + i + "/content/parts", request.content.role || "");
    }
  }
  pushText(texts, body.query, "/query");
  if (Array.isArray(body.documents)) {
    for (let i = 0; i < body.documents.length; i++) pushJSON(texts, body.documents[i], "/documents/" + i);
  }
  for (const key of TASK_TEXT_KEYS) collectContent(texts, body[key], "/" + key);
  if (isObject(body.input)) {
    collectContent(texts, body.input.prompt, "/input/prompt");
    pushText(texts, body.input.negative_prompt, "/input/negative_prompt");
    if (Array.isArray(body.input.messages)) {
      for (let i = 0; i < body.input.messages.length; i++) {
        const message = body.input.messages[i];
        const path = "/input/messages/" + i;
        if (isObject(message)) collectContent(texts, message.content, path + "/content", message.role || "");
      }
    }
  }
  if (isObject(body.parameters)) pushText(texts, body.parameters.negative_prompt, "/parameters/negative_prompt");
  if (Array.isArray(body.instances)) {
    for (let i = 0; i < body.instances.length; i++) {
      const instance = body.instances[i];
      if (isObject(instance)) pushText(texts, instance.prompt, "/instances/" + i + "/prompt");
    }
  }
  if (Array.isArray(body.content)) collectContent(texts, body.content, "/content");
  return texts;
}

// Go-style patterns often start with (?i); JavaScript takes it as a flag.
function compileRule(rule, id) {
  const caseSensitive = rule.caseSensitive === true;
  if (rule.type !== "regex") {
    return {
      id: id,
      keyword: caseSensitive ? rule.pattern : rule.pattern.toLowerCase(),
      caseSensitive: caseSensitive,
    };
  }
  let source = rule.pattern;
  let insensitive = !caseSensitive;
  if (source.startsWith("(?i)")) {
    source = source.slice(4);
    insensitive = true;
  }
  try {
    return { id: id, regex: new RegExp(source, insensitive ? "i" : "") };
  } catch {
    throw new Error('Rule "' + id + '" has an invalid regular expression');
  }
}

// A rule without an id is named by its position in the list: rule-1, rule-2.
function compileRules(config) {
  const rules = config.rules || [];
  const compiled = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (isObject(rule) && rule.pattern) compiled.push(compileRule(rule, rule.id || "rule-" + (i + 1)));
  }
  return compiled;
}

// Evidence describes the representation actually examined by the matcher.
// Case folding and normalization can change offsets; never label those bytes
// as original input. Keep the decisive hit only, independent of input length.
function matchEvidence(source, text, start, length, method, representation) {
  const before = Array.from(text.slice(Math.max(0, start - 602), start));
  const hit = Array.from(text.slice(start, start + Math.min(length, 514)));
  const after = Array.from(text.slice(start + length, start + length + 602));
  return {
    path: source.path, role: source.role, method, representation,
    serialized: source.serialized,
    before: before.slice(-300).join(""), match: hit.slice(0, 256).join(""),
    after: after.slice(0, 300).join(""),
    truncated: before.length > 300 || hit.length > 256 || after.length > 300,
    matchTruncated: hit.length > 256,
  };
}

function hasKeywords(config) {
  return isObject(config.keywords) && config.keywords.count > 0;
}

function firstMatch(config, rules, sources, capture = false) {
  const texts = sources.map((source) => config.normalizeText === true
    ? source.text.normalize("NFKC").replace(/[\u200B-\u200F\u2060\uFEFF]/g, "") : source.text);
  const lowered = texts.map((text) => text.toLowerCase());
  for (const rule of rules) {
    for (let i = 0; i < texts.length; i++) {
      const text = rule.regex || rule.caseSensitive ? texts[i] : lowered[i];
      const match = rule.regex ? rule.regex.exec(text) : null;
      const start = rule.regex ? (match ? match.index : -1) : text.indexOf(rule.keyword);
      if (start < 0) continue;
      const result = { ruleId: rule.id };
      if (capture) result.evidence = matchEvidence(sources[i], text, start,
        rule.regex ? match[0].length : rule.keyword.length, rule.regex ? "regex" : "keyword",
        text === sources[i].text ? "original" : "transformed");
      return result;
    }
  }
  if (hasKeywords(config) && texts.length > 0) {
    const found = utils.keywords("keywords", texts.join("\n"), { caseSensitive: config.keywordsCaseSensitive === true });
    if (found.length > 0) {
      const result = { ruleId: "keywords" };
      if (capture) {
        // Ask the same host matcher for each source; its Unicode folding may
        // differ from JavaScript. Only highlight when the returned word can
        // actually be located in the representation shown.
        for (let i = 0; i < texts.length; i++) {
          const words = utils.keywords("keywords", texts[i], { caseSensitive: config.keywordsCaseSensitive === true });
          if (!words.length) continue;
          const text = config.keywordsCaseSensitive === true ? texts[i] : lowered[i];
          const word = config.keywordsCaseSensitive === true ? words[0] : words[0].toLowerCase();
          const start = text.indexOf(word);
          if (start >= 0) result.evidence = matchEvidence(sources[i], text, start, word.length, "keyword_list", text === sources[i].text ? "original" : "transformed");
          break;
        }
      }
      return result;
    }
  }
  return null;
}

// The text of the request's documents: text, PDF and DOCX files, as far as
// the host reads them. Images, and files the request only names by id or
// URL, are not read.
function attachmentTexts() {
  const texts = [];
  for (const attachment of utils.attachments()) {
    if (!attachment.ref || attachment.kind !== "document") continue;
    const read = utils.mediaText(attachment.ref);
    if (read && typeof read.text === "string") pushText(texts, read.text, attachment.path || attachment.ref, "attachment");
  }
  return texts;
}

// check reads the attachments only when the text passed, and only when
// asked: at ingress.
function check(ctx, req, attachments) {
  const config = ctx.config || {};
  const rules = compileRules(config);
  if (rules.length === 0 && !hasKeywords(config)) return { action: "continue" };
  let hit = firstMatch(config, rules, collectTexts(req.body, ctx.format), ctx.captureEvidence === true);
  if (!hit && attachments) hit = firstMatch(config, rules, attachmentTexts(), ctx.captureEvidence === true);
  if (!hit) return { action: "continue" };
  const result = { action: "reject", code: "request_filtered", ruleId: hit.ruleId };
  if (hit.evidence) result.evidence = hit.evidence;
  if (config.message) result.message = config.message;
  return result;
}

// Runs when an instance is saved, so a rule that cannot compile is refused
// there instead of failing every request.
export function validateConfig(config) {
  compileRules(config || {});
}

export function ingress(ctx, req) {
  return check(ctx, req, true);
}

// The final body may carry text added after ingress, such as a channel's
// parameter override. Attachments are as ingress read them.
export function egress(ctx, req) {
  return check(ctx, req, false);
}

// A regular expression can match text of any length; a stream holds back
// this much text for it.
const REGEX_HOLD = 256;

// A stream holds back enough text for the longest keyword to be found when
// it is split across two chunks.
function replyHold(config, rules) {
  let hold = hasKeywords(config) ? config.keywords.longest - 1 : 0;
  for (const rule of rules) hold = Math.max(hold, rule.regex ? REGEX_HOLD : rule.keyword.length - 1);
  return hold;
}

// With replies checked, a reply that matches a rule or the keyword list is
// stopped.
export function reply(ctx, res) {
  const config = ctx.config || {};
  if (config.replies !== true) return { action: "pass" };
  const rules = compileRules(config);
  if (rules.length === 0 && !hasKeywords(config)) return { action: "pass" };
  for (const output of res.outputs) {
    if (output.text === "") continue;
    const hit = firstMatch(config, rules, [{ text: output.text }]);
    if (!hit) continue;
    const result = { action: "stop", code: "request_filtered", findings: [{ rule: hit.ruleId, count: 1 }] };
    if (config.message) result.message = config.message;
    return result;
  }
  return { action: "continue", hold: res.stream ? replyHold(config, rules) : 0 };
}
