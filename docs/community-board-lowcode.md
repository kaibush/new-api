# 公共动态栏（Community Board）低代码动态编排设计方案

> 本文档面向 `new-api` 前后端研发，提供将「公共动态（Community Board）」从硬编码组件升级为**配置驱动、积木式低代码动态栏**的完整设计与分阶段落地方案。


## 当前落地状态（2026-11-21）

当前已实现核心编排版本：内置签到、独立签到榜、活动、红包与红包说明，以及图文卡片、公告、快捷入口、横幅、复制卡片。支持添加、复制、移除、开关、排序，签到榜可选榜单类型、条数与打开方式。动作包括外链（可选确认）、站内页面、富文本弹框、签到/榜单弹框、复制文字和追加聊天草稿。

管理入口为「系统设置 → 社区聊天 → 公共动态」。编辑器提供真实组件预览、JSON 导入/复制导出、恢复默认、未保存提醒与版本冲突保护。发布后通过现有全局 WS 发送版本变更信号，用户重新获取配置；重连也会同步，30 秒轮询作为补充。

当前实现复用 `options` 表保存单份 `community.board.v1` JSON，不新增表或迁移。真实 API 为 `GET /api/community/board`、`GET /api/option/community/board`、`PUT /api/option/community/board`；管理接口沿用系统设置的超级管理员权限。恢复默认也经同一保存接口提交，遵守当前版本校验。实际字段以 `model/community_board.go` 和 `web/src/features/community/board/schema.ts` 为准，下文的独立表、`payload` 等仍属于完整设计方案。

尚未实现的规划包括：角色/用户组定向投放、定时上下架、置顶和折叠规则、iframe、倒计时、投票、应援计数、幸运签、快捷兑换和统计类积木。它们不会作为可用模块出现在本次编辑器中。

---

## 一、背景与设计目标

### 1.1 现状分析

当前社区页面（`web/src/features/community/index.tsx`）在桌面端右侧拥有固定 `300px ~ 320px` 侧栏、移动端通过弹窗承载的「公共动态（`CommunityBoard`，`web/src/features/community/community-board.tsx`）」。现有实现存在以下局限：

1. **结构完全硬编码**：按固定顺序写死「每日签到（含内嵌 Top 5 签到榜）→ 活动预告 → 社区红包 → 关于红包说明卡」，管理员无法调整顺序、隐藏某块或修改头部文案。
2. **模块耦合**：`web/src/features/community/community-checkin.tsx` 同时承载了「每日签到入口」和「今日签到榜预览」，无法把「当前签到榜」作为独立卡片自由挪动、定制展示维度或配置点击行为。
3. **运营扩展成本高**：每次想在公共动态区放一个外部活动链接、公告海报、加群二维码弹窗、工具导航、倒计时、投票或趣味小功能，都需要改前端代码并重新发版。
4. **缺少精细化投放能力**：不支持按用户角色/用户组展示、不支持定时上下架、不支持桌面端与移动端差异化展示。

### 1.2 核心设计目标

以「**像搭积木一样配置公共动态，但保持主题统一、交互安全、零代码上手**」为原则，达成以下目标：

- **积木化（Block-based）**：将内置能力（每日签到、当前签到榜、活动预告、社区红包等）与通用低代码卡片、趣味互动卡片统一抽象为 **Board Block（动态积木）**。
- **动作统一化（Action-driven）**：所有自定义卡片、按钮、快捷宫格、横幅共享一套统一的 **Action 引擎**，无缝支持外链跳转、站内跳转、富文本弹框、安全网页弹框、内置业务弹框、一键复制、快捷填入聊天框。
- **精细化投放**：支持排序、置顶、开关、按角色/用户组可见、定时上下架、折叠展示、端适配（桌面/移动）。
- **所见即所得后台**：在现有社区设置中提供可视化编排器 + `320px` 1:1 实时仿真预览 + 预设模板库 + JSON 导入导出，改动后通过现有社区 WebSocket 实时通知在线用户刷新。
- **向后兼容与安全边界**：老站点升级后零破坏，自动回退为与当前一致的默认积木布局；严格遵守 XSS 消毒、URL 协议白名单、服务端权限裁剪、三数据库（SQLite / MySQL / PostgreSQL）兼容。

---

## 二、核心概念与低代码模型

整个动态栏由 **Board Header（头部元信息）** + **有序的 Block 列表（积木块）** 组成。每个积木块由 **4 个正交维度** 构成：

```text
CommunityBoardConfig
├── header: { title, subtitle, icon }           // 头部标题、副标题、图标（默认复用原"公共动态 / 不错过每一份心意 / gift"）
├── version: int64                              // 乐观锁版本号 & WebSocket 轻量变更信号
└── blocks: BoardBlock[]                        // 最多 30 个积木，按 pinned desc, sort_order asc 渲染
      ├── 基础元数据: id, type, enabled, pinned, sort_order, collapsible, default_collapsed
      ├── 外观令牌: title, subtitle, icon, badge, tone, variant
      ├── 投放规则: visibility(roles/groups), schedule(starts_at/ends_at), surface(all/desktop/mobile)
      ├── 类型专属配置: payload (按 type 校验)
      └── 统一交互动作: action / actions[] (跳转 URL / 站内路由 / 弹框 / 复制 / 联动聊天)
```

---

## 三、积木体系设计（内置模块 + 低代码内容 + 趣味互动）

考虑到公共动态栏桌面宽度为 `300px ~ 320px`（`web/src/features/community/index.tsx:161`），所有积木均面向**单列窄栏卡片**设计，复杂内容优先以「摘要卡 + 点击弹框/跳转」呈现。

### 3.1 第一类：内置业务积木（Built-in Widgets）

将现有硬编码能力拆解并注册为内置积木，支持自由开关、排序、修改标题与关键参数：

| `type` | 名称 | 核心能力与可配参数（`payload`） | 复用现有能力 |
| --- | --- | --- | --- |
| `builtin.checkin` | 每日签到卡 | 展示今日签到状态、已领奖励、主按钮；点击弹框打开签到日历。可配 `hide_when_disabled`（默认 `true`）、`show_reward_amount`、`cta_text_override` | `CommunityCheckin`、`CheckinCalendarCard`、`getCheckinStatus` |
| `builtin.checkin_leaderboard` | **当前签到榜（独立积木）** | **从原签到卡解耦，可独立摆放！** 可配默认榜 `default_tab`（`today` / `highlights` / `total`）、展示条数 `top_n`（`3~10`，默认 `5`）、是否高亮展示当前用户自身排名 `show_self_rank`、点击「查看完整榜单」行为 `open_mode`（`modal` 弹框打开完整榜单 或 `route` 跳转 `/checkin-leaderboard`）、榜单关闭时是否自动隐藏 | `getCheckinLeaderboard`、`CheckinLeaderboard`（`web/src/features/checkin/components/leaderboard.tsx`） |
| `builtin.events` | 活动预告 | 展示未结束的社区活动列表；可配 `preview_count`（默认 `3`）、`hide_when_empty`（默认 `false`）、是否显示管理员「发布活动」快捷按钮 | `useCommunityEvents`、`EventCard`、`EventDetail`、`EventForm` |
| `builtin.red_packets` | 社区红包 | 展示当前/历史红包 Tab 与发红包入口；可配 `show_rules_tip`（是否附带简洁规则提示） | `RedPacketBoard`、`RedPacketDetailDialog`、`RedPacketCreate` |
| `builtin.site_announcements` | 站点公告速览 | 读取系统已有公告（`announcements`），展示最新 `limit` 条（`1~5`），点击条目弹框看公告全文 | 现有站点公告接口/状态数据、`Dialog`、`RichContent` |
| `builtin.service_status` | 服务/通道状态速览 | 展示站点通道健康状态摘要（正常/波动/异常点数），点击跳转 `/channel-status` | 现有状态页能力、`/channel-status` |

> **关键解耦说明**：升级后 `builtin.checkin` 默认不再重复渲染内嵌榜单，由独立的 `builtin.checkin_leaderboard` 积木承载。老数据默认预设会把 `builtin.checkin` 与 `builtin.checkin_leaderboard` 相邻放置，既保持原视觉连续性，又允许管理员随时把榜单挪到顶部、改成「近期欧皇榜」、或改成点击直达 `/checkin-leaderboard`。

### 3.2 第二类：通用低代码内容积木（Custom Low-Code Blocks）

管理员无需写代码，可随时添加多个同类型积木，快速满足运营、导航、通知、营销需求：

| `type` | 名称 | 典型使用场景 | 核心可配字段（`payload`） |
| --- | --- | --- | --- |
| `custom.action_card` | 图文行动卡 | 活动推广、社群引导、赞助商/合作伙伴入口、教程入口 | `summary`（摘要文案）、`cover_url`（可选顶部小图，限白名单协议）、`highlights[]`（可选 1~3 条要点标签）、`actions[]`（1~2 个按钮，支持任意 Action） |
| `custom.link_grid` | 快捷入口宫格 | 文档中心、QQ/TG/Discord 群、客户端下载、工单、价格表、常用工具 | `columns`（`2` 列网格或 `1` 列列表）、`items[]`（每项含 `icon`、`label`、`sublabel`、`badge`、`action`，最多 12 项） |
| `custom.banner` | 海报/横幅卡 | 视觉化运营海报、限时充值优惠、新模型上线通知 | `image_url`、`aspect_ratio`（`16:9` / `21:9` / `3:1`）、`overlay_title`、`overlay_subtitle`、`action`（整卡点击触发） |
| `custom.countdown` | 活动倒计时卡 | 充值折扣倒计时、红包雨预告、新模型发布会、维护倒计时 | `target_at`（目标 Unix 时间戳）、`running_text`、`finished_text`、`finished_behavior`（`show_finished` / `hide` / `switch_action`）、`action`、`finished_action` |
| `custom.notice` | 富文本贴士 / 公告卡 | 社区版规、红包说明、充值须知、版本更新日志 | `content_mode`（`markdown` / `html`）、`preview_text`（卡片内精简摘要）、`body`（正文）、`expand_mode`（`inline` / `collapse` / `modal`） |
| `custom.copy_card` | 一键复制 / 口令卡 | API 接入地址、群号、专属福利暗号、个人邀请码快捷复制 | `display_label`、`copy_value`（支持安全只读模板变量，如 `{{site.server_address}}`、`{{user.aff_code}}`）、`masked`（是否脱敏显示）、`helper_text` |
| `custom.kv_stats` | 关键信息指标卡 | 站内速览（如今日在线人数、今日签到人数、充值汇率、我的分组） | `items[]`（2~4 项，每项含 `label`、`value_source` 支持静态文本或安全内置指标键、`unit`、`action`） |

### 3.3 第三类：趣味互动积木（Interactive / Fun Widgets）

面向社区活跃与留存设计的轻量好玩功能，后端存储简洁、严格防刷、不侵入计费核心：

| `type` | 名称 | 玩法说明 | 数据与防刷设计 |
| --- | --- | --- | --- |
| `interactive.poll` | **社区轻量投票 / 二选一 PK** | 管理员配置主题 + 2~6 个选项（如「下一批最想上的模型？」「周末要红包雨还是翻倍签到？」），支持单选/多选、截止时间、投票后即时展示百分比进度条与票数 | 独立表 `community_board_poll_votes`，唯一索引 `(block_id, user_id, option_id)` 防重复投票；支持可选匿名结果展示 |
| `interactive.reaction_counter` | **趣味打卡 / 应援计数器** | 如「给站长加鸡腿 🍗」「今日摸鱼敲木鱼」「催更许愿池」，展示全站今日/累计总数与按钮微动效；可配置 1~3 个趣味按钮（如「欧气+1」「非酋抱团」） | 独立表 `community_board_reactions` + 每日聚合；限制每人每日最多触发 `daily_limit` 次（如 `1~5` 次） |
| `interactive.mystery_tip` | **每日幸运签 / Prompt 盲盒** | 管理员配置文案池（最多 50 条：AI Prompt 技巧、今日运势签、隐藏彩蛋、幽默语录），用户点击「抽一张」弹框翻转展示。支持 `daily_deterministic` 模式（基于 `sha256(block_id + user_id + today)` 确定性抽取，当天刷新不变、次日换新，**零数据库写入**！） | 纯确定性算法，无需额外写表；支持配置可选彩蛋按钮（如跳转到 Playground 试用该 Prompt） |
| `interactive.quick_redeem` | **快捷兑换码入口** | 在动态栏或点击弹框内直接粘贴群里抢到的兑换码并兑换额度，形成「左侧聊天气氛 → 抢红包/拿活动码 → 右侧一键兑换」闭环 | **严格复用现有 `POST /api/user/topup`**（`router/api-router.go:132`），前端仅做快捷表单封装，绝不重写计费与防重逻辑 |
| `interactive.goal_progress` | **社区共创进度条** | 如「今日签到满 200 人解锁全站晚间红包」「本周社区活跃目标」，支持手动设定当前值或绑定安全内置统计源（今日签到人数 / 今日社区消息数 / 当前在线人数） | 只读聚合查询（带短期缓存），达标后自动切换高亮状态与达成文案/按钮 |

---

## 四、统一交互动作系统（Unified Action Schema）

所有按钮、卡片、快捷宫格项、横幅共用同一套 `BoardAction` 定义，彻底解决「跳 URL / 弹框显示 / 站内功能联动」的扩展问题：

| `action.type` | 说明 | 关键参数 | 前端执行行为 |
| --- | --- | --- | --- |
| `none` | 无动作 | — | 纯展示，不渲染可点击态 |
| `external_url` | 跳转外部 URL | `url`（仅 `http://`/`https://`）、`open_in_new_tab`（默认 `true`）、`confirm_leave`（是否弹外链确认提示） | 使用 `window.open(url, '_blank', 'noopener,noreferrer')` 或安全 `<a>` |
| `internal_route` | 跳转站内页面 | `route`（严格白名单枚举，见下表） | 使用 TanStack Router `navigate({ to })`，无刷新跳转 |
| `modal_content` | **富文本弹框** | `title`、`subtitle`、`size`（`sm`/`md`/`lg`/`xl`）、`content_mode`（`markdown`/`html`）、`body`、`footer_actions[]`（可选底部按钮，如「前往领取」「复制口令」） | 复用 `@/components/dialog` + `@/components/rich-content`（`htmlVariant='isolated'`） |
| `modal_iframe` | **外部网页弹框** | `title`、`url`（仅 `https://`，可选域名白名单）、`height`（`420~760` px）、`size`（`md`/`lg`/`xl`）、`allow_open_external`（底部提供新窗口打开兜底） | 复用 `@/components/dialog` + 沙箱 `<iframe>`（`sandbox` + `referrerPolicy='no-referrer'` + `loading='lazy'`） |
| `modal_widget` | **内置业务弹框** | `widget`（`checkin_calendar` / `checkin_leaderboard` / `quick_redeem` / `event_detail`）、`params`（如 `{ event_id }`） | 懒加载对应组件并在 `@/components/dialog` 中展示，用户无需离开聊天室 |
| `copy_text` | 一键复制文本 | `text`（支持安全只读模板变量）、`success_message` | 复用 `@/hooks/use-copy-to-clipboard` + `sonner` toast 反馈 |
| `chat_prefill` | **填入左侧聊天框** | `text`（如 `@助手 我想反馈一个问题：`）、`focus_composer`（默认 `true`） | 通过社区上下文回调写入 `ChatComposer` 并聚焦输入框，绝不自动发送消息 |

### 4.1 `internal_route` 站内路由白名单

仅允许跳转到 `web/src/routes/_authenticated/` 下受控路由，防止任意路径注入：

- `/checkin`（签到页）
- `/checkin-leaderboard`（签到排行榜）
- `/models`（模型列表与价格）
- `/playground`（操练场）
- `/chat`（聊天应用）
- `/wallet`（钱包与充值）
- `/subscriptions`（订阅套餐）
- `/keys`（令牌管理）
- `/channel-status`（渠道状态）
- `/profile`（个人中心与邀请）
- `/usage-logs`（使用日志）

---

## 五、配置 Schema 与安全只读变量

### 5.1 Go 结构体定义（后端权威 Schema）

建议新增独立包文件 `model/community_board.go`（与 `model/community_chat.go` 同属 `model` 包），所有 JSON 编解码必须使用 `common.Marshal` / `common.Unmarshal` / `common.DecodeJson`（禁止业务代码直接调用 `encoding/json` 编解码函数）：

```go
package model

import "encoding/json"

type CommunityBoardHeader struct {
	Title    string `json:"title"`    // 为空时前端回退 i18n "Community board"
	Subtitle string `json:"subtitle"` // 为空时前端回退 i18n "Shared moments, all in one place."
	Icon     string `json:"icon"`     // Lucide 图标名，默认 "gift"
}

type CommunityBoardVisibility struct {
	MinRole int      `json:"min_role,omitempty"` // 0=全部, 1=普通及以上, 10=管理员及以上, 100=Root
	MaxRole int      `json:"max_role,omitempty"` // 0=不限
	Groups  []string `json:"groups,omitempty"`   // 为空表示全部用户组；非空表示仅指定组可见
}

type CommunityBoardSchedule struct {
	StartsAt int64 `json:"starts_at,omitempty"` // Unix 秒，0=不限
	EndsAt   int64 `json:"ends_at,omitempty"`   // Unix 秒，0=不限
}

type CommunityBoardAction struct {
	Type            string         `json:"type"` // none | external_url | internal_route | modal_content | modal_iframe | modal_widget | copy_text | chat_prefill
	Label           string         `json:"label,omitempty"`
	Variant         string         `json:"variant,omitempty"` // default | secondary | outline | ghost
	URL             string         `json:"url,omitempty"`
	OpenInNewTab    *bool          `json:"open_in_new_tab,omitempty"`
	ConfirmLeave    bool           `json:"confirm_leave,omitempty"`
	Route           string         `json:"route,omitempty"`
	Title           string         `json:"title,omitempty"`
	Subtitle        string         `json:"subtitle,omitempty"`
	Size            string         `json:"size,omitempty"`         // sm | md | lg | xl
	ContentMode     string         `json:"content_mode,omitempty"` // markdown | html
	Body            string         `json:"body,omitempty"`
	Height          int            `json:"height,omitempty"`
	AllowOpenExtern *bool          `json:"allow_open_external,omitempty"`
	Widget          string         `json:"widget,omitempty"` // checkin_calendar | checkin_leaderboard | quick_redeem | event_detail
	WidgetParams    map[string]any `json:"widget_params,omitempty"`
	Text            string         `json:"text,omitempty"`
	SuccessMessage  string         `json:"success_message,omitempty"`
	FooterActions   []CommunityBoardAction `json:"footer_actions,omitempty"` // 最多 2 个，且禁止嵌套 modal_*
}

type CommunityBoardBlockDTO struct {
	ID               string                   `json:"id"`
	Type             string                   `json:"type"`
	Enabled          bool                     `json:"enabled"`
	Pinned           bool                     `json:"pinned"`
	SortOrder        int                      `json:"sort_order"`
	Surface          string                   `json:"surface"` // all | desktop | mobile
	Title            string                   `json:"title,omitempty"`
	Subtitle         string                   `json:"subtitle,omitempty"`
	Icon             string                   `json:"icon,omitempty"`
	Badge            string                   `json:"badge,omitempty"`
	Tone             string                   `json:"tone,omitempty"`    // default | primary | info | success | warning | promo
	Variant          string                   `json:"variant,omitempty"` // subtle | outline | highlight
	Collapsible      bool                     `json:"collapsible"`
	DefaultCollapsed bool                     `json:"default_collapsed"`
	Visibility       CommunityBoardVisibility `json:"visibility"`
	Schedule         CommunityBoardSchedule   `json:"schedule"`
	Payload          json.RawMessage          `json:"payload"`
	Action           *CommunityBoardAction    `json:"action,omitempty"`
	Actions          []CommunityBoardAction   `json:"actions,omitempty"`
	UpdatedAt        int64                    `json:"updated_at,omitempty"`
}

type CommunityBoardDocument struct {
	SchemaVersion int                      `json:"schema_version"` // 当前为 1
	Version       int64                    `json:"version"`        // 递增版本号，用于乐观锁与 WS 变更推送
	Customized    bool                     `json:"customized"`     // false 表示使用内置默认预设
	Header        CommunityBoardHeader     `json:"header"`
	Blocks        []CommunityBoardBlockDTO `json:"blocks"`
}
```

### 5.2 TypeScript 判别联合类型示例（前端）

前端在 `web/src/features/community/board/types.ts` 中使用严格 TypeScript 类型（避免 `any`）：

```ts
export type BoardBlockTone =
  | 'default'
  | 'primary'
  | 'info'
  | 'success'
  | 'warning'
  | 'promo'

export type BoardAction =
  | { type: 'none' }
  | {
      type: 'external_url'
      label?: string
      variant?: 'default' | 'secondary' | 'outline' | 'ghost'
      url: string
      open_in_new_tab?: boolean
      confirm_leave?: boolean
    }
  | {
      type: 'internal_route'
      label?: string
      variant?: 'default' | 'secondary' | 'outline' | 'ghost'
      route: AllowedInternalRoute
    }
  | {
      type: 'modal_content'
      label?: string
      variant?: 'default' | 'secondary' | 'outline' | 'ghost'
      title: string
      subtitle?: string
      size?: 'sm' | 'md' | 'lg' | 'xl'
      content_mode: 'markdown' | 'html'
      body: string
      footer_actions?: Exclude<
        BoardAction,
        { type: 'modal_content' | 'modal_iframe' | 'modal_widget' }
      >[]
    }
  | {
      type: 'modal_iframe'
      label?: string
      variant?: 'default' | 'secondary' | 'outline' | 'ghost'
      title: string
      url: string
      height?: number
      size?: 'md' | 'lg' | 'xl'
      allow_open_external?: boolean
    }
  | {
      type: 'modal_widget'
      label?: string
      variant?: 'default' | 'secondary' | 'outline' | 'ghost'
      widget:
        | 'checkin_calendar'
        | 'checkin_leaderboard'
        | 'quick_redeem'
        | 'event_detail'
      widget_params?: Record<string, string | number>
    }
  | {
      type: 'copy_text'
      label?: string
      variant?: 'default' | 'secondary' | 'outline' | 'ghost'
      text: string
      success_message?: string
    }
  | {
      type: 'chat_prefill'
      label?: string
      variant?: 'default' | 'secondary' | 'outline' | 'ghost'
      text: string
    }
```

### 5.3 完整配置 JSON 示例（含签到榜、URL 跳转、弹窗与趣味互动）

```json
{
  "schema_version": 1,
  "version": 4,
  "customized": true,
  "header": {
    "title": "",
    "subtitle": "",
    "icon": "gift"
  },
  "blocks": [
    {
      "id": "builtin-checkin",
      "type": "builtin.checkin",
      "enabled": true,
      "pinned": true,
      "sort_order": 10,
      "surface": "all",
      "payload": {
        "hide_when_disabled": true,
        "show_reward_amount": true
      }
    },
    {
      "id": "builtin-checkin-leaderboard",
      "type": "builtin.checkin_leaderboard",
      "enabled": true,
      "pinned": false,
      "sort_order": 20,
      "surface": "all",
      "title": "今日签到榜",
      "icon": "trophy",
      "badge": "LIVE",
      "tone": "primary",
      "payload": {
        "default_tab": "today",
        "top_n": 5,
        "show_self_rank": true,
        "open_mode": "modal",
        "hide_when_disabled": true
      }
    },
    {
      "id": "quick-links",
      "type": "custom.link_grid",
      "enabled": true,
      "pinned": false,
      "sort_order": 30,
      "surface": "all",
      "title": "快捷入口",
      "icon": "compass",
      "payload": {
        "columns": 2,
        "items": [
          {
            "id": "docs",
            "icon": "book-open",
            "label": "接入文档",
            "action": {
              "type": "external_url",
              "url": "https://docs.example.com",
              "open_in_new_tab": true
            }
          },
          {
            "id": "wechat-group",
            "icon": "qr-code",
            "label": "加入交流群",
            "badge": "HOT",
            "action": {
              "type": "modal_content",
              "title": "扫码加入用户交流群",
              "size": "sm",
              "content_mode": "markdown",
              "body": "扫码备注你的用户名 **{{user.username}}** 即可入群获取福利预告。\n\n![交流群二维码](https://example.com/group-qr.png)"
            }
          },
          {
            "id": "models",
            "icon": "sparkles",
            "label": "模型价格",
            "action": {
              "type": "internal_route",
              "route": "/models"
            }
          },
          {
            "id": "feedback",
            "icon": "message-square-plus",
            "label": "快速反馈",
            "action": {
              "type": "chat_prefill",
              "text": "@助手 我想反馈："
            }
          }
        ]
      }
    },
    {
      "id": "poll-next-model",
      "type": "interactive.poll",
      "enabled": true,
      "pinned": false,
      "sort_order": 40,
      "surface": "all",
      "title": "下周最想上新的模型",
      "icon": "vote",
      "badge": "投票中",
      "tone": "info",
      "payload": {
        "question": "投票选出你最希望优先加池的模型",
        "multi_select": false,
        "show_votes_before_submit": false,
        "ends_at": 1796000000,
        "options": [
          { "id": "opt_1", "label": "模型 A（超长上下文）" },
          { "id": "opt_2", "label": "模型 B（高性价比编码）" },
          { "id": "opt_3", "label": "模型 C（图像生成）" }
        ]
      }
    },
    {
      "id": "daily-fortune",
      "type": "interactive.mystery_tip",
      "enabled": true,
      "pinned": false,
      "sort_order": 50,
      "surface": "all",
      "title": "今日 Prompt 灵感签",
      "icon": "sparkles",
      "tone": "promo",
      "payload": {
        "mode": "daily_deterministic",
        "button_label": "抽取今日签",
        "pool": [
          {
            "title": "上上签 · 分步思考",
            "content": "复杂排查任务先让模型列出 3 个假设和验证命令，再逐一排除，准确率翻倍。",
            "action": {
              "type": "internal_route",
              "label": "去操练场试试",
              "route": "/playground"
            }
          }
        ]
      }
    },
    {
      "id": "builtin-events",
      "type": "builtin.events",
      "enabled": true,
      "pinned": false,
      "sort_order": 60,
      "surface": "all",
      "payload": {
        "preview_count": 3,
        "hide_when_empty": false
      }
    },
    {
      "id": "builtin-red-packets",
      "type": "builtin.red_packets",
      "enabled": true,
      "pinned": false,
      "sort_order": 70,
      "surface": "all",
      "payload": {
        "show_rules_tip": true
      }
    }
  ]
}
```

### 5.4 安全只读模板变量白名单

仅在纯文本渲染阶段（和 `copy_text` / `chat_prefill`）对显式允许的占位符做字符串替换，**禁止执行任何表达式或脚本**：

| 变量名 | 来源 | 说明 |
| --- | --- | --- |
| `{{user.username}}` | 当前登录用户 | 用户名 |
| `{{user.display_name}}` | 当前登录用户 | 展示名（空时回退用户名） |
| `{{user.group}}` | 当前登录用户 | 用户分组 |
| `{{user.aff_code}}` | 当前登录用户 | 个人邀请码 |
| `{{site.name}}` | `system_setting.SystemName` | 站点名称 |
| `{{site.server_address}}` | `system_setting.ServerAddress` | 站点接入地址 |
| `{{community.online_count}}` | 实时在线成员数 | 当前聊天室在线人数 |
| `{{checkin.today_count}}` | 签到汇总数据 | 今日签到总人数（未开签到时为 `0`） |

> 安全规则：变量替换结果若注入 Markdown/HTML 上下文，必须在消毒前做纯文本转义，防止用户名中包含特殊字符导致注入。

---

## 六、数据库模型与三库兼容性设计

严格遵守 `AGENTS.md` 数据库规范：**同时兼容 SQLite、MySQL >= 5.7.8、PostgreSQL >= 9.6**；不使用 `AUTO_INCREMENT`/`SERIAL` 原生写法；不在 GORM tag 中使用 `default:true` 布尔默认值；不使用数据库专属 `JSONB` 类型（统一 `type:text`）；行锁统一使用 `lockForUpdate(tx)`。

### 6.1 扩展现有表：`community_configs`

在 `model/community_chat.go` 的 `CommunityConfig` 结构体上增量追加 5 个轻量字段（均兼容 SQLite `ALTER TABLE ... ADD COLUMN`、MySQL、PostgreSQL）：

```go
BoardCustomized bool   `json:"board_customized"` // false 时返回内置默认布局，确保老站点无痛升级
BoardVersion    int64  `json:"board_version"`    // 单调递增，用于保存乐观锁与 WS 轻量同步
BoardTitle      string `json:"board_title" gorm:"type:varchar(80)"`
BoardSubtitle   string `json:"board_subtitle" gorm:"type:varchar(160)"`
BoardIcon       string `json:"board_icon" gorm:"type:varchar(64)"`
```

> 为什么不把所有 Block 塞进 `community_configs` 的单个 `TEXT` 字段？
> 1. MySQL `TEXT` 上限仅 `64KB`，若管理员配置多个含长 Markdown 弹窗说明的卡片容易触发截断或报错；
> 2. 拆分为 `community_board_blocks` 按行存储后，每个 Block 的 `config_json` 独立限长（如 `16KB`），永不触碰单行 `TEXT` 上限；
> 3. 互动型积木（投票、应援计数）可以稳定关联 `block_id`，管理员编辑文案或拖拽改排序时**不会丢失历史投票和计数**。

### 6.2 新增核心表：`community_board_blocks`（阶段一即落地）

```go
type CommunityBoardBlock struct {
	ID               string `json:"id" gorm:"primaryKey;type:varchar(64)"`
	Type             string `json:"type" gorm:"type:varchar(48);index"`
	Enabled          bool   `json:"enabled" gorm:"index"`
	Pinned           bool   `json:"pinned"`
	SortOrder        int    `json:"sort_order" gorm:"index"`
	Surface          string `json:"surface" gorm:"type:varchar(16)"`
	StartsAt         int64  `json:"starts_at" gorm:"index"`
	EndsAt           int64  `json:"ends_at" gorm:"index"`
	VisibilityJSON   string `json:"-" gorm:"type:text"`
	ConfigJSON       string `json:"-" gorm:"type:text"` // 存放外观、payload、action/actions
	UpdatedAt        int64  `json:"updated_at"`
	UpdatedByUserID  int    `json:"updated_by_user_id"`
}
```

### 6.3 新增互动数据表（阶段二按需落地）

#### 1）`community_board_poll_votes`（社区投票明细表）

```go
type CommunityBoardPollVote struct {
	ID        int64  `json:"id" gorm:"primaryKey"`
	BlockID   string `json:"block_id" gorm:"type:varchar(64);index;uniqueIndex:idx_cb_poll_vote_unique,priority:1"`
	UserID    int    `json:"user_id" gorm:"index;uniqueIndex:idx_cb_poll_vote_unique,priority:2"`
	OptionID  string `json:"option_id" gorm:"type:varchar(48);uniqueIndex:idx_cb_poll_vote_unique,priority:3"`
	CreatedAt int64  `json:"created_at"`
}
```

- 单选投票在事务中先 `lockForUpdate(tx)` 检查该 `(block_id, user_id)` 是否已投（或直接依靠唯一索引 + 查询判重）；多选投票在事务中检查本次选项数量不超过上限，并幂等插入。
- 管理员删除或重置投票积木时，清理对应的 `community_board_poll_votes` 行。

#### 2）`community_board_reactions`（趣味应援/打卡每日计数表）

```go
type CommunityBoardReaction struct {
	ID         int64  `json:"id" gorm:"primaryKey"`
	BlockID    string `json:"block_id" gorm:"type:varchar(64);uniqueIndex:idx_cb_reaction_daily,priority:1"`
	ButtonID   string `json:"button_id" gorm:"type:varchar(48);uniqueIndex:idx_cb_reaction_daily,priority:2"`
	UserID     int    `json:"user_id" gorm:"uniqueIndex:idx_cb_reaction_daily,priority:3"`
	ActionDate string `json:"action_date" gorm:"type:varchar(10);index;uniqueIndex:idx_cb_reaction_daily,priority:4"` // 站点时区 YYYY-MM-DD
	Count      int    `json:"count"`
	UpdatedAt  int64  `json:"updated_at"`
}
```

- 汇总查询：`SELECT button_id, SUM(count) ... WHERE block_id = ? AND action_date = ?`（今日数）或去掉 `action_date`（累计总数），三种数据库完全一致。
- 触发限制：通过 `(block_id, button_id, user_id, action_date)` 唯一索引 + 事务内校验 `count < daily_limit` 原子自增，防并发连点穿透。

### 6.4 迁移注册与老数据平滑升级

1. 在 `model/main.go` 的 `AutoMigrate` 列表中紧邻 `&CommunityEvent{}` 注册 `&CommunityBoardBlock{}`（以及阶段二的 `&CommunityBoardPollVote{}`、`&CommunityBoardReaction{}`）。
2. **默认预设回退机制（Zero-Breakage Upgrade）**：
   - 当 `CommunityConfig.BoardCustomized == false` 时，`GetCommunityBoardDocument()` 直接返回代码内置的 `DefaultCommunityBoardBlocks()`：
     1. `builtin.checkin`
     2. `builtin.checkin_leaderboard`
     3. `builtin.events`
     4. `builtin.red_packets`
     5. `custom.notice`（原「关于红包」提示卡）
   - 管理员第一次在后台点击保存后，事务内置 `BoardCustomized = true`、`BoardVersion = BoardVersion + 1` 并全量写入 `community_board_blocks`。
   - 管理员点击「恢复默认布局」时，可一键重置回默认预设并递增 `BoardVersion`。

### 6.5 事务与并发写一致性

保存整版布局（`SaveCommunityBoard`）必须在单个 `DB.Transaction` 中执行：
1. `lockForUpdate(tx).First(&cfg, 1)` 锁住 `community_configs` 单例行（若不存在先初始化）；
2. 校验请求携带的 `version == cfg.BoardVersion`，不相等返回 `409 Conflict`（防止多管理员互相覆盖）；
3. 对比新旧 `block.id`：更新保留项、插入新增项、删除已移除项（同时级联清理被删投票/互动数据，避免孤儿记录）；
4. 更新 `BoardCustomized = true`、`BoardVersion = cfg.BoardVersion + 1`、头部字段并提交事务。

---

## 七、后端 API 与 WebSocket 实时同步设计

沿用 `router/api-router.go` 现有社区分组约定：
- 用户接口挂载在 `/api/community`（`middleware.UserAuth()` + `controller.CommunityAccess` + `middleware.DisableCache()`）
- 管理端接口挂载在 `/api/option/community`（`middleware.AdminAuth()` + `middleware.DisableCache()`）

### 7.1 用户端接口

| 方法与路径 | 中间件 | 说明 |
| --- | --- | --- |
| `GET /api/community/board` | `UserAuth`, `CommunityAccess` | 返回**已按当前用户角色、用户组、服务端当前时间过滤**的公共动态配置与运行时元信息（`header`、`version`、`blocks`、`server_now`、只读变量快照）。管理员可传 `?preview=1` 查看全部草稿/未上线/已过期积木（含 `runtime_state: active \| scheduled \| expired \| disabled`） |
| `GET /api/community/board/polls/:block_id` | `UserAuth`, `CommunityAccess` | （阶段二）获取指定投票积木的各选项票数、占比及当前用户已选 `my_option_ids` |
| `POST /api/community/board/polls/:block_id/vote` | `UserAuth`, `CommunityAccess`, `UserCriticalRateLimit("community-board-vote")` | （阶段二）提交投票 `{ "option_ids": ["opt_1"] }`，返回最新投票结果 |
| `GET /api/community/board/reactions/:block_id` | `UserAuth`, `CommunityAccess` | （阶段二）获取各按钮今日/累计总数与当前用户今日已点次数 |
| `POST /api/community/board/reactions/:block_id/hit` | `UserAuth`, `CommunityAccess`, `UserCriticalRateLimit("community-board-react")` | （阶段二）触发一次应援/打卡 `{ "button_id": "drumstick" }`，返回更新后计数与剩余次数 |

### 7.2 管理端接口

| 方法与路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/option/community/board` | `AdminAuth` | 读取完整动态栏文档（含禁用、定时、角色限定积木）+ 内置可用组件元数据/路由白名单/预设模板列表 |
| `PUT /api/option/community/board` | `AdminAuth` | 原子保存整版布局与配置（校验 `version` 乐观锁、严格 Schema 校验、XSS/URL 校验、记录 `recordManageAudit(c, "community.board_update", ...)`） |
| `POST /api/option/community/board/reset` | `AdminAuth` | 恢复默认动态栏预设（记录审计日志 `community.board_reset`） |

> 注：请求体均通过 `http.MaxBytesReader` 限流（例如 `PUT /api/option/community/board` 上限 `256 KiB`），单 `block` 限制最多 `30` 个，单个 `payload` 限制最多 `16 KiB`。

### 7.3 WebSocket 轻量实时同步（复用现有 `CommunityWebSocket`）

查看 `controller/community_chat.go:370` 可知，`CommunityWebSocket` 已存在每 2 秒轮询 `model.GetCommunityConfig()` 并比对变更的机制。无需额外引入消息队列，只需做最小改动：

1. **后端**（`controller/community_chat.go`）：
   - 在连接循环中记录 `previousBoardVersion int64`；
   - 首次建连或发现 `config.BoardVersion != previousBoardVersion` 时，下发轻量帧：
     ```json
     { "type": "board", "version": 12 }
     ```
   - 仅 30 余字节，不会在 WebSocket 里重复传输大段配置文本，且天然支持多副本部署（版本落在数据库）。
2. **前端**（`web/src/features/community/use-chat.ts`）：
   - 在 `socket.onmessage` 中监听 `data.type === 'board'`；
   - 当收到的 `version` 大于本地记录版本时，调用 `queryClient.invalidateQueries({ queryKey: ['community-board'] })`；
   - 所有在线用户在管理员保存后 ~2 秒内自动看到新版公共动态栏，无需手动刷新页面。

---

## 八、服务端严格校验与安全边界

低代码功能最怕「自由配置带来 XSS、钓鱼外链、越权可见、重 iframe 卡顿」，因此必须在**服务端保存时**和**前后端渲染时**建立硬约束：

1. **URL 协议白名单（服务端 + 前端双重校验）**：
   - `external_url`、`cover_url`、`image_url` 仅允许 `http://` 与 `https://`，禁止 `javascript:`、`data:`、`vbscript:`、`file:` 及控制字符；
   - `modal_iframe` 的 `url` 强制仅允许 `https://`（开发本地环境可按配置豁免 `http://localhost`），避免 HTTPS 站点混合内容报错；
   - 复用/对齐 `setting/console_setting/validation.go` 的 URL 校验与危险内容拦截策略。
2. **富文本 XSS 消毒与样式隔离**：
   - 前端强制统一复用 `@/components/rich-content`（底层 `HtmlContent` 已集成 `DOMPurify 3.4.17`）；
   - `html` 模式必须使用 `htmlVariant='isolated'`（Shadow DOM 隔离，禁止 `script`/`object`/`embed`/`base`/`link`/`meta`/`srcdoc`，外链自动补齐 `rel="noopener noreferrer"`，iframe 自动强制 `sandbox` 与 `referrerpolicy="no-referrer"`）；
   - 服务端额外校验 `body` 最大长度（如 `8000` 字符），拒绝包含 `<script`、`on\w+=`、`javascript:` 的明显恶意载荷。
3. **iframe 沙箱与风险提示**：
   - **禁止直接在 300px 侧栏内自动挂载外部 iframe**（防性能雪崩与布局错乱），仅允许在 `modal_iframe` 弹框打开时懒加载；
   - 弹框 iframe 强制设置 `referrerPolicy="no-referrer"`、`loading="lazy"` 和受限 `sandbox`（默认 `allow-scripts allow-forms allow-popups`，不默认开放 `allow-same-origin` 或由管理员确认外部嵌入风险后显式开启，可复用 `@/components/risk-acknowledgement-dialog`）；
   - 若外部网站设置了 `X-Frame-Options: DENY` 或 CSP `frame-ancestors` 导致无法内嵌，弹框底部提供「在新窗口打开」按钮作为兜底。
4. **服务端权限与时间窗口裁剪（严禁只靠前端隐藏）**：
   - `GET /api/community/board` 在服务端读取当前 session 用户的 `role` 和 `group`，结合服务端 `time.Now().Unix()` 过滤：
     - `enabled == false` → 剔除
     - `starts_at > 0 && now < starts_at` → 剔除
     - `ends_at > 0 && now >= ends_at` → 剔除
     - `min_role > 0 && user.Role < min_role` 或 `max_role > 0 && user.Role > max_role` → 剔除
     - `len(groups) > 0 && !slices.Contains(groups, user.Group)` → 剔除
   - 防止普通用户通过抓包看到管理员草稿、未公开活动或 VIP 专属口令。
5. **Action 嵌套与递归深度限制**：
   - `modal_content.footer_actions` 最多 2 个按钮，且**禁止**再嵌套 `modal_content` / `modal_iframe` / `modal_widget`，避免无限弹窗套娃。
6. **防刷与审计**：
   - 投票/点赞/打卡接口全部走 `UserCriticalRateLimit` 限流与数据库唯一索引防重；
   - 快捷兑换严格调用已有 `POST /api/user/topup`，不新增任何额度发放路径；
   - 管理端保存、重置均调用 `recordManageAudit` 记录变更摘要（积木总数、启停变更、版本号），不落盘敏感凭据。

---

## 九、前端架构与组件复用设计

严格遵循 `web/AGENTS.md` 规范：**先检索复用项目现有业务组件，再组合基础组件；避免 `any`；组件 props 直接通过 `props.xxx` 访问；大模块使用 `React.lazy` 按需加载；全部文案使用 `useTranslation()` 英文 key 并同步 7 语言 locale 文件；Intl 格式化必须经过 `toIntlLocale`。**

### 9.1 现有公共组件复用清单

| 用途 | 必须复用的现有组件 / 工具 |
| --- | --- |
| 通用弹框（富文本弹窗、iframe 弹窗、签到弹窗、签到榜弹窗、移动端动态栏） | `@/components/dialog`（`Dialog`） |
| 删除积木、重置默认布局、外链离开确认 | `@/components/confirm-dialog`（`ConfirmDialog`） |
| 口令/邀请码/API 地址复制 | `@/components/copy-button`（`CopyButton`）与 `@/hooks/use-copy-to-clipboard` |
| Markdown 与隔离 HTML 渲染 | `@/components/rich-content`（`RichContent`）与 `@/components/html-content`（`HtmlContent`） |
| 加载、空状态、错误重试 | `@/components/loading-state`、`@/components/empty-state`、`@/components/error-state` |
| 状态徽标（草稿/生效中/待上线/已过期） | `@/components/status-badge`（`StatusBadge`） |
| 高级 JSON 编辑与导入导出 | `@/components/json-code-editor`（`JsonCodeEditor`） |
| 动态图标渲染 | `lucide-react` 精选白名单映射 + 可选 `@/components/react-icon-by-name`（`ReactIconByName`） |
| 数字与额度格式化 | `@/lib/format`（`formatNumber`）、`@/lib/currency`（`formatQuotaWithCurrency`）、`@/i18n/languages`（`toIntlLocale`） |
| 外部嵌入高风险确认（如开启自由 HTML / iframe） | `@/components/risk-acknowledgement-dialog` |

### 9.2 前端渲染引擎架构（Registry Pattern）

采用「**Block Registry（积木注册表）+ Action Executor（动作执行器）**」分离设计，后续研发想新增一种新积木，只需新增一个渲染组件 + 一份表单 schema 并在注册表登记，无需改动主容器：

```text
web/src/features/community/board/
├── types.ts                        # BoardDocument / Block / Action 判别联合类型
├── api.ts                          # getCommunityBoard / saveCommunityBoard / poll / reaction API
├── templates.ts                    # 内置默认预设 + 精选低代码模板库（签到榜、快捷入口、加群弹窗、投票、幸运签等）
├── variables.ts                    # 安全只读模板变量纯文本插值器
├── icons.ts                        # 精选 Lucide 图标白名单映射与图标选择器数据源
├── action-runner.tsx               # 统一 Action 执行器（管理外链确认弹窗、富文本弹窗、iframe 弹窗、内置组件弹窗、复制、chat_prefill）
├── block-registry.tsx              # Block Type -> Renderer 映射表（内置组件懒加载）
├── block-shell.tsx                 # 统一卡片外壳（tone 色调、图标、标题、角标、折叠切换、预览状态角标）
├── board-renderer.tsx              # 公共动态栏主渲染器（同时供真实侧栏/移动弹窗 和 后台 1:1 实时预览复用！）
├── widgets/
│   ├── builtin-checkin-widget.tsx          # 解耦后的每日签到积木
│   ├── builtin-leaderboard-widget.tsx      # 独立签到榜积木（支持 today/highlights/total、top_n、弹框或跳路由）
│   ├── builtin-events-widget.tsx           # 活动预告积木包装
│   ├── builtin-red-packets-widget.tsx      # 社区红包积木包装
│   ├── builtin-announcements-widget.tsx    # 站点公告速览积木
│   ├── custom-action-card-widget.tsx       # 图文行动卡
│   ├── custom-link-grid-widget.tsx         # 快捷入口宫格
│   ├── custom-banner-widget.tsx            # 海报横幅卡
│   ├── custom-countdown-widget.tsx         # 倒计时卡
│   ├── custom-notice-widget.tsx            # 富文本/折叠公告卡
│   ├── custom-copy-card-widget.tsx         # 一键复制/口令卡
│   ├── custom-kv-stats-widget.tsx          # 关键信息指标卡
│   ├── interactive-poll-widget.tsx         # （阶段二）社区投票积木
│   ├── interactive-reaction-widget.tsx     # （阶段二）趣味应援/打卡积木
│   ├── interactive-mystery-tip-widget.tsx  # （阶段二）每日幸运签/Prompt 盲盒
│   ├── interactive-quick-redeem-widget.tsx # （阶段二）快捷兑换码入口
│   └── interactive-goal-progress-widget.tsx# （阶段二）社区共创进度条
└── studio/
    ├── board-studio.tsx            # 后台可视化编排主页面（作为 CommunitySettings 第 4 个 Tab）
    ├── widget-gallery-dialog.tsx   # 「添加积木」模板商店弹窗（按分类选择，一键插入预填数据）
    ├── block-editor-form.tsx       # 积木属性编辑器（基础外观 / 内容 / 动作 / 投放规则）
    ├── action-editor.tsx           # 通用 Action 配置子表单（被 action_card、link_grid、banner 等复用）
    └── board-json-dialog.tsx       # JSON 导入/导出弹窗（复用 JsonCodeEditor）
```

### 9.3 与现有社区页的对接改造点

1. `web/src/features/community/community-board.tsx`：
   - 内部改为消费 `useQuery({ queryKey: ['community-board'], queryFn: getCommunityBoard })`，并委托给 `<BoardRenderer />`；
   - 保留原有 `packetMessages`、`packets`、`onOpen`、`onCreate`、`onOpenEvent`、`onCreateEvent` 传入给上下文（`BoardRuntimeContext`），新增 `onPrefillChat: (text: string) => void` 用于 `chat_prefill` 动作联动左侧 `ChatComposer`；
   - 管理员（`(user?.role ?? 0) >= 10`）在动态栏头部右侧可见快捷「管理动态栏」图标按钮，点击跳转或打开编排入口；
   - 在加载失败或旧接口异常时，可安全降级展示 `ErrorState` 重试按钮。
2. `web/src/features/community/index.tsx`：
   - 为 `ChatComposer` 增加受控/命令式预填能力（收到 `onPrefillChat` 后，在移动端先关闭 `boardOpen` 弹窗，再写入输入框并聚焦）；
   - 保持桌面端 `lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]` 与移动端 `<Dialog>` 双端形态不变。
3. `web/src/features/community/settings.tsx`：
   - 在现有 `settings` / `feedback` / `history` 三个 `TabsTrigger` 后新增第 4 个 Tab：`board`（「公共动态编排」），懒加载 `<BoardStudio />`。

---

## 十、管理后台低代码编排器 UX 设计（直观、所见即所得）

参考 `docs/checkin-reward-pool.md` 对管理端「直观、好看、易懂」的要求，编排器拒绝让管理员手写裸 JSON，提供**三栏所见即所得工作台**（小屏自动切换为「配置 / 预览」双 Tab）：

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  公共动态编排   [+ 添加积木]  [导入/导出 JSON]  [恢复默认]        [预览视角: 普通用户 ▾] [保存发布] │
├───────────────────────┬──────────────────────────────────┬─────────────────────────────┤
│  1. 结构与排序栏       │  2. 积木配置区（选中项）           │  3. 实时仿真预览区 (320px)   │
│  ─────────────────    │  ──────────────────────────────  │  [桌面 320px | 移动弹窗]     │
│  [头部设置: 公共动态]   │  Tab 1: 外观与内容                │  ┌───────────────────────┐  │
│                       │   • 标题 / 副标题 / 图标 / 角标     │  │ 公共动态           🎁 │  │
│  [置顶] 每日签到   [开] │   • 主题色调 (6种预设色块)         │  │ 不错过每一份心意       │  │
│  [↑][↓][复制][删]      │   • (随类型变化的内容表单)         │  │ ┌───────────────────┐ │  │
│                       │                                  │  │ │ 📅 每日签到       │ │  │
│  [选中] 今日签到榜 [开] │  Tab 2: 点击动作（Action）        │  │ │ [   去签到   ]    │ │  │
│  [↑][↓][复制][删]      │   • 动作类型: 弹框 / 外链 / 路由   │  │ └───────────────────┘ │  │
│                       │   • 对应动作参数 + 「测试触发」     │  │ ┌───────────────────┐ │  │
│  快捷入口 (4项)   [开] │                                  │  │ │ 🏆 今日签到榜 LIVE │ │  │
│  下周模型投票 [定时][开]│  Tab 3: 投放与展示规则             │  │ │ 1. Alice  $1.20   │ │  │
│  活动预告         [开] │   • 置顶 / 默认折叠 / 端适配       │  │ │ 2. Bob    $0.95   │ │  │
│  社区红包         [开] │   • 可见角色 / 可见用户组          │  │ │ [ 查看完整榜单 ]   │ │  │
│                       │   • 上线时间 ~ 下线时间            │  │ └───────────────────┘ │  │
└───────────────────────┴──────────────────────────────────┴─────────────────────────────┘
```

### 关键体验细节

1. **模板商店（「+ 添加积木」弹窗）**：
   - 分三个页签：「内置模块」「通用卡片」「趣味互动」；
   - 每个卡片附带简短说明 + 推荐场景标签，点击即带**开箱可用的示例数据**插入列表并自动选中，管理员只需改文字/链接即可上线；
   - 内置单实例组件（如 `builtin.checkin`、`builtin.events`、`builtin.red_packets`）若已存在则标灰提示「已添加」，避免误添重复项；而 `builtin.checkin_leaderboard` 允许配置多张（例如一张「今日榜」+ 一张「近 30 天累计榜」）。
2. **零新依赖的排序体验**：
   - 首期提供清晰的「上移 / 下移 / 置顶」按钮（零新增第三方拖拽库，无障碍键盘友好）；后续如有需要再渐进增强拖拽排序。
3. **1:1 真实组件预览**：
   - 右侧预览区直接渲染真实的 `<BoardRenderer mode="preview" />`，不是手画假图；
   - 预览区点击「富文本弹框」「签到榜弹框」「幸运签」会**真实弹出弹窗**，方便管理员确认排版和深浅色模式效果；
   - 预览顶部支持切换「普通用户视图 / 管理员视图」以及「生效中 / 显示含定时与草稿」。
4. **未保存提示与版本冲突保护**：
   - 复用 `web/src/features/system-settings/components/form-navigation-guard.tsx` 防止误离开丢配置；
   - 保存遇到 `409 Conflict`（其他管理员刚改过）时，友好提示刷新最新配置。

---

## 十一、分阶段研发落地指南

建议按 **3 个独立可交付的阶段** 推进，避免一次性拉长 PR 战线，每阶段均可独立上线验收：

### 阶段一（MVP 核心底座 — 强烈建议首期交付）

**目标**：跑通「低代码动态栏底座 + 签到榜解耦独立 + 外链/站内/富文本弹框/内置弹框 + 后台可视化编排 + WS 热更新」。

- **后端**：
  1. `model/community_chat.go`：为 `CommunityConfig` 新增 `BoardCustomized`、`BoardVersion`、`BoardTitle`、`BoardSubtitle`、`BoardIcon`。
  2. `model/community_board.go`：定义 `CommunityBoardBlock` 模型、默认预设生成、严格校验函数（URL/路由白名单/长度/XSS 基础拦截）、事务保存与乐观锁、按用户角色/分组/时间过滤逻辑。
  3. `model/main.go`：将 `&CommunityBoardBlock{}` 加入 `AutoMigrate`。
  4. `controller/community_board.go` & `router/api-router.go`：实现 `GET /api/community/board`、`GET /api/option/community/board`、`PUT /api/option/community/board`、`POST /api/option/community/board/reset`（含限流与审计）。
  5. `controller/community_chat.go`：在 `CommunityWebSocket` 中增加 `{"type": "board", "version": ...}` 轻量推送。
- **前端**：
  1. 搭建 `web/src/features/community/board/` 底座：`types.ts`、`api.ts`、`variables.ts`、`action-runner.tsx`、`block-shell.tsx`、`block-registry.tsx`、`board-renderer.tsx`。
  2. 首批上线 **9 种高价值积木**：
     - 内置：`builtin.checkin`、`builtin.checkin_leaderboard`、`builtin.events`、`builtin.red_packets`
     - 通用：`custom.action_card`、`custom.link_grid`、`custom.banner`、`custom.notice`、`custom.copy_card`
  3. 改造 `community-board.tsx`、`community-checkin.tsx`、`use-chat.ts`、`index.tsx`（含 `chat_prefill` 联动）。
  4. 交付 `studio/` 后台可视化编排器 + `320px` 1:1 实时预览 + 模板库 + JSON 导入导出，并挂载为 `CommunitySettings` 第 4 个 Tab。
  5. 补全 7 个语言文件（`en`、`zh`、`zh-TW`、`fr`、`ja`、`ru`、`vi`）的全部 i18n 文案。

### 阶段二（趣味互动与运营增强）

**目标**：上线高互动「好玩功能」，拉升社区日活与停留。

- **后端**：
  1. 新增 `community_board_poll_votes` 与 `community_board_reactions` 表（注册到 `model/main.go`）。
  2. 实现投票查询/提交接口与应援打卡查询/触发接口（均加 `UserCriticalRateLimit` 与事务防重）。
  3. 扩展 `GET /api/community/board` 的统计快照字段（支持 `custom.kv_stats` 与 `interactive.goal_progress` 只读指标，加短期内存/Redis 缓存避免高频查库）。
- **前端**：
  1. 上线 `custom.countdown`、`custom.kv_stats`、`builtin.site_announcements`、`builtin.service_status`。
  2. 上线全部 5 种趣味互动积木：`interactive.poll`、`interactive.reaction_counter`、`interactive.mystery_tip`、`interactive.quick_redeem`、`interactive.goal_progress`。
  3. 支持 `modal_iframe` 安全沙箱弹框与管理员风险确认提示。

### 阶段三（生态与精细化体验升级）

**目标**：按实际运营反馈渐进增强，不提前过度设计。

- 编排器增加可视化拖拽排序（可选轻量实现，保留键盘上下移作为无障碍基线）。
- 支持多套「主题场景方案」保存与一键切换（例如「日常版」「节假日大促版」「维护公告版」）。
- 积木级点击统计（仅计数匿名 PV/点击量，供管理员判断哪些入口最受欢迎）。
- 按需支持「可复用到 Dashboard 首页侧栏」或与 Task Plugin 轻量联动（由独立需求评估）。

---

## 十二、测试与验收清单（研发对照必查）

### 12.1 后端测试与三库验证（强制）

遵循 `AGENTS.md` 后端测试与数据库兼容规范（测试使用 `testify/require` 与 `testify/assert`，集中放在 1 个紧凑测试文件如 `controller/community_board_test.go`）：

- [ ] **默认预设与兼容升级**：未初始化 `board_customized=false` 时返回完整默认积木，与原硬编码模块行为一致。
- [ ] **乐观锁与事务原子性**：并发提交过期 `version` 返回 `409`；非法配置提交整事务回滚，不产生半写数据。
- [ ] **权限与时间过滤**：普通用户无法在 `GET /api/community/board` 中看到禁用块、未上线块、已过期块、高角色限定块、非本分组限定块；管理员 `?preview=1` 可见，普通用户传 `?preview=1` 被忽略或拒绝。
- [ ] **安全校验**：拦截 `javascript:` / `data:` URL、非法站内路由、超长 payload、超量 block、嵌套 `modal_*`、无效 `http://` iframe URL。
- [ ] **互动防刷（阶段二）**：单选投票重复投被拒绝/幂等，应援打卡超出 `daily_limit` 被拦截。
- [ ] **三数据库真实运行验证**：在 **SQLite、MySQL（>= 5.7.8）、PostgreSQL（>= 9.6）** 真实实例上，分别验证：
  - 空库全新 `AutoMigrate` + 启动 2 次幂等性；
  - 从现有无 `community_board_blocks` 表的旧库升级迁移 + 既有 `community_configs` 凭据加密数据无损保留；
  - 完整增删改查、事务锁与唯一索引约束正常。

### 12.2 前端测试与质量检查（强制）

遵循 `web/AGENTS.md` 规范：

- [ ] **单元测试（Vitest + Testing Library）**：
  - 扩展 `web/src/features/community/__tests__/activities.test.tsx` 或 `chat.test.tsx`，覆盖默认布局渲染、独立签到榜积木（弹框模式与跳路由模式）、外链确认、富文本弹窗消毒（拒绝 `<script>` 执行）、`chat_prefill` 写入输入框、WebSocket `type: "board"` 触发刷新；
  - 覆盖后台编排器的添加模板、调整排序、保存与 `409` 冲突提示。
- [ ] **响应式与主题验证**：桌面 `300px`/`320px` 侧栏、移动端动态栏弹窗、深色/浅色主题均无溢出与截断错位。
- [ ] **国际化验证**：运行 `bun run i18n:sync`，补全 7 语种翻译，零硬编码中文/英文直出，日期/数字经 `toIntlLocale` 格式化。
- [ ] **构建与静态检查**：按单任务顺序执行 `bun run typecheck`、变更文件 lint 检查及前后端构建（遵守本机资源限制，不并发跑构建）。
