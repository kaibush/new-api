/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export type HomeMood = 'work' | 'loaf'

export type ProtocolId =
  | 'openai-chat'
  | 'openai-responses'
  | 'claude'
  | 'gemini'

export type SdkClientId = 'curl' | 'typescript' | 'python'

export type ProviderModalityId =
  | 'all'
  | 'chat'
  | 'image'
  | 'video'
  | 'audio'
  | 'cloud'

export interface TidalProtocolPreset {
  id: ProtocolId
  labelKey: string
  shortLabel: string
  endpoint: string
  defaultNodeId: string
}

export interface TidalUpstreamBuoy {
  id: string
  name: string
  iconKey: string
  accentLight: string
  accentDark: string
  sampleModel: string
  dutyKey: string
}

export interface CosmicLandmarkSpec {
  id: 'singularity' | 'dyson' | 'stargate' | 'pale-blue-dot'
  code: string
  shortTagKey: string
  labelKey: string
  whisperKey: string
  left: string
  top: string
  targetYaw: number
  targetPitch: number
  accentColor: string
  isHumanObserver?: boolean
}

export interface GatewaySpecItem {
  index: string
  value: number
  suffix?: string
  secondaryValue?: number
  labelKey: string
  detailKey: string
}

export interface WorkbenchProtocolSpec {
  id: ProtocolId
  nameKey: string
  badge: string
  method: 'POST'
  endpoint: string
  summaryKey: string
  bridgeNoteKey: string
  accent: 'jade' | 'gold' | 'coral' | 'indigo'
  headers: string[]
  modelSample: string
  responseLines: string[]
  usageSummaryKey: string
}

export interface ProviderSpecimen {
  id: string
  name: string
  iconKey: string
  category: Exclude<ProviderModalityId, 'all'>
  code: 'LLM' | 'IMG' | 'VID' | 'AUD' | 'CLOUD'
  capabilityKey: string
}

export interface ProviderRibbonItem {
  id: string
  name: string
  iconKey: string
}

export const TIDAL_PROTOCOLS: readonly TidalProtocolPreset[] = [
  {
    id: 'openai-chat',
    labelKey: 'Chat Completions',
    shortLabel: 'Chat',
    endpoint: '/v1/chat/completions',
    defaultNodeId: 'openai',
  },
  {
    id: 'openai-responses',
    labelKey: 'Responses API',
    shortLabel: 'Responses',
    endpoint: '/v1/responses',
    defaultNodeId: 'openai',
  },
  {
    id: 'claude',
    labelKey: 'Claude Messages',
    shortLabel: 'Claude',
    endpoint: '/v1/messages',
    defaultNodeId: 'claude',
  },
  {
    id: 'gemini',
    labelKey: 'Gemini Native',
    shortLabel: 'Gemini',
    endpoint: '/v1beta/models/{model}:generateContent',
    defaultNodeId: 'gemini',
  },
] as const

export const TIDAL_UPSTREAMS: readonly TidalUpstreamBuoy[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    iconKey: 'OpenAI',
    accentLight: '#0284c7',
    accentDark: '#38bdf8',
    sampleModel: 'gpt-5',
    dutyKey: 'Handling daily reasoning on autopilot',
  },
  {
    id: 'claude',
    name: 'Claude',
    iconKey: 'Claude.Color',
    accentLight: '#d97706',
    accentDark: '#fbbf24',
    sampleModel: 'claude-sonnet-4',
    dutyKey: 'Writing clean code while you stretch',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    iconKey: 'Gemini.Color',
    accentLight: '#6366f1',
    accentDark: '#a78bfa',
    sampleModel: 'gemini-2.5-pro',
    dutyKey: 'Digesting million-token docs calmly',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    iconKey: 'DeepSeek.Color',
    accentLight: '#0d9488',
    accentDark: '#2dd4bf',
    sampleModel: 'deepseek-reasoner',
    dutyKey: 'Deep thinking so your brain can rest',
  },
] as const

export const COSMIC_LANDMARKS: readonly CosmicLandmarkSpec[] = [
  {
    id: 'singularity',
    code: '1.0 Rs',
    shortTagKey: 'Singularity Core',
    labelKey: 'Gaze at the Singularity Core',
    whisperKey:
      'Event Horizon reports: 40+ star systems healthy—your sprint workload is cosmic dust, go steep a cup of tea.',
    left: '34%',
    top: '44%',
    targetYaw: -0.22,
    targetPitch: 0.36,
    accentColor: '#38bdf8',
  },
  {
    id: 'dyson',
    code: '3.8 Rs',
    shortTagKey: 'Dyson Ring',
    labelKey: 'Scan the Dyson Relay Ring',
    whisperKey:
      'Dyson Relay Ring reports: Token billing is settled to the micro-unit—zero Excel nights in this galaxy.',
    left: '13%',
    top: '63%',
    targetYaw: 0.38,
    targetPitch: 0.44,
    accentColor: '#fbbf24',
  },
  {
    id: 'stargate',
    code: '5.1 Rs',
    shortTagKey: 'Star-Gate',
    labelKey: 'Lock onto the Deep-Space Star-Gate',
    whisperKey:
      'Deep-Space Star-Gate reports: Async video & image jobs are polling across light-years in the background.',
    left: '56%',
    top: '21%',
    targetYaw: -0.44,
    targetPitch: 0.2,
    accentColor: '#a78bfa',
  },
  {
    id: 'pale-blue-dot',
    code: '10⁻²⁴',
    shortTagKey: 'You (On Break)',
    labelKey: 'Focus on tiny you on the Pale Blue Dot',
    whisperKey:
      'Pale Blue Dot Capsule: Across 93 billion light-years, 429 rate-limits vanish at the shield—float back and daydream.',
    left: '74%',
    top: '57%',
    targetYaw: 0.52,
    targetPitch: 0.14,
    accentColor: '#34d399',
    isHumanObserver: true,
  },
] as const

export const COSMIC_RADIO_WHISPERS: readonly string[] = [
  'Across 93 billion light-years of cosmos, your busywork is a single photon—let the gateway carry it.',
  'Upstream 429 solar flares deflect off the magnetosphere; your zero-G tea stays warm.',
  'Gravitational time dilation active: AI finished the refactor while you took one slow breath.',
  'Every API key is scoped and budgeted across orbits—drift off on time tonight.',
] as const

export const TIDAL_SPECS: readonly GatewaySpecItem[] = [
  {
    index: '01',
    value: 40,
    suffix: '+',
    labelKey: 'Upstreams on Autopilot',
    detailKey:
      'OpenAI, Anthropic, Google, DeepSeek, Bedrock, Azure & Qwen under one roof—no tab juggling',
  },
  {
    index: '02',
    value: 4,
    labelKey: 'Zero-Rewrite Protocols',
    detailKey:
      'Native Chat Completions, Responses, Claude Messages & Gemini—swap one URL and clock out',
  },
  {
    index: '03',
    value: 0,
    labelKey: 'Midnight Pager Alerts',
    detailKey:
      'Weighted priority pools isolate flaky channels and retry mid-flight while you rest',
  },
  {
    index: '04',
    value: 3,
    secondaryValue: 1,
    labelKey: 'Self-Hosted Data Engines',
    detailKey:
      'SQLite, MySQL & PostgreSQL primary stores plus ClickHouse high-throughput log analytics',
  },
] as const

export const WORKBENCH_PROTOCOLS: readonly WorkbenchProtocolSpec[] = [
  {
    id: 'openai-chat',
    nameKey: 'OpenAI Chat',
    badge: 'DROP-IN',
    method: 'POST',
    endpoint: '/v1/chat/completions',
    summaryKey:
      'Point any existing OpenAI SDK or agent tool here—done before your coffee cools',
    bridgeNoteKey:
      'Transparently dispatches to Claude, Gemini, Bedrock & 40+ upstreams',
    accent: 'jade',
    headers: ['Authorization: Bearer sk-••••••••'],
    modelSample: 'gpt-5',
    responseLines: [
      '{',
      '  "id": "chatcmpl-tidal-7f2a",',
      '  "object": "chat.completion",',
      '  "choices": [{',
      '    "message": {',
      '      "role": "assistant",',
      '      "content": "Sprint recap drafted. Go enjoy your afternoon tea."',
      '    }',
      '  }],',
      '  "usage": { "prompt_tokens": 18, "completion_tokens": 22, "total_tokens": 40 }',
      '}',
    ],
    usageSummaryKey: 'SSE Streaming · Exact Token Metering',
  },
  {
    id: 'openai-responses',
    nameKey: 'Responses API',
    badge: 'AGENTIC',
    method: 'POST',
    endpoint: '/v1/responses',
    summaryKey:
      'Structured outputs, reasoning traces, and tool calls while you lean back',
    bridgeNoteKey:
      'Full HTTP & WebSocket Responses support with reasoning item billing',
    accent: 'gold',
    headers: ['Authorization: Bearer sk-••••••••'],
    modelSample: 'gpt-5',
    responseLines: [
      '{',
      '  "id": "resp_tidal_81c0",',
      '  "object": "response",',
      '  "status": "completed",',
      '  "output": [{',
      '    "type": "message",',
      '    "content": [{ "type": "output_text", "text": "All upstream pools calm and green." }]',
      '  }],',
      '  "usage": { "input_tokens": 24, "output_tokens": 31, "total_tokens": 55 }',
      '}',
    ],
    usageSummaryKey: 'Tool Calls · Reasoning Tokens',
  },
  {
    id: 'claude',
    nameKey: 'Claude Messages',
    badge: 'ANTHROPIC',
    method: 'POST',
    endpoint: '/v1/messages',
    summaryKey:
      'Native Anthropic wire format for Claude Code, prompt caching & extended thinking',
    bridgeNoteKey:
      'Preserves thinking blocks, cache_control TTLs & native tool_use schemas',
    accent: 'coral',
    headers: ['x-api-key: sk-••••••••', 'anthropic-version: 2023-06-01'],
    modelSample: 'claude-sonnet-4-20250514',
    responseLines: [
      '{',
      '  "id": "msg_tidal_09ef",',
      '  "type": "message",',
      '  "role": "assistant",',
      '  "content": [{',
      '    "type": "text",',
      '    "text": "Prompt cache hit (-75%). Budget saved, mood relaxed."',
      '  }],',
      '  "usage": { "input_tokens": 14, "cache_read_input_tokens": 1024, "output_tokens": 29 }',
      '}',
    ],
    usageSummaryKey: 'Prompt Cache · Extended Thinking',
  },
  {
    id: 'gemini',
    nameKey: 'Gemini Native',
    badge: 'GOOGLE',
    method: 'POST',
    endpoint: '/v1beta/models/{model}:generateContent',
    summaryKey:
      'Direct Google GenAI & Vertex AI multimodal generation without credential sprawl',
    bridgeNoteKey:
      'Supports multimodal inputs, search grounding & native thinking budgets',
    accent: 'indigo',
    headers: ['x-goog-api-key: sk-••••••••'],
    modelSample: 'gemini-2.5-pro',
    responseLines: [
      '{',
      '  "candidates": [{',
      '    "content": {',
      '      "role": "model",',
      '      "parts": [{ "text": "Multimodal digest complete—zero manual babysitting." }]',
      '    }',
      '  }],',
      '  "usageMetadata": { "promptTokenCount": 16, "candidatesTokenCount": 21 }',
      '}',
    ],
    usageSummaryKey: 'Multimodal · Long Context',
  },
] as const

export const PROVIDER_CATEGORIES: readonly {
  id: ProviderModalityId
  labelKey: string
}[] = [
  { id: 'all', labelKey: 'All' },
  { id: 'chat', labelKey: 'Reasoning & Chat' },
  { id: 'image', labelKey: 'Image' },
  { id: 'video', labelKey: 'Video' },
  { id: 'audio', labelKey: 'Audio' },
  { id: 'cloud', labelKey: 'Cloud & Local' },
] as const

export const PROVIDER_SPECIMENS: readonly ProviderSpecimen[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    iconKey: 'OpenAI',
    category: 'chat',
    code: 'LLM',
    capabilityKey: 'Chat · Responses · Realtime',
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    iconKey: 'Claude.Color',
    category: 'chat',
    code: 'LLM',
    capabilityKey: 'Messages · Thinking · Cache',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    iconKey: 'Gemini.Color',
    category: 'chat',
    code: 'LLM',
    capabilityKey: 'Native API · Vision · Grounding',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    iconKey: 'DeepSeek.Color',
    category: 'chat',
    code: 'LLM',
    capabilityKey: 'Reasoning · Prefix Cache',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    iconKey: 'Qwen.Color',
    category: 'chat',
    code: 'LLM',
    capabilityKey: 'Multilingual · Coding · Vision',
  },
  {
    id: 'grok',
    name: 'Grok',
    iconKey: 'Grok',
    category: 'chat',
    code: 'LLM',
    capabilityKey: 'Reasoning · Live Context',
  },
  {
    id: 'midjourney',
    name: 'Midjourney',
    iconKey: 'Midjourney',
    category: 'image',
    code: 'IMG',
    capabilityKey: 'Imagine · Blend · Async Task',
  },
  {
    id: 'flux',
    name: 'Flux',
    iconKey: 'Flux',
    category: 'image',
    code: 'IMG',
    capabilityKey: 'High-Fidelity Image Synthesis',
  },
  {
    id: 'stability',
    name: 'Stability AI',
    iconKey: 'Stability.Color',
    category: 'image',
    code: 'IMG',
    capabilityKey: 'Diffusion · Edit · Upscale',
  },
  {
    id: 'kling',
    name: 'Kling',
    iconKey: 'Kling.Color',
    category: 'video',
    code: 'VID',
    capabilityKey: 'Text & Image-to-Video Tasks',
  },
  {
    id: 'vidu',
    name: 'Vidu',
    iconKey: 'Vidu.Color',
    category: 'video',
    code: 'VID',
    capabilityKey: 'Reference-Guided Video Pipeline',
  },
  {
    id: 'suno',
    name: 'Suno',
    iconKey: 'Suno',
    category: 'audio',
    code: 'AUD',
    capabilityKey: 'Music Generation · Async Settle',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    iconKey: 'Minimax.Color',
    category: 'audio',
    code: 'AUD',
    capabilityKey: 'Speech · Voice · Multimodal',
  },
  {
    id: 'bedrock',
    name: 'AWS Bedrock',
    iconKey: 'Bedrock.Color',
    category: 'cloud',
    code: 'CLOUD',
    capabilityKey: 'Enterprise Multi-Region Relay',
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    iconKey: 'Azure.Color',
    category: 'cloud',
    code: 'CLOUD',
    capabilityKey: 'Managed Deployment Routing',
  },
  {
    id: 'vertex',
    name: 'Vertex AI',
    iconKey: 'VertexAI.Color',
    category: 'cloud',
    code: 'CLOUD',
    capabilityKey: 'Google Cloud Claude & Gemini',
  },
] as const

export const PROVIDER_RIBBON_TOP: readonly ProviderRibbonItem[] = [
  { id: 'r-openai', name: 'OpenAI', iconKey: 'OpenAI' },
  { id: 'r-claude', name: 'Claude', iconKey: 'Claude.Color' },
  { id: 'r-gemini', name: 'Gemini', iconKey: 'Gemini.Color' },
  { id: 'r-deepseek', name: 'DeepSeek', iconKey: 'DeepSeek.Color' },
  { id: 'r-qwen', name: 'Qwen', iconKey: 'Qwen.Color' },
  { id: 'r-grok', name: 'Grok', iconKey: 'Grok' },
  { id: 'r-meta', name: 'Meta Llama', iconKey: 'Meta.Color' },
  { id: 'r-mistral', name: 'Mistral', iconKey: 'Mistral.Color' },
  { id: 'r-cohere', name: 'Cohere', iconKey: 'Cohere.Color' },
  { id: 'r-perplexity', name: 'Perplexity', iconKey: 'Perplexity.Color' },
  { id: 'r-zhipu', name: 'Zhipu GLM', iconKey: 'Zhipu.Color' },
  { id: 'r-moonshot', name: 'Moonshot', iconKey: 'Moonshot' },
] as const

export const PROVIDER_RIBBON_BOTTOM: readonly ProviderRibbonItem[] = [
  { id: 'r-bedrock', name: 'AWS Bedrock', iconKey: 'Bedrock.Color' },
  { id: 'r-azure', name: 'Azure', iconKey: 'Azure.Color' },
  { id: 'r-vertex', name: 'Vertex AI', iconKey: 'VertexAI.Color' },
  { id: 'r-openrouter', name: 'OpenRouter', iconKey: 'OpenRouter.Color' },
  { id: 'r-ollama', name: 'Ollama', iconKey: 'Ollama' },
  { id: 'r-groq', name: 'Groq', iconKey: 'Groq' },
  { id: 'r-nvidia', name: 'NVIDIA NIM', iconKey: 'Nvidia.Color' },
  { id: 'r-cloudflare', name: 'Cloudflare', iconKey: 'Cloudflare.Color' },
  { id: 'r-midjourney', name: 'Midjourney', iconKey: 'Midjourney' },
  { id: 'r-kling', name: 'Kling', iconKey: 'Kling.Color' },
  { id: 'r-suno', name: 'Suno', iconKey: 'Suno' },
  { id: 'r-doubao', name: 'Doubao', iconKey: 'Doubao.Color' },
] as const

export function buildWorkbenchSnippet(
  protocol: WorkbenchProtocolSpec,
  client: SdkClientId,
  baseUrl: string
): string {
  const cleanBase = baseUrl.replace(/\/+$/, '')

  if (client === 'curl') {
    const resolvedEndpoint = protocol.endpoint.replace(
      '{model}',
      protocol.modelSample
    )
    const headerLines = protocol.headers.map((header) => `  -H "${header}" \\`)
    let payloadLines: string[]
    if (protocol.id === 'openai-chat') {
      payloadLines = [
        `  -d '{`,
        `    "model": "${protocol.modelSample}",`,
        `    "messages": [{ "role": "user", "content": "Draft sprint recap while I steep tea" }]`,
        `  }'`,
      ]
    } else if (protocol.id === 'openai-responses') {
      payloadLines = [
        `  -d '{`,
        `    "model": "${protocol.modelSample}",`,
        `    "input": "Check all upstream pools so I can sign off on time"`,
        `  }'`,
      ]
    } else if (protocol.id === 'claude') {
      payloadLines = [
        `  -d '{`,
        `    "model": "${protocol.modelSample}",`,
        `    "max_tokens": 1024,`,
        `    "messages": [{ "role": "user", "content": "Review PR diff and summarize risks" }]`,
        `  }'`,
      ]
    } else {
      payloadLines = [
        `  -d '{`,
        `    "contents": [{ "role": "user", "parts": [{ "text": "Summarize meeting recording" }] }]`,
        `  }'`,
      ]
    }
    return [
      `curl ${cleanBase}${resolvedEndpoint} \\`,
      `  -H "Content-Type: application/json" \\`,
      ...headerLines,
      ...payloadLines,
    ].join('\n')
  }

  if (client === 'typescript') {
    if (protocol.id === 'claude') {
      return [
        `import Anthropic from '@anthropic-ai/sdk'`,
        ``,
        `const client = new Anthropic({`,
        `  baseURL: '${cleanBase}',`,
        `  apiKey: process.env.NEW_API_KEY,`,
        `})`,
        ``,
        `const message = await client.messages.create({`,
        `  model: '${protocol.modelSample}',`,
        `  max_tokens: 1024,`,
        `  messages: [{ role: 'user', content: 'Review PR diff and summarize risks' }],`,
        `})`,
      ].join('\n')
    }
    if (protocol.id === 'gemini') {
      return [
        `import { GoogleGenAI } from '@google/genai'`,
        ``,
        `const ai = new GoogleGenAI({`,
        `  apiKey: process.env.NEW_API_KEY,`,
        `  httpOptions: { baseUrl: '${cleanBase}' },`,
        `})`,
        ``,
        `const response = await ai.models.generateContent({`,
        `  model: '${protocol.modelSample}',`,
        `  contents: 'Summarize meeting recording',`,
        `})`,
      ].join('\n')
    }
    if (protocol.id === 'openai-responses') {
      return [
        `import OpenAI from 'openai'`,
        ``,
        `const client = new OpenAI({`,
        `  baseURL: '${cleanBase}/v1',`,
        `  apiKey: process.env.NEW_API_KEY,`,
        `})`,
        ``,
        `const response = await client.responses.create({`,
        `  model: '${protocol.modelSample}',`,
        `  input: 'Check all upstream pools so I can sign off on time',`,
        `})`,
      ].join('\n')
    }
    return [
      `import OpenAI from 'openai'`,
      ``,
      `const client = new OpenAI({`,
      `  baseURL: '${cleanBase}/v1',`,
      `  apiKey: process.env.NEW_API_KEY,`,
      `})`,
      ``,
      `const completion = await client.chat.completions.create({`,
      `  model: '${protocol.modelSample}',`,
      `  messages: [{ role: 'user', content: 'Draft sprint recap while I steep tea' }],`,
      `})`,
    ].join('\n')
  }

  // python
  if (protocol.id === 'claude') {
    return [
      `from anthropic import Anthropic`,
      ``,
      `client = Anthropic(`,
      `    base_url="${cleanBase}",`,
      `    api_key="sk-••••••••",`,
      `)`,
      ``,
      `message = client.messages.create(`,
      `    model="${protocol.modelSample}",`,
      `    max_tokens=1024,`,
      `    messages=[{"role": "user", "content": "Review PR diff and summarize risks"}],`,
      `)`,
    ].join('\n')
  }
  if (protocol.id === 'gemini') {
    return [
      `from google import genai`,
      `from google.genai import types`,
      ``,
      `client = genai.Client(`,
      `    api_key="sk-••••••••",`,
      `    http_options=types.HttpOptions(base_url="${cleanBase}"),`,
      `)`,
      ``,
      `response = client.models.generate_content(`,
      `    model="${protocol.modelSample}",`,
      `    contents="Summarize meeting recording",`,
      `)`,
    ].join('\n')
  }
  if (protocol.id === 'openai-responses') {
    return [
      `from openai import OpenAI`,
      ``,
      `client = OpenAI(`,
      `    base_url="${cleanBase}/v1",`,
      `    api_key="sk-••••••••",`,
      `)`,
      ``,
      `response = client.responses.create(`,
      `    model="${protocol.modelSample}",`,
      `    input="Check all upstream pools so I can sign off on time",`,
      `)`,
    ].join('\n')
  }
  return [
    `from openai import OpenAI`,
    ``,
    `client = OpenAI(`,
    `    base_url="${cleanBase}/v1",`,
    `    api_key="sk-••••••••",`,
    `)`,
    ``,
    `completion = client.chat.completions.create(`,
    `    model="${protocol.modelSample}",`,
    `    messages=[{"role": "user", "content": "Draft sprint recap while I steep tea"}],`,
    `)`,
  ].join('\n')
}
