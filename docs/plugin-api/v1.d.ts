export type JSONValue = null | boolean | number | string | readonly JSONValue[] | {readonly [key: string]: JSONValue};
export type HostCapability = "json-clone@1" | "submit-sse-delta@1" | "json-order@1" | "keyword-policy@1" | "user-allowlist@1";
/** Kinds of upstream a driver can address: the vendor API itself, or another New API gateway with the same plugin installed. */
export type UpstreamKind = "vendor" | "new_api";
/** Host-injected on every driver hook context. With "new_api" the driver uses its own native-route prefix and the host already set Bearer credentials. */
export interface UpstreamContext {kind: UpstreamKind}
export type MutableJSON<T> = T extends readonly (infer Item)[] ? MutableJSON<Item>[] : T extends object ? {-readonly [Key in keyof T]: MutableJSON<T[Key]>} : T;
export interface HostUtils {
  hasCapability(name: string): boolean;
  /** Independent native JS containers; at most 1 MiB encoded JSON, depth 32 and 32,768 nodes. */
  json: {clone<T extends JSONValue>(value: T): MutableJSON<T>};
  unixNow(): number;
  uuid(): string;
  /** A string is its UTF-8 bytes, a buffer or view its bytes; each argument is at most 64 MiB. The encoding defaults to hex; bytes returns an ArrayBuffer. */
  sha256(data: SigningInput, encoding?: DigestEncoding): string | ArrayBuffer;
  /** hmacSHA256(message, secret) with two strings returns the hex digest. A bytes result can key the next call, as AWS SigV4 and Tencent Cloud TC3 derive their keys. */
  hmacSHA256(message: SigningInput, key: SigningInput, encoding?: DigestEncoding): string | ArrayBuffer;
  /** RSASSA-PKCS1-v1_5 with SHA-256 (JWT RS256) with a PEM PRIVATE KEY or RSA PRIVATE KEY block of at most 16 KiB. The encoding defaults to base64url. */
  signRS256(data: SigningInput, privateKeyPem: string, encoding?: DigestEncoding): string | ArrayBuffer;
  jwtSignHS256(claims: Record<string, JSONValue>, secret: string): string;
  base64(value: string): string;
  base64URL(value: string): string;
  base64URLDecode(value: string): string;
  volcSignV4(request: {method: string; url: string; headers?: Record<string, string>; body?: string; accessKey: string; secretKey: string; region?: string; service?: string; timestamp?: number}): Record<string, string>;
  /** Synchronous request. This host exposes fetch to request-processing hooks only. ingress, egress, reply and report address allowedHosts and the hosts of the instance's url config values, and may POST. At most 4 per hook call, 15 s each, 30 s in total, 1 MiB per body; redirects are returned, not followed. In a stage hook, each JSON string value of body that equals a "[media:N]" ref of the call is sent as that file's data URL, streamed from the request: at most 8 refs and 32 MiB of file data per body. */
  fetch(request: FetchRequest): FetchResponse;
  /** new-api only: outbound hooks only, runs the new-api channel parameter override language on body, with conditions reading ctx. A return_error operation comes back as reject. On a host without it, it is missing or throws "utils.paramOverride is not available on this host". */
  paramOverride?(body: Readonly<Record<string, JSONValue>>, override: Readonly<Record<string, JSONValue>>): {body: Record<string, JSONValue>; headers?: {set?: Record<string, string>; remove?: string[]}} | {reject: {code: string; message: string}};
  /** Stage hooks only: the request's files in body order, then the file parts of a form body. The host never downloads a file the request only names. */
  attachments(): Attachment[];
  /** Stage hooks only: null for a string that is not a ref of the call. */
  media(ref: string): MediaInfo | null;
  /** Stage hooks only: the text of a text, PDF or DOCX file, read once per request, with the hook's clock stopped. maxChars is 1 to 131072 (the default) UTF-16 code units. null for a string that is not a ref of the call. */
  mediaText(ref: string, options?: {maxChars?: number}): {text: string; truncated: boolean} | {unchecked: MediaTextUnchecked} | null;
  /** Stage hooks, reply and report: the distinct keywords of the instance config property field (format "keywords") that text contains, as the list spells them, in the order they end in text, at most 32. Letter case is ignored unless caseSensitive is true. */
  keywords(field: string, text: string, options?: {caseSensitive?: boolean}): string[];
  /** Validates a rule array using the native policy compiler; available during validateConfig. */
  validateKeywordPolicy(rules: readonly KeywordPolicyRule[]): void;
  /** Request-processing hooks only. Uses the instance config field, scans text once and returns its first decisive occurrence. Offsets are original UTF-8 bytes, not JS string indices. */
  keywordPolicy(field: string, text: string): {ruleId: string; start: number; end: number; evidence?: TransformMatchEvidence} | null;
}
/** Keyword strings and exception phrases use one literal per line. All nonempty RE2 conditions must match. Exceptions only exempt the occurrences their literal span contains. */
export interface KeywordPolicyRule {id?: string; keywords: string; exceptions?: string; before?: string; after?: string; context?: string; window?: number; caseSensitive?: boolean}
/** A file of the request. ref ("[media:N]") names inline media and form files, size is then its decoded size in bytes; a file the request names by file id, file URL or remote URL has none, and url holds its URL when the body gives one. path is its JSON Pointer in req.body, or the field name of a form file. rewritable marks a text file of the JSON body that media.text can rewrite. mime is "" when the request does not say. */
export interface Attachment {ref?: string; kind: AttachmentKind; mime: string; size?: number; filename?: string; url?: string; path: string; rewritable?: true}
export type AttachmentKind = "image" | "document" | "audio" | "video" | "other";
/** width and height are given for an image the host decodes. */
export interface MediaInfo {kind: AttachmentKind; mime: string; size: number; filename?: string; width?: number; height?: number; rewritable?: true}
/** unsupported: a type without text, such as an image. no_text: no text in the file, such as a scanned PDF. too_large: a PDF or DOCX file over 10 MiB or over 3 s to read. unreadable: damaged, binary or encrypted. limit: the request's 524288 UTF-16 code units of attachment text are used up. busy: no turn among the two PDF or DOCX files read at a time within 5 s. */
export type MediaTextUnchecked = "unsupported" | "no_text" | "too_large" | "unreadable" | "limit" | "busy";
/** How ctx.config and validateConfig read a property of format "keywords": the number of distinct non-empty trimmed lines and the UTF-16 length of the longest. The list itself stays in the host; see utils.keywords. */
export interface KeywordsSummary {count: number; longest: number}
/** POST and body are available only in ingress, egress, reply and report, which always verify TLS. body is at most 1 MiB. */
export interface FetchRequest {url: string; method?: "GET" | "HEAD" | "POST"; headers?: Record<string, string>; body?: string; responseType?: "json" | "bytes"}
/** headers holds the first value of each header under its canonical name; body is parsed JSON when the response parses, otherwise text, and "" for HEAD; with responseType "bytes" it is an ArrayBuffer of the response bytes. */
export interface FetchResponse {status: number; headers: Record<string, string>; body: JSONValue | string | ArrayBuffer}
declare global {const utils: HostUtils;}
export type SigningInput = string | ArrayBuffer | ArrayBufferView;
/** Lowercase hex, padded base64, unpadded base64url, or an ArrayBuffer. */
export type DigestEncoding = "hex" | "base64" | "base64url" | "bytes";
export type FileReference = Readonly<{ref: string; field: string; filename: string; mimeType: string; size: number}>;
export type FilePlaceholder = Readonly<{__fileRef: string; encoding: "base64" | "dataUrl"; mimeType?: string; maxBytes?: number}>;
export type DecodedBody =
  | Readonly<{kind: "json"; value: JSONValue}>
  | Readonly<{kind: "form"; fields: Readonly<Record<string, readonly string[]>>}>
  | Readonly<{kind: "multipart"; fields: Readonly<Record<string, readonly string[]>>; files: readonly FileReference[]}>
  | Readonly<{kind: "none"}>;

export interface NativeDecodeContext {method: string; path: string; params: Readonly<Record<string, string>>; query: Readonly<Record<string, readonly string[]>>; body: DecodedBody}
export interface ProtocolDecodeContext extends NativeDecodeContext {protocol: ProtocolName; operation: string; model: string; upstreamModel?: string; stream: boolean}
export type SubmitIntent = {kind: "submit"; model: string; action?: string; requestBody?: unknown; originTaskIds?: readonly string[]};
export type QueryIntent = {kind: "query"; taskIds: readonly string[]};
export type TaskIntent = SubmitIntent | QueryIntent;
export interface NativeRoute {method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; type: "submit" | "query" | "dynamic"; action?: string; taskIdParam?: string; decode?: string; render: string; models?: readonly string[]; retainResult?: boolean}
export type ProtocolName = "openai_responses" | "openai_video" | "openai_image";
export type ResponsesMode = "stream" | "sync" | "background";
export type ProtocolClaim =
  | "openai_video"
  | "openai_image"
  | {name: "openai_responses"; supports: readonly ResponsesMode[]; models?: readonly string[]}
  | {name: "openai_video"; models?: readonly string[]}
  | {name: "openai_image"; models?: readonly string[]};
/** One entry of the OpenAI ImageResponse `data` array rendered by protocols.openai_image.render. */
export type ImageResponseEntry = {url?: string; b64_json?: string; revised_prompt?: string};
export type LocalizedText = string | ({ en: string } & Record<string, string>);
export type UsageFieldSchema =
  | {type: "number"; unit: "count"; unitLabel?: LocalizedText; description?: LocalizedText}
  | {type: "number"; unit: "second" | "token" | "credit"; unitLabel?: never; description?: LocalizedText}
  | {type: "boolean"; unitLabel?: never; description?: LocalizedText}
  | {enum: readonly string[]; unitLabel?: never; description?: LocalizedText; enumLabels?: Readonly<Record<string, LocalizedText>>};
export type UsageExample = {label: string; facts: Readonly<Record<string, string | number | boolean>>};
export type UsageProfile = {models: readonly string[]; schema: Readonly<Record<string, UsageFieldSchema>>; examples?: readonly UsageExample[]};
export interface TransformScope { models?: readonly string[]; channelTypes?: readonly number[] }
export interface Meta { scope?: TransformScope; requiredCapabilities?: readonly HostCapability[]; submitResponseTypes?: readonly ("json" | "sse")[]; sortPriority?: number; website?: string; apiVersion: 1; key: string; name: LocalizedText; icon?: string; description?: LocalizedText; version: string; author: {name: string; url?: string}; baseUrl?: string; channelTypes?: readonly number[]; models?: readonly string[]; fetchMode?: "per_task" | "batch"; allowedHosts?: readonly string[]; upstreams?: readonly UpstreamKind[]; routes?: readonly NativeRoute[]; protocols?: readonly ProtocolClaim[]; usageSchema?: Readonly<Record<string, UsageFieldSchema>>; usageExamples?: readonly UsageExample[]; usageProfiles?: readonly UsageProfile[]; auth?: "none" | "api_key" | "vertex_oauth" | {type: "none" | "api_key" | "oauth2_jwt"}; configSchema?: ConfigSchema; optional?: boolean; samples?: readonly Sample[]}
export interface TaskView {task_id: string; status: string; progress?: string; fail_reason?: string; created_at?: number; updated_at?: number; data?: unknown; properties?: Record<string, unknown>}
export interface DriverContext {requestBody: unknown; requestHeaders: Readonly<Record<string, string>>; action: string; model: string; upstreamModel: string; baseUrl: string; apiKey?: string; authHeader: string; upstream: UpstreamContext; files: readonly FileReference[]; publicTaskId: string; originTasks?: readonly {taskId: string; upstreamTaskId: string; action: string; status: string; data: unknown}[]}
export interface TaskQueryContext {taskId: string; publicTaskId: string; action: string; model: string; upstreamModel: string; baseUrl: string; apiKey?: string; authHeader: string; auth?: unknown; upstream: UpstreamContext; data: unknown; state: unknown}
export interface BatchQueryContext {baseUrl: string; apiKey?: string; authHeader: string; auth?: unknown; upstream: UpstreamContext; tasks: readonly TaskQueryContext[]}
export type HookHTTPResponse = {readonly status: number; readonly headers: Readonly<Record<string, string>>}
export interface RequestDescriptor {responseType?: "json" | "sse"; url: string; method?: string; headers?: Record<string, string>; /** JSON body may contain FilePlaceholder objects at any depth; the host replaces each with a Base64 or data-URL string. */ body?: unknown; credentialless?: boolean; action?: string; model?: string; rewriteModel?: string; bodyType?: "json" | "multipart"; parts?: readonly {name: string; value?: unknown; fileRef?: string; filename?: string}[]}
export interface UpstreamResponse {statusCode: number; headers: Readonly<Record<string, readonly string[]>>; body: unknown}
export interface NormalizedTaskResult {taskId?: string; status: "NOT_START" | "SUBMITTED" | "QUEUED" | "IN_PROGRESS" | "SUCCESS" | "FAILURE" | "UNKNOWN"; progress?: string; reason?: string; url?: string; remoteUrl?: string; completionTokens?: number; totalTokens?: number}
export interface TaskArtifact {key: string; type: "video" | "audio" | "image" | "file"; mimeType?: string}
export declare const meta: Meta;
export declare const native: Record<string, ((ctx: NativeDecodeContext) => TaskIntent) | ((ctx: NativeDecodeContext, task: TaskView | readonly TaskView[]) => unknown)> & {error?: (ctx: NativeDecodeContext, error: {code: string; message: string; httpStatus: number; retryable: boolean}) => unknown};
export declare const protocols: {
  openai_responses?: {decodeRequest(ctx: ProtocolDecodeContext): SubmitIntent; renderEvents?(ctx: unknown, task: TaskView, previousState: unknown): unknown; renderFinal?(ctx: unknown, task: TaskView): unknown};
  openai_video?: {decodeRequest(ctx: ProtocolDecodeContext): SubmitIntent; render(ctx: unknown, task: TaskView): unknown};
  /** render returns the OpenAI ImageResponse; the host adds `created` when absent and resolves response_format b64_json. */
  openai_image?: {decodeRequest(ctx: ProtocolDecodeContext): SubmitIntent; render(ctx: unknown, task: TaskView): {created?: number; data: readonly ImageResponseEntry[]} & Record<string, unknown>};
};
export declare function buildSubmitRequest(ctx: DriverContext): RequestDescriptor;
export interface SubmitEvent {event: string; id: string; data: string}
export type JSONPath = readonly (string | number)[];
export type JSONChange =
  | {op: "set" | "append"; path: JSONPath; value: JSONValue}
  | {op: "appendText"; path: JSONPath; value: string};
export interface SubmitEventDeltaResult {changes: readonly JSONChange[]; state: JSONValue; done: boolean}
/** With submit-sse-delta@1, state is small control data; changes build the separate response body. */
export declare function parseSubmitEventDelta(ctx: DriverContext, event: SubmitEvent, previousState: JSONValue | null): SubmitEventDeltaResult;
export declare function parseSubmitEvent(ctx: DriverContext, event: SubmitEvent, previousState: JSONValue | null): {state: JSONValue; done: boolean};
export declare function parseSubmitResponse(ctx: DriverContext, response: UpstreamResponse): {taskId: string; taskData?: unknown; immediate?: NormalizedTaskResult; state?: unknown};
export declare function buildQueryRequest(ctx: TaskQueryContext): RequestDescriptor;
export declare function buildBatchQueryRequest(ctx: BatchQueryContext, tasks: readonly TaskQueryContext[]): RequestDescriptor;
export declare function parseTaskResult(ctx: TaskQueryContext, body: unknown, response: HookHTTPResponse): NormalizedTaskResult;
export declare function parseBatchResult(ctx: BatchQueryContext, body: unknown, response: HookHTTPResponse): readonly (NormalizedTaskResult & {taskId: string; data?: unknown; state?: unknown})[];
export declare function extractUsage(ctx: DriverContext & {usagePurpose?: "facts" | "billing_ratios"}): Readonly<Record<string, string | number | boolean>> | null;
export declare function extractUsageOnSubmit(ctx: DriverContext, taskData: unknown): Readonly<Record<string, string | number | boolean>> | null;
export declare function extractUsageOnComplete(task: TaskQueryContext, result: NormalizedTaskResult, data: unknown): Readonly<Record<string, string | number | boolean>> | null;
export declare function listArtifacts(task: {taskId: string; status: string; action: string; data: unknown; producerVersion: string}): readonly TaskArtifact[];
export declare function buildContentRequest(ctx: DriverContext & {artifactKey: string; data: unknown; state?: unknown; upstreamTaskId: string; clientRequest: {method: "GET" | "HEAD"; headers: Readonly<Record<string, string>>}}): RequestDescriptor;

export type RelayFormat = "openai" | "openai_responses" | "openai_responses_compaction" | "claude" | "gemini" | "embedding" | "rerank" | "openai_image" | "openai_audio" | "openai_realtime" | "openai_alpha_search" | "deepseek_tools" | "task" | "mj_proxy";

/** One field of an instance config: a JSON Schema subset. title is required; nesting is at most 4 levels; unit, visibleWhen and every format but url are form hints that never change the check, the defaults or the config. A non-empty url value must be an absolute http(s) URL without credentials or fragment, and its host is one utils.fetch may address in ingress, egress, reply and report; password marks a secret the form hides. The form shows a slider for an integer field whose minimum and maximum are both set and at most 100 apart. */
export interface ConfigField {type: "string" | "number" | "integer" | "boolean" | "array" | "object"; title: LocalizedText; description?: LocalizedText; default?: JSONValue; examples?: readonly JSONValue[]; enum?: readonly (string | number)[]; enumTitles?: readonly LocalizedText[]; minimum?: number; maximum?: number; /** number and integer fields: byte values get a KB/MB choice (1000-based, stored in bytes), the others a suffix. */ unit?: "byte" | "pixel" | "character" | "second"; minLength?: number; maxLength?: number; /** RE2 regular expression. */ pattern?: string; /** string: textarea, regex, url, password, keywords (a property of the schema itself only); object: json. */ format?: "textarea" | "regex" | "url" | "password" | "keywords" | "json"; items?: ConfigField; minItems?: number; maxItems?: number; uniqueItems?: boolean; properties?: Readonly<Record<string, ConfigField>>; required?: readonly string[]; /** A property only, not an items field: shown while every named sibling property (string, number, integer or boolean) holds one of the listed values. Values must be valid for that sibling; lists are non-empty without repeats. API responses always write lists. */ visibleWhen?: Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[]>>}
/** The schema of a request processing instance's config. Without it the config is {}. */
export interface ConfigSchema {type: "object"; properties: Readonly<Record<string, ConfigField>>; required?: readonly string[]}

/** A sample request: text only. A string that starts with data:, is 100 or more characters of only base64 letters, is a URL as a whole or holds "[media:N]", and an object with inlineData, inline_data, fileData or file_data, with data next to media_type, mimeType or mime_type, or with type "base64", fail the load. "[sample-image]" as a whole element of a content or parts array stands for an image the settings supply; anywhere else it fails the load. */
export interface Sample {
  /** At most 64 characters per locale. */
  name: LocalizedText;
  /** Base language of the text, such as "en" or "zh"; absent for any language. */
  lang?: string;
  format: "openai" | "openai_responses" | "claude" | "gemini";
  /** A request body in format, at most 16 KB as JSON. */
  body: Readonly<Record<string, JSONValue>>;
  /** An answer text of at most 4 KB, for trying a reply hook. */
  reply?: string;
}

/** json.patch is an RFC 6902 patch. Effects cannot change billing members or protected headers, and the host applies all of them or none. */
export type RequestEffect =
  | {type: "json.patch"; ops: readonly ({op: "add" | "replace" | "test"; path: string; value: JSONValue} | {op: "remove"; path: string} | {op: "move" | "copy"; path: string; from: string})[]}
  | {type: "header.patch"; set?: Readonly<Record<string, string>>; remove?: readonly string[]};

export type TransformStage = "ingress" | "request" | "outbound" | "egress";
/** ctx of the stage hooks, of reply and of report. config is the instance config with the schema defaults applied. format is "task" on task submissions ("openai_responses" or "openai_image" at ingress when a task plugin serves those APIs) and "mj_proxy" on Midjourney submissions. In a Realtime session, format is "openai_responses" at ingress and "openai_realtime" in reply and report, path is "/v1/realtime", and channel is set from ingress on. upstreamModel and channel are set from request on, and in the late ingress of an instance the channel binds or of a group settled at channel selection, which runs on each attempt before outbound, on the upstream body (on a task submission, on the client body before the attempt is priced). In reply, format is the client's format. In report they are those of the last attempt, absent when the request reached no channel. user and token are those of the report record; token is absent without one. In a dry run, user is the administrator and there is no token. */
export interface TransformContext {
  /** Return private rejection evidence only when true. */
  captureEvidence?: boolean;stage: TransformStage | "reply" | "report"; /** The protocol name of req.body. A hook returns continue for a name it does not handle. */ format: RelayFormat | (string & {}); path: string; model: string; upstreamModel?: string; /** new-api only. */ group?: string; /** new-api only. */ channel?: {id: number; type: number}; attempt: number; /** new-api only. */ user?: {id: number; username: string}; /** new-api only. */ token?: {id: number; name: string}; instance: {id: string; name: string}; /** A property of format "keywords" reads as a KeywordsSummary. */ config: Readonly<Record<string, JSONValue>>}
/** An inline image of req.body, which holds "[media:<index>]" in its place. path is its JSON Pointer; bytes is its decoded size; width and height are given at outbound only. */
export interface TransformMedia {index: number; path: string; mimeType: string; bytes: number; width?: number; height?: number}
/** headers: outbound and egress, the headers earlier instances of the attempt set with header.patch. summary: request only; reasoningEffort is "" when the client and the model modifiers set none. form: ingress, set when body is the text fields of a multipart form body, each a string or, for a repeated field, an array of strings; its only effects are json.patch replace operations that set a field to a string, and media.text, which leaves a form file as it is. */
export interface TransformRequest {body: JSONValue; headers?: Readonly<Record<string, string>>; media?: readonly TransformMedia[]; summary?: {messageCount: number; toolCount: number; lastUserTextLength: number; totalTextLength: number; hasImages: boolean; reasoningEffort: string}; form?: true}
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
/** ingress: json.patch, keeping model and stream, and media.text. request: reasoning.set. outbound: json.patch (keeping the billing members), header.patch, media.reencode and media.text. egress: none. */
export type TransformEffect =
  | RequestEffect
  | {type: "reasoning.set"; effort: ReasoningEffort; override?: boolean}
  /** Replaces the text of a rewritable text file with text (UTF-8, at most 1 MiB). On another file of the call, or a text file the hook read in part, it changes nothing and the log shows the file unchecked with reason not_rewritable. */
  | {type: "media.text"; media: number; text: string}
  | {type: "media.reencode"; media: number; format: "auto" | "jpeg" | "png"; quality?: number; maxSide?: number}
  /** Lossless WebP; it takes no quality. */
  | {type: "media.reencode"; media: number; format: "webp"; maxSide?: number};
/** What matched, by rule and count, never the matched text. rule, category and path are at most 256 characters. */
export interface TransformFinding {rule: string; category?: string; path?: string; count: number}
/** At most 64 findings. code matches ^[a-z0-9_.-]{1,64}$; message and ruleId are at most 256 characters. notice is shown to the user in the log as it is: at most 8 locales of at most 200 characters. */
/** Private plugin-reported decisive hit, at most 8 KiB encoded. Original or transformed matcher text, never public log data. */
export interface TransformMatchEvidence {
 path: string; role: string; method: "keyword" | "regex" | "keyword_list";
 representation: "original" | "transformed"; serialized: boolean;
 before: string; match: string; after: string; truncated: boolean; matchTruncated: boolean;
}
export type TransformResult =
  | {action: "continue"; effects?: readonly TransformEffect[]; findings?: readonly TransformFinding[]; notice?: LocalizedText}
  | {action: "reject"; evidence?: TransformMatchEvidence; code: string; message?: string; ruleId?: string; findings?: readonly TransformFinding[]; notice?: LocalizedText};
/** Optional. Runs when an instance is saved, after the schema check, on the config with its defaults ({} without a configSchema), a property of format "keywords" read as a KeywordsSummary. A throw refuses the config with its message, cut to 256 characters; the return value is ignored. utils.fetch and utils.paramOverride throw here. */
export declare function validateConfig(config: Readonly<Record<string, JSONValue>>): void;
/** May call utils.fetch, as egress may. */
export declare function ingress(ctx: TransformContext, req: TransformRequest): TransformResult;
export declare function request(ctx: TransformContext, req: TransformRequest): TransformResult;
/** Runs on each attempt before the channel parameter override and header override, which win. */
export declare function outbound(ctx: TransformContext, req: TransformRequest): TransformResult;
/** Runs on each attempt after the channel parameter override, on the body sent upstream. */
export declare function egress(ctx: TransformContext, req: TransformRequest): TransformResult;
/** One answer of a reply check: a Chat Completions choice, a Responses output_text part, a Claude text block or a Gemini candidate. text is what the instance has not released: the text it held back, then the new text. offset counts the UTF-16 code units of the output it released before. final is set on the last call of the output. */
export interface ReplyOutput {index: number; text: string; offset: number; final: boolean}
/** A mask is a span of the text of an output of the call, in UTF-16 code units, 0 <= start < end <= text.length; at most 1024. Overlapping masks merge, and each span becomes "***"; category counts as a finding. hold (0 to 8192, default 0) keeps the last hold code units of each output for the next call; a mask across that point is released whole, and a final output is released whole. stop ends the answer: HTTP 400 response_rejected, or an error event in a stream. */
export type ReplyResult =
  | {action: "continue"; mask?: readonly {index: number; start: number; end: number; category?: string}[]; hold?: number; findings?: readonly TransformFinding[]; notice?: LocalizedText}
  /** Lets the rest of this answer through: the instance is not called again for it, and the text it held passes on unchanged. The logs show it as continue. */
  | {action: "pass"}
  | {action: "stop"; code: string; message?: string; findings?: readonly TransformFinding[]; notice?: LocalizedText};
/** Reads the assistant's answer text on Chat Completions, Responses, Claude Messages and Gemini generateContent and streamGenerateContent, and on Responses WebSocket and Realtime sessions, before the client gets it; a Realtime audio transcript is read only, so a mask on it stops the response; reasoning, tool calls, refusals, images, audio and annotations pass unread. A stream calls it on an output's first text, then when the output gained 32 UTF-16 code units, when an output ends and when an event without text arrives behind unread text; a non-stream answer once, with every output final. Once every instance passed or was skipped, no more JavaScript runs for the answer. Instances run as a pipeline, each on what the previous released. May call utils.fetch. */
export declare function reply(ctx: TransformContext, res: {stream: boolean; outputs: readonly ReplyOutput[]}): ReplyResult;
/** One finished request. request.body is the client body after ingress, null when it is not JSON. The response keeps its first 1 MiB: body for a non-stream response (JSON as its value, other text as a string, binary left out, left out when truncated), events for a stream (whole events, [DONE] and comments left out). usage is absent when nothing was billed; quota is 0 when nothing was charged. error is the error the client received. requestPlugins holds the entries of other.request_plugins. A WebSocket or Realtime response has stream true, contentType "" and the events the client received; Realtime has a null request.body and leaves audio deltas out. A task has task instead of response. */
export interface ReportRecord {
  requestId: string;
  /** new-api only. */
  user?: {id: number; username: string};
  /** new-api only. */
  token?: {id: number; name: string};
  /** Unix milliseconds. */
  startedAt: number;
  durationMs: number;
  /** Absent when no response bytes were sent. */
  firstResponseMs?: number;
  request: {body: JSONValue | null; media?: readonly TransformMedia[]};
  /** Absent for a task. */
  response?: {status: number; contentType: string; stream: boolean; body?: JSONValue; events?: readonly {event?: string; data: JSONValue}[]; bytes: number; truncated: boolean};
  usage?: {promptTokens: number; completionTokens: number} & Readonly<Record<string, number>>;
  cost: {quota: number; usd: number};
  error?: {status: number; code: string | number | null; type: string; message: string};
  requestPlugins: readonly JSONValue[];
  /** A task at its final state. result lists the http and https URLs (at most 32, the task's result URL first) and the other strings with their dotted paths (at most 256, 1 MiB); data URLs and base64 data are left out, and truncated marks a cut. */
  task?: {id: string; status: "SUCCESS" | "FAILURE"; reason?: string; /** Unix milliseconds. */ finishedAt: number; result: {urls: readonly string[]; texts: readonly {path: string; text: string}[]; truncated: boolean}};
}
/** Runs once per finished request (per response.create on a Responses WebSocket, per response.done in a Realtime session, and per task at its final state, from the instances that matched its submission), off the request path, for the plan's enabled global, group and last-attempt channel instances. Not a stage: the return value is ignored, and a throw, a timeout or a passed memory limit only writes a system log warning. Requests past the queue limits (256 requests, 64 MiB) are dropped. May call utils.fetch. */
export declare function report(ctx: TransformContext, record: ReportRecord): void;
