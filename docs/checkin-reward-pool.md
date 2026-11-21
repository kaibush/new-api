# 灵活签到奖池、分时段激励、每日统计看板与签到榜设计方案

本文档面向产品与研发实现者，在现有签到体系（`setting/operation_setting/checkin_setting.go`、`model/checkin*.go`、`controller/checkin.go`、`web/src/features/checkin/`）基础上，设计一套**支持“绝大多数降档控本 + 少数高额暴击”阶梯奖池、分时段比例调控、全局与每日风控上限、可配置保留周期（最长 30 天）的后台统计看板，以及用户端公开签到榜**的完整方案。

---

## 一、背景与思路完善

### 1.1 现状与局限

当前签到基础额度采用单一区间的**均匀随机（Uniform Random）**：

- 后台仅能配置 `min_quota` 与 `max_quota`（例如全员均匀随机 `15 ~ 20`，人均成本 `17.50`）。
- 所有用户无论何时签到，抽中各数值的概率完全均等：既无法降低绝大多数日常签到的固定成本，又缺乏“少数幸运用户获得高额奖励（暴击/锦鲤）”的惊喜感与传播度。
- 无法针对早高峰、午休、晚间或低谷时段设置差异化的中奖比例或额度系数，难以引导错峰活跃或按时段控本。
- 管理后台（`/checkin`）目前侧重于“用户消费活跃度核查”与“单用户签到余额明细”，缺少**按天维度的签到人数、各档位实际命中比例、各时段签到分布占比**的直观运营看板。
- 用户端缺少真实的获奖展示窗口：一旦将日常保底额度调低，若用户看不到他人真实抽中高额奖励，容易产生负面体感。

### 1.2 核心机制选型（完善产品设计中的关键权衡）

围绕“绝大部分人覆盖在降低后的签到额度上 + 少部分用户获得较高额度 + 最大额度控制 + 分时段比例 + 公开签到榜”的目标，若直接采用“每日固定总额池先到先得”，会出现 **0 点脚本蹲守抢空高额奖池、白天正常签到用户只能拿最低保底甚至无法签到** 的体验问题。

因此本方案采用 **「低档主覆盖概率阶梯 + 全局单次硬顶 + 可选每日奖池熔断回退 + 公开签到榜建立正反馈」** 的组合模型（不引入高阶档位冷却期，保持概率规则透明直观、无隐性黑箱限流）：

1. **多档位概率奖池（核心机制：降本与高额上限兼得）**
   - 管理员可配置 `2 ~ 6` 个奖励档位（推荐 3 ~ 4 档），每个档位独立设置 **触发比例** 与 **额度随机区间**：
     - **常规保底低档（如 80%）**：额度低于原水平（如 `6 ~ 10`），承接绝大多数日常签到，显著压低整体人均发放成本。
     - **进阶中档（如 14%）**：额度贴近原水平（如 `11 ~ 18`），维持正向波动体感。
     - **幸运暴击档（如 5%）**：额度高于原上限（如 `19 ~ 35`），制造高频小惊喜。
     - **锦鲤大奖档（如 1%）**：额度显著拉高（如 `36 ~ 60`），作为核心激励与签到榜高光来源。
   - **比例精度**：底层采用万分比整数 `weight_bps`（`10000 = 100.00%`），前端支持输入最多两位小数的百分比（如 `84.5%`、`15%`、`0.5%`），彻底规避浮点误差，同时支持 `0.01%` 级别的超稀有大奖。

2. **双重额度安全边界（单次最大额度 + 可选每日奖池上限）**
   - **单次最大额度硬顶（`max_quota`）**：必填。无论档位区间与时段加成系数如何叠加，单次签到最终基础奖励严格封顶不超过 `max_quota`。
   - **每日奖池风控上限（`daily_pool`，可选开关）**：支持设置“每日高阶奖励预算上限”或“单档位每日最多命中人数”。当某天高阶预算或名额耗尽时，后续抽中高阶档位的请求**不报错、不中断签到，而是自动平滑回退（Fallback）至第 1 档（保底低档）发放**，兼顾全天候体验与绝对成本可控。

3. **分时段签到比例（双维度灵活控制）**
   - 引入显式签到时区 `timezone`（IANA 标准时区，默认 `"Asia/Shanghai"`；若留空则回退服务端本地时区），解决容器默认 UTC 导致自然日切日与时段偏移的问题。
   - 支持配置不重叠的自定义时间区间（如 `06:00–09:00 早鸟时段`、`12:00–14:00 午间时段`、`20:00–22:00 晚间时段`），未命中任何自定义时段的时间自动匹配 **默认常规时段**。
   - 每个时段支持两个直观比例维度（可单独使用，也可组合）：
     - **时段专属档位比例（可选覆写）**：例如早鸟时段将高阶档位合计比例适度提升以鼓励早起活跃，其余常规/深夜时段把低档比例拉高至 `85% ~ 90%` 进一步控本。
     - **时段整体额度比例系数（`quota_bps`，默认 `10000` 即 `100%`）**：支持按时段上浮（如 `110%`）或下压（如低谷时段 `80%`），计算结果严格受全局 `max_quota` 封顶，且**不再被旧版 `min_quota` 强行向上抬升**。

4. **用户端公开签到榜（与降档控本形成体验闭环）**
   - 当 80% 左右用户落入更低额度区间时，配套上线**「签到榜」**（今日手气榜、近期欧皇高光、近期累计榜、我的今日排名与超越百分比），让普通用户直观看到真实上榜的大奖获得者，将“保底变低”转化为“冲榜博高额”的正向参与感。
   - 后台支持开关控制与**服务端强制用户名脱敏**，零暴露隐私字段。

5. **与现有两种签到模式完全正交兼容**
   - 现有 `mode = 1`（方式一：活跃度奖励，受新用户保护期、近期消费活跃度折算 `reduced_percent` 与月度上限 `monthly_cap` 约束，计入钱包与 `CheckinAccount.GiftRemaining`）与 `mode = 2`（方式二：限时独立额度 `CheckinGrant`，到期失效、优先扣减）保持不变。
   - 在 `mode = 1` 下，纯白嫖不消费用户会先在阶梯奖池中大概率落入低档，再叠加活跃度打折，把预算进一步精准留给真实消费用户。
   - 新增 `reward_mode` 字段：`"uniform"`（经典均匀随机，默认，保证老版本升级 100% 行为不变）与 `"tiered"`（灵活奖池模式）。

6. **统计数据最多保留 30 天且后台可配（账本与统计解耦）**
   - 配置项新增 `stats_retention_days`（整数，允许范围 `1 ~ 30`，默认 `30`，前后端强制上限 `30`）。
   - **关键架构原则**：将“统计看板、抽奖画像明细与榜单数据源”同现有的“资金与月度限额核心账本（`checkins`、`checkin_accounts`、`checkin_grants`）”严格解耦。
     - 原因：`mode = 1` 的月度上限核查（`evaluateCheckin`）需要汇总当月 1 日以来的 `checkins.quota_awarded`；若管理员将保留天数设为 `7` 天并直接删除 `checkins` 表记录，会导致用户当月已领额度统计归零、击穿月度上限，或破坏未过期 `CheckinGrant` 的关联。
     - 方案：新增轻量级聚合表 `checkin_daily_buckets`、抽奖画像明细表 `checkin_draw_logs` 及每日奖池状态表 `checkin_daily_pools`。这三张表严格按 `stats_retention_days`（最长 30 天）自动清理与裁剪展示，既满足数据保留合规与库表轻量要求，又保证核心账务绝对安全。

### 1.3 从原 `15 ~ 20` 切换的推荐参数对照（前端预设模板参考）

原方案均匀随机 `15 ~ 20` 的人均单次发放为 **`17.50`**，最高上限 `20`。结合“绝大部分人覆盖在降低后的额度 + 少数人冲高额”的目标，以下 3 套经过数学期望验证的参数组合可直接作为运营参考及前端设置页的**「一键填入推荐模板」**：

| 档位方案 | 档位分布（比例 / 额度区间） | 理论单次人均期望 `E[X]` | 相比原 `17.50` 预计节省 | 最高单次上限 | 适用场景与运营体感 |
| --- | --- | --- | --- | --- | --- |
| **方案 A：温和过渡型** | `75%` `10~13` / `18%` `14~20` / `6%` `21~32` / `1%` `33~50` | **`13.69`** | **节省 21.8%** | `50`（2.5x） | 已有稳定老用户群，首次切版过渡最平滑，仍有 25% 用户达到或超过旧水平 |
| **方案 B：均衡控本型（推荐默认）** | `80%` `6~10` / `14%` `11~18` / `5%` `19~35` / `1%` `36~60` | **`10.26`** | **节省 41.4%** | `60`（3.0x） | 80% 用户落在降档区间，成本接近腰斩，同时大奖拉高到 `60` 极具签到榜话题性 |
| **方案 C：强控本博弈型** | `85%` `3~7` / `11%` `8~15` / `3.5%` `16~35` / `0.5%` `36~80` | **`6.70`** | **节省 61.7%** | `80`（4.0x） | 成本预算极度敏感，绝大部分用户拿低保底，靠高频小暴击与超高锦鲤榜驱动留存 |

> 运营切换建议：若老用户对 `15 ~ 20` 已有较强心理锚点，建议先采用 **方案 A（同步上线签到榜，对外宣传“奖池升级，最高可领 50 额度”）**，观察 1 ~ 2 周后台看板与用户反馈后，再平滑下调至 **方案 B**。

---

## 二、业务计算流程与数学规则

### 2.1 奖励计算流水线

当用户发起 `POST /api/user/checkin` 时，在同一个数据库事务内按以下顺序执行：

```text
[1. 解析当前时区时间 nowInTZ 与自然日 today (YYYY-MM-DD)]
        │
        ▼
[2. 校验签到开关、今日是否已签到、计算 CheckinEligibility]
        │
        ▼
[3. 确定基础抽奖策略]
   ├─ reward_mode == "uniform" ──► 在 [min_quota, max_quota] 均匀随机得 base_quota
   │
   └─ reward_mode == "tiered"
        ├─ 3.1 匹配当前分钟数 (0..1439) 命中的时段 TimeSlot（未命中则取默认时段）
        ├─ 3.2 读取生效的档位权重列表（若时段开启 override_tiers 则用时段权重，否则用全局 tiers 权重）
        ├─ 3.3 生成 [0, 10000) 无偏随机整数 roll，按累计万分比命中初始档位 Tier_k
        ├─ 3.4 若开启每日奖池/档位名额上限：
        │       尝试原子扣减当日奖池/名额；若超限则标记 pool_fallback = true，降级至保底档 Tier_0
        ├─ 3.5 在最终生效档位的 [tier.min_quota, tier.max_quota] 内均匀随机得 raw_quota
        └─ 3.6 应用时段额度比例与全局封顶（不再使用旧 min_quota 向上抬升）：
                scaled = raw_quota * slot_quota_bps / 10000
                base_quota = clamp(scaled, 0, settings.MaxQuota)
                (允许保底低档与 <100% 时段打折真正生效，不被历史 min_quota 兜底拉高)
        │
        ▼
[4. 传入现有 checkinReward(base_quota, eligibility)]
   ├─ Mode 1: 应用活跃度分数 (RewardNumerator / RewardDenominator) 与 MonthlyRemaining 截断
   └─ Mode 2: 直接得到 awarded = base_quota，创建限时 CheckinGrant
        │
        ▼
[5. 写入 checkins 主账本 + 写入 checkin_draw_logs 明细 + 原子累加 checkin_daily_buckets 统计桶]
```

### 2.2 数值与安全不变量

- **全部使用整数运算**：
  - 档位概率使用万分比 `int`（`0 ~ 10000`），所有启用档位的 `weight_bps` 之和必须严格等于 `10000`。
  - 时段额度系数使用万分比 `quota_bps`（例如 `100% = 10000`，允许配置范围 `1000 ~ 50000` 即 `10% ~ 500%`）。
  - 缩放计算使用 `int64` 中间值：`scaled := int64(rawQuota) * int64(slotQuotaBps) / 10000`，再与 `0` 取 `max`、与 `int64(settings.MaxQuota)` 及 `int64(common.MaxQuota)` 取 `min`，严禁使用 `int(float64(...) * ...)` 裸浮点强转（遵循 `.agents/rules/billing.md`）。
- **`tiered` 模式与 `settings.MinQuota` 的关系**：
  - 在 `uniform` 模式下，`settings.MinQuota` 仍为随机区间下限。
  - 在 `tiered` 模式下，基础额度下限完全由各档位自身的 `tier.MinQuota`（以及时段系数）决定，**禁止**使用旧的 `settings.MinQuota` 对抽取结果执行向上抬升，避免管理员把低档下调后仍被旧值卡住。保存 `tiered` 配置时，服务端自动将 `settings.MinQuota` 同步写入 `min(tier.MinQuota)`，以保持兼容字段与历史调用方语义一致。
- **单用户钱包上限保护**：延续现有 `common.MaxWalletQuota`（`2^53 - 1`）检查，超出时返回 `ErrWalletQuotaLimitExceeded`。
- **配置单位与换算回显**：与现有 `CheckinSettingsSection` 一致，后端存储单位为内部额度整数（`QuotaPerUnit = 500000` 对应 `$1.00`），前端输入框下方实时展示 `formatQuotaWithCurrency` 货币折算金额。

---

## 三、配置模型设计（Backend Settings）

### 3.1 Go 配置结构体定义

扩展 `setting/operation_setting/checkin_setting.go` 中的 `CheckinSetting`（保持全部旧字段兼容）：

```go
const (
	CheckinRewardModeUniform = "uniform"
	CheckinRewardModeTiered  = "tiered"

	CheckinBpsTotal             = 10000 // 100.00%
	MaxCheckinTiers             = 6
	MaxCheckinTimeSlots         = 8
	DefaultCheckinRetentionDays = 30
	MinCheckinRetentionDays     = 1
	MaxCheckinRetentionDays     = 30

	DefaultLeaderboardTopN = 20
	MinLeaderboardTopN     = 5
	MaxLeaderboardTopN     = 50
)

// CheckinRewardTier 单个奖池档位配置
type CheckinRewardTier struct {
	Key           string `json:"key"`             // 稳定标识，如 "base", "regular", "lucky", "jackpot"
	Name          string `json:"name"`            // 展示名称，如 "日常保底", "进阶奖励", "幸运暴击", "锦鲤大奖"
	MinQuota      int    `json:"min_quota"`       // 档位最小额度 (0 <= MinQuota <= MaxQuota)
	MaxQuota      int    `json:"max_quota"`       // 档位最大额度 (<= CheckinSetting.MaxQuota)
	WeightBps     int    `json:"weight_bps"`      // 默认触发万分比 (0 ~ 10000，总和需为 10000)
	DailyMaxCount int    `json:"daily_max_count"` // 可选：该档位每日最多命中人数 (0 表示不限；第 0 档保底档强制为 0)
}

// CheckinTimeSlotWeight 时段内覆盖某档位的万分比
type CheckinTimeSlotWeight struct {
	TierKey   string `json:"tier_key"`
	WeightBps int    `json:"weight_bps"`
}

// CheckinTimeSlot 分时段签到策略
type CheckinTimeSlot struct {
	Key           string                  `json:"key"`            // 稳定标识，如 "early_bird"
	Name          string                  `json:"name"`           // 时段名称，如 "早鸟时段"
	StartMinute   int                     `json:"start_minute"`   // 起始分钟 [0, 1439]，如 06:00 = 360
	EndMinute     int                     `json:"end_minute"`     // 结束分钟 [1, 1440]，左闭右开 [StartMinute, EndMinute)
	QuotaBps      int                     `json:"quota_bps"`      // 时段额度系数万分比，默认 10000 (100%)；可小于 10000 做非高峰降本
	OverrideTiers bool                    `json:"override_tiers"` // 是否覆写各档位触发比例
	TierWeights   []CheckinTimeSlotWeight `json:"tier_weights"`   // 当 OverrideTiers=true 时，总和必须为 10000
}

// CheckinDailyPoolConfig 每日高阶奖池风控配置（可选）
type CheckinDailyPoolConfig struct {
	Enabled       bool  `json:"enabled"`         // 是否启用每日额外奖池上限
	DailyBonusCap int64 `json:"daily_bonus_cap"` // 每日高阶档位（非第 0 档）累计最多发放总额度；0 表示仅按单档位人数限制或不限
}

// CheckinLeaderboardConfig 用户端公开签到榜配置
type CheckinLeaderboardConfig struct {
	Enabled           bool `json:"enabled"`             // 是否对普通用户开放签到榜
	TopN              int  `json:"top_n"`               // 榜单展示前 N 名，范围 5 ~ 50，默认 20
	MaskUsername      bool `json:"mask_username"`       // 是否由服务端对用户名/昵称脱敏，默认 true
	ShowMyRank        bool `json:"show_my_rank"`        // 是否展示“我的今日排名与超越百分比”，默认 true
	ShowRecentJackpots bool `json:"show_recent_jackpots"` // 是否展示近期高阶档位欧皇播报，默认 true
}

// CheckinPoolSetting 灵活奖池、分时段、保留期与榜单配置（聚合为单字段，便于 Option 同步）
type CheckinPoolSetting struct {
	RewardMode          string                   `json:"reward_mode"`            // "uniform" (默认) | "tiered"
	Timezone            string                   `json:"timezone"`               // IANA 时区，默认 "Asia/Shanghai" 或空串表示 Local
	StatsRetentionDays  int                      `json:"stats_retention_days"`   // 统计与明细保留天数：1 ~ 30，默认 30
	Tiers               []CheckinRewardTier      `json:"tiers"`                  // 阶梯档位列表（第 0 项固定作为保底回退档）
	TimeSlotsEnabled    bool                     `json:"time_slots_enabled"`     // 是否启用分时段策略
	DefaultSlotQuotaBps int                      `json:"default_slot_quota_bps"` // 未命中自定义时段时的默认额度万分比，默认 10000
	TimeSlots           []CheckinTimeSlot        `json:"time_slots"`             // 自定义时段列表（互不重叠）
	DailyPool           CheckinDailyPoolConfig   `json:"daily_pool"`             // 每日奖池熔断配置
	Leaderboard         CheckinLeaderboardConfig `json:"leaderboard"`            // 用户端签到榜展示配置
}
```

在 `CheckinSetting` 中内嵌字段：

```go
type CheckinSetting struct {
	Mode          int                `json:"mode"`
	ExpirySeconds int                `json:"expiry_seconds"`
	Limits        CheckinLimits      `json:"limits"`
	Enabled       bool               `json:"enabled"`
	MinQuota      int                `json:"min_quota"` // uniform 模式为随机下限；tiered 模式保存时自动同步为 min(tiers.MinQuota) 仅作兼容显示
	MaxQuota      int                `json:"max_quota"` // 全局单次基础奖励最大额度硬顶（uniform 与 tiered 均生效）
	Pool          CheckinPoolSetting `json:"pool"`      // 新增：灵活奖池、分时段、保留期与签到榜设置
}
```

### 3.2 默认值填充与老数据平滑兼容（Normalization）

老版本数据库 `checkin_policy_states.settings` JSON 中不含 `pool` 字段，反序列化后 `Pool` 为零值。必须提供 `Normalize()` 方法在读取、校验与保存前幂等补齐默认值：

- `Pool.RewardMode == ""` → 设为 `"uniform"`。
- `Pool.StatsRetentionDays == 0` → 设为 `30`。
- `Pool.DefaultSlotQuotaBps == 0` → 设为 `10000`（即 `100%`）。
- 若老数据反序列化后 `Pool.Leaderboard.TopN == 0` → 设为 `20`，且当整个 `Leaderboard` 未显式配置时默认 `MaskUsername = true`、`ShowMyRank = true`、`ShowRecentJackpots = true`（可通过指针 `*bool` 或仅在 `TopN == 0 && !Enabled` 时初始化默认安全值，避免把管理员显式关闭的 `false` 覆盖回 `true`！）。
- 当 `Pool.RewardMode == "tiered"` 且 `len(Pool.Tiers) > 0` 时，保存前自动将 `settings.MinQuota` 同步为所有档位中最小的 `MinQuota`。
- 前端首次从 `uniform` 切换到 `tiered` 且 `Tiers` 为空时，自动填充 **方案 B（均衡控本型）** 按当前站点的额度比例自动缩放后的 4 档预设模板，同时提供一键切换方案 A/B/C 的快捷按钮。

### 3.3 严格校验规则（`Validate()`）

1. **保留天数校验**：`1 <= Pool.StatsRetentionDays <= 30`；超出范围（例如 `0`、`31`、负数）直接拒绝并返回明确错误。
2. **时区校验**：若 `Pool.Timezone != ""`，调用 `time.LoadLocation(Pool.Timezone)` 校验合法性。
3. **榜单配置校验**：`5 <= Pool.Leaderboard.TopN <= 50`。
4. **阶梯档位校验（当 `Pool.RewardMode == "tiered"` 时）**：
   - `2 <= len(Pool.Tiers) <= 6`。
   - 每个档位 `Key` 非空且唯一（仅允许 `[a-z0-9_-]`，长度 `1..32`），`Name` 去空白后非空（长度 `1..32`）。
   - `0 <= tier.MinQuota <= tier.MaxQuota <= settings.MaxQuota <= common.MaxQuota`（保证任何档位上限都不超过全局最大额度 `settings.MaxQuota`）。
   - 第 0 档（保底档）必须满足 `tier[0].DailyMaxCount == 0` 且 `tier[0].MaxQuota > 0`（当 `settings.Enabled` 开启时），确保高阶奖池耗尽回退时永远可用。
   - 所有档位 `0 <= tier.WeightBps <= 10000`，且 `sum(WeightBps) == 10000`。
5. **分时段校验（当 `Pool.TimeSlotsEnabled == true` 时）**：
   - `1 <= len(Pool.TimeSlots) <= 8`，`1000 <= Pool.DefaultSlotQuotaBps <= 50000`。
   - 每个时段 `0 <= StartMinute < EndMinute <= 1440`（若需支持跨零点时段如 `22:00–02:00`，存储层统一要求 `StartMinute < EndMinute`，前端提供跨零点自动拆分为 `22:00–24:00` 与 `00:00–02:00`，后端排序校验相邻区间 `prev.EndMinute <= curr.StartMinute` 杜绝重叠）。
   - `1000 <= slot.QuotaBps <= 50000`。
   - 若 `slot.OverrideTiers == true`，`slot.TierWeights` 必须覆盖全部已定义 `tier.Key`，每项 `0 <= WeightBps <= 10000` 且总和严格等于 `10000`。
6. **每日奖池校验**：
   - `0 <= Pool.DailyPool.DailyBonusCap <= common.MaxWalletQuota`；若 `Pool.DailyPool.Enabled == true`，要求 `DailyBonusCap > 0` 或至少有一个高阶档位配置了 `DailyMaxCount > 0`。

### 3.4 配置同步修改点清单（必查）

由于项目使用 `CheckinPolicyState` 作为权威配置源并同步导出 `options` 表，修改 `CheckinSetting` 时必须同步更新以下 4 处：

1. `setting/operation_setting/checkin_setting.go`：结构体默认值、`Normalize()`、`Validate()`。
2. `model/checkin_settings.go`：
   - `InitializeCheckinAccounting()` 查询键列表加入 `"checkin_setting.pool"`。
   - `writeCheckinConfiguration()` 导出 `fields` map 加入 `"pool": current.Settings.Pool`。
   - `applyCheckinOption()` 的 `switch` 加入 `case "checkin_setting.pool":`。
3. `controller/option.go`：`GetOptions()` 中回填 `checkin_setting.*` 的 map 加入 `"pool": checkinConfig.Settings.Pool`。
4. `model/option.go`：`validateOptionValue()` 增加 `key == "checkin_setting.pool"` 的 JSON 反序列化与 `Pool.Validate` 校验（注意避开现有 `option.go` 中 `helpcenter.Parse` 分支，不要把 `checkin_setting.pool` 写进 `helpcenter.Parse` 条件中）。

---

## 四、数据库模型与 30 天自动清理设计

所有数据库设计严格兼容 **SQLite、MySQL >= 5.7.8、PostgreSQL >= 9.6**，不使用数据库专有 JSON 函数、`AUTO_INCREMENT`/`SERIAL` 手写语法或 `ALTER COLUMN`。

### 4.1 新增数据表设计

#### 1）`checkin_daily_buckets`（每日多维统计聚合桶表）

采用规范化多维度计数器行替代单行 JSON 更新，避免高并发签到下读写 JSON 造成的锁串行化与方言差异。每天仅产生约 `1 (summary) + 6 (tiers) + 9 (slots) + 24 (hours) ≈ 40` 行，30 天总行数不超过 `1,200` 行，看板查询可在毫秒级返回。

```go
// BucketType 枚举常量：
// - "summary" : BucketKey 固定为 "all"（记录当日总签到人数、总发放额度、保底回退次数、单次最高额度）
// - "tier"    : BucketKey 为档位 key（如 "base", "regular", "lucky", "jackpot"；uniform 模式记为 "uniform"）
// - "slot"    : BucketKey 为时段 key（未命中自定义时段记为 "default"）
// - "hour"    : BucketKey 为两位小时字符串 "00" ~ "23"（基于签到时区）
type CheckinDailyBucket struct {
	StatDate      string `gorm:"type:varchar(10);primaryKey" json:"stat_date"`   // YYYY-MM-DD
	BucketType    string `gorm:"type:varchar(16);primaryKey" json:"bucket_type"` // summary | tier | slot | hour
	BucketKey     string `gorm:"type:varchar(32);primaryKey" json:"bucket_key"`
	BucketLabel   string `gorm:"type:varchar(64);not null" json:"bucket_label"`  // 当时的可读名称快照（便于历史展示）
	CheckinCount  int64  `gorm:"not null" json:"checkin_count"`
	TotalQuota    int64  `gorm:"not null" json:"total_quota"`
	FallbackCount int64  `gorm:"not null" json:"fallback_count"`                 // 触发奖池上限回退次数
	MaxAwardQuota int    `gorm:"not null" json:"max_award_quota"`                // 当日该维度最大单次发放额度
	UpdatedAt     int64  `gorm:"not null" json:"updated_at"`
}
```

#### 2）`checkin_draw_logs`（签到抽奖画像明细表，兼作签到榜数据源，受 `stats_retention_days` 管控）

同时服务于**后台每日抽奖明细下钻**与**用户端公开签到榜**（复用 `(checkin_date, quota_awarded)`、`is_high_tier` 等索引，无需重复建榜单表）：

```go
type CheckinDrawLog struct {
	ID              int64  `gorm:"primaryKey" json:"id"`
	CheckinID       int    `gorm:"not null;uniqueIndex:idx_checkin_draw_checkin_id" json:"checkin_id"`
	UserID          int    `gorm:"not null;index:idx_checkin_draw_user_date,priority:1" json:"user_id"`
	CheckinDate     string `gorm:"type:varchar(10);not null;index:idx_checkin_draw_date_quota,priority:1;index:idx_checkin_draw_date_tier,priority:1;index:idx_checkin_draw_date_slot,priority:1;index:idx_checkin_draw_user_date,priority:2" json:"checkin_date"`
	CheckinHour     int    `gorm:"not null" json:"checkin_hour"` // 0 ~ 23
	RewardMode      string `gorm:"type:varchar(16);not null" json:"reward_mode"`
	TierKey         string `gorm:"type:varchar(32);not null;index:idx_checkin_draw_date_tier,priority:2" json:"tier_key"`
	TierName        string `gorm:"type:varchar(64);not null" json:"tier_name"`
	TierRank        int    `gorm:"not null;index:idx_checkin_draw_high_tier,priority:1" json:"tier_rank"` // 0=保底档，>=1=高阶档位（用于快速筛查欧皇高光）
	OriginalTierKey string `gorm:"type:varchar(32);not null" json:"original_tier_key"`                     // 若发生奖池回退，记录原本抽中的档位
	PoolFallback    bool   `gorm:"not null" json:"pool_fallback"`
	SlotKey         string `gorm:"type:varchar(32);not null;index:idx_checkin_draw_date_slot,priority:2" json:"slot_key"`
	SlotName        string `gorm:"type:varchar(64);not null" json:"slot_name"`
	SlotQuotaBps    int    `gorm:"not null" json:"slot_quota_bps"`
	RollBps         int    `gorm:"not null" json:"roll_bps"`       // [0, 10000) 原始随机点位，便于审计核查概率公平性
	RawTierQuota    int    `gorm:"not null" json:"raw_tier_quota"` // 档位随机原始值
	BaseQuota       int    `gorm:"not null" json:"base_quota"`     // 经时段系数与全局上限截断后的基础额度
	RewardPercent   int    `gorm:"not null" json:"reward_percent"` // 活跃度折算比例快照
	QuotaAwarded    int    `gorm:"not null;index:idx_checkin_draw_date_quota,priority:2" json:"quota_awarded"`
	CreatedAt       int64  `gorm:"not null;index:idx_checkin_draw_created_at;index:idx_checkin_draw_high_tier,priority:2" json:"created_at"`
}
```

#### 3）`checkin_daily_pools`（每日奖池与高阶名额原子计数表）

```go
// PoolKey 约定：
// - "__bonus_quota__" : 当日非保底档累计发放额度控制
// - "tier:<tier_key>" : 指定高阶档位当日已命中次数控制
type CheckinDailyPool struct {
	StatDate  string `gorm:"type:varchar(10);primaryKey"`
	PoolKey   string `gorm:"type:varchar(48);primaryKey"`
	UsedQuota int64  `gorm:"not null"`
	WinCount  int64  `gorm:"not null"`
	UpdatedAt int64  `gorm:"not null"`
}
```

### 4.2 跨数据库并发与锁安全规范

1. **SQLite 写锁与 MySQL/PostgreSQL 行锁兼容**：
   - `UserCheckin` 事务起始阶段已通过 `checkinAccount(tx, userId, now)` 执行 `OnConflict{DoNothing: true}.Create` + `lockForUpdate(tx)` 获取了 SQLite 写锁及当前用户的行锁。
   - **禁止**使用已废弃的 `tx.Set("gorm:query_option", "FOR UPDATE")`；需要行锁时统一使用 `model` 包内的 `lockForUpdate(tx)`。
2. **每日奖池原子限额扣减（无死锁、无方言差异）**：
   - 当抽中非保底档 `tier_k` 且启用了 `DailyPool` 或 `tier_k.DailyMaxCount > 0` 时，按主键字典序 `("__bonus_quota__" -> "tier:" + tier_k.Key)` 先 `OnConflict{DoNothing: true}.Create`，再用 `lockForUpdate(tx)` 读取这 1 ~ 2 行，确认余额与名额均充足后一次性 `Updates`；任一不足则直接走 `Tiers[0]` 保底档并记 `pool_fallback = true`。
   - 由于 `80%+` 的保底档用户完全不触碰 `checkin_daily_pools`，仅极少量抽中高阶档位的请求串行化这 1 ~ 2 行，吞吐性能高且无死锁风险。
3. **每日统计桶更新（零死锁固定顺序）**：
   - 参考 `model/checkin_policy.go` 中 `adjustCheckinUsageDay` 的成熟模式：按 `(BucketType, BucketKey)` 字典序固定顺序（`"hour"` → `"slot"` → `"summary"` → `"tier"`）依次执行：
     1. `tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&bucket)`
     2. 原子更新计数与额度；对于 `MaxAwardQuota`，使用 SQLite / MySQL 5.7+ / PostgreSQL 9.6+ 均原生支持的标准 SQL `CASE WHEN max_award_quota < ? THEN ? ELSE max_award_quota END`。
4. **签到榜读放大保护（短 TTL 缓存）**：
   - 公开签到榜的公共榜单数据（今日 Top N、近期欧皇高光、保留期内累计榜）所有用户完全一致，建议在 `service/` 或 `model/` 层使用进程内短缓存（若启用 Redis 亦可写入短 TTL key，TTL 设为 `15 ~ 30 秒`），仅「我的今日排名」按当前登录用户按需点查，避免早高峰大量用户打开榜单时反复扫描数据库。

### 4.3 数据最多保存 30 天（可配置）清理机制

采用 **「查询窗口实时截断 + 后台定时分批物理删除」** 双保险策略：

1. **保留窗口定义**：
   - 读取当前权威配置 `retentionDays := clamp(settings.Pool.StatsRetentionDays, 1, 30)`。
   - 以配置的签到时区计算今日 `todayDate`，最早保留自然日为：
     `cutoffDate := todayStartInTZ.AddDate(0, 0, -(retentionDays - 1)).Format("2006-01-02")`
   - 例如今天是 `2026-11-20`：
     - `retentionDays = 1` 时，仅保留 `2026-11-20` 当天数据（`< "2026-11-20"` 视为过期）。
     - `retentionDays = 30` 时，保留 `2026-10-22 ~ 2026-11-20` 共 30 个自然日的数据。
2. **查询层实时拦截**：
   - 管理端统计看板、抽奖明细与用户端签到榜查询均强制注入条件 `stat_date >= cutoffDate` / `checkin_date >= cutoffDate`。管理员调小保留天数保存后即时生效，无需等待后台清理周期。
3. **后台定时物理清理任务 `StartCheckinStatsCleanup()`**：
   - 参考 `service/auth_cleanup.go`，在 `main.go` 启动阶段拉起后台协程：启动后延迟 30 秒执行首次清理，之后每 `1 小时` 执行一次；同时在 `UpdateCheckinSettings` 调小 `stats_retention_days` 成功后异步触发一次非阻塞清理。
   - **分批删除防锁表**（严禁单条无界大 `DELETE`）：
     - `checkin_draw_logs`：每次按 `WHERE checkin_date < ?` 查出最多 `500` 个主键 `id`（`Order("id").Limit(500).Pluck("id", &ids)`），再按 `WHERE id IN ?` 删除，循环直至本轮清理完或达到单轮安全上限（如 `10,000` 行）。
     - `checkin_daily_buckets` 与 `checkin_daily_pools`：每天仅数十行，直接按 `WHERE stat_date < ?` 删除即可。
   - `model/main.go` 的 `AutoMigrate` 列表注册 `&CheckinDailyBucket{}`、`&CheckinDrawLog{}`、`&CheckinDailyPool{}`。

---

## 五、API 接口契约设计

### 5.1 管理端配置接口（扩展现有接口）

- `GET /api/option/checkin`（权限：`RootAuth`）
- `PUT /api/option/checkin`（权限：`RootAuth`，沿用 `version` 乐观锁防止多管理员覆盖）

以下以 **方案 B（均衡控本型：`6~10` 80% / `11~18` 14% / `19~35` 5% / `36~60` 1%，按 `$1 = 500,000` 内部额度换算）** 为例展示 `settings.pool`：

```json
{
  "settings": {
    "enabled": true,
    "mode": 1,
    "expiry_seconds": 86400,
    "min_quota": 3000000,
    "max_quota": 30000000,
    "limits": {
      "enabled": true,
      "monthly_cap": 300000000,
      "activity_days": 30,
      "minimum_spend": 50000,
      "reduced_percent": 20,
      "new_user_days": 7
    },
    "pool": {
      "reward_mode": "tiered",
      "timezone": "Asia/Shanghai",
      "stats_retention_days": 30,
      "tiers": [
        {
          "key": "base",
          "name": "日常保底",
          "min_quota": 3000000,
          "max_quota": 5000000,
          "weight_bps": 8000,
          "daily_max_count": 0
        },
        {
          "key": "regular",
          "name": "进阶奖励",
          "min_quota": 5500000,
          "max_quota": 9000000,
          "weight_bps": 1400,
          "daily_max_count": 0
        },
        {
          "key": "lucky",
          "name": "幸运暴击",
          "min_quota": 9500000,
          "max_quota": 17500000,
          "weight_bps": 500,
          "daily_max_count": 0
        },
        {
          "key": "jackpot",
          "name": "锦鲤大奖",
          "min_quota": 18000000,
          "max_quota": 30000000,
          "weight_bps": 100,
          "daily_max_count": 10
        }
      ],
      "time_slots_enabled": true,
      "default_slot_quota_bps": 10000,
      "time_slots": [
        {
          "key": "early_bird",
          "name": "早鸟时段",
          "start_minute": 360,
          "end_minute": 540,
          "quota_bps": 11000,
          "override_tiers": true,
          "tier_weights": [
            { "tier_key": "base", "weight_bps": 7000 },
            { "tier_key": "regular", "weight_bps": 1900 },
            { "tier_key": "lucky", "weight_bps": 900 },
            { "tier_key": "jackpot", "weight_bps": 200 }
          ]
        },
        {
          "key": "late_night",
          "name": "深夜时段",
          "start_minute": 0,
          "end_minute": 360,
          "quota_bps": 8500,
          "override_tiers": false,
          "tier_weights": []
        }
      ],
      "daily_pool": {
        "enabled": true,
        "daily_bonus_cap": 300000000
      },
      "leaderboard": {
        "enabled": true,
        "top_n": 20,
        "mask_username": true,
        "show_my_rank": true,
        "show_recent_jackpots": true
      }
    }
  },
  "version": 3
}
```

### 5.2 管理端每日签到比例与趋势统计接口（新增）

- **路由**：`GET /api/user/checkin/analytics`（挂载于 `router/api-router.go` 的 `adminRoute` 下，中间件：`AdminAuth()` + `DisableCache()`）
- **Query 参数**：
  - `days`：可选，整数 `1 ~ 30`，默认 `min(7, stats_retention_days)`；若传入大于 `stats_retention_days` 则自动截断为 `stats_retention_days`。
  - `date`：可选，指定观察单日 `YYYY-MM-DD`（用于下方“单日时段占比与档位剖析”，默认取当前签到时区的 `today`；若早于 `cutoffDate` 则返回空桶与边界提示）。
- **响应结构**：

```json
{
  "success": true,
  "data": {
    "timezone": "Asia/Shanghai",
    "today": "2026-11-20",
    "retention_days": 30,
    "earliest_date": "2026-10-22",
    "selected_date": "2026-11-20",
    "reward_mode": "tiered",
    "summary": {
      "total_checkins": 3420,
      "total_quota": 17560000000,
      "avg_quota": 5134502,
      "max_award_quota": 29500000,
      "high_tier_count": 674,
      "high_tier_user_bps": 1971,
      "fallback_count": 6,
      "today_checkins": 512,
      "yesterday_checkins": 486,
      "today_bonus_used": 182000000,
      "today_bonus_cap": 300000000
    },
    "daily_series": [
      {
        "date": "2026-11-19",
        "total_checkins": 486,
        "total_quota": 2498000000,
        "fallback_count": 0,
        "tiers": [
          { "key": "base", "label": "日常保底", "count": 391, "user_bps": 8045, "quota": 1564000000, "quota_bps": 6261 },
          { "key": "regular", "label": "进阶奖励", "count": 66, "user_bps": 1358, "quota": 478500000, "quota_bps": 1916 },
          { "key": "lucky", "label": "幸运暴击", "count": 24, "user_bps": 494, "quota": 324000000, "quota_bps": 1297 },
          { "key": "jackpot", "label": "锦鲤大奖", "count": 5, "user_bps": 103, "quota": 131500000, "quota_bps": 526 }
        ]
      }
    ],
    "tier_breakdown": [
      {
        "key": "base",
        "label": "日常保底",
        "configured_bps": 8000,
        "actual_count": 2746,
        "actual_user_bps": 8029,
        "total_quota": 10984000000,
        "actual_quota_bps": 6255
      }
    ],
    "slot_breakdown": [
      {
        "key": "early_bird",
        "label": "早鸟时段 (06:00-09:00)",
        "count": 164,
        "user_bps": 3203,
        "total_quota": 1045000000,
        "quota_bps": 3943,
        "avg_quota": 6371951
      },
      {
        "key": "default",
        "label": "常规时段",
        "count": 310,
        "user_bps": 6055,
        "total_quota": 1468000000,
        "quota_bps": 5540,
        "avg_quota": 4735483
      },
      {
        "key": "late_night",
        "label": "深夜时段 (00:00-06:00)",
        "count": 38,
        "user_bps": 742,
        "total_quota": 137000000,
        "quota_bps": 517,
        "avg_quota": 3605263
      }
    ],
    "hourly_distribution": [
      { "hour": 0, "count": 12, "user_bps": 234, "total_quota": 42000000 }
    ]
  }
}
```

> 说明：所有比例字段统一返回整数万分比 `*_bps`（如 `8045` 表示 `80.45%`），前端按当前语言环境统一格式化百分比展示。对于区间内无人签到的自然日，后端补齐 `total_checkins: 0` 的连续日期点，保证图表 X 轴连续不跳天。

### 5.3 管理端签到抽奖明细分页接口（新增）

- **路由**：`POST /api/user/checkin/draws`（权限：`AdminAuth()` + `DisableCache()`）
- **请求体**：

```json
{
  "page": 1,
  "page_size": 20,
  "date": "2026-11-20",
  "tier_key": "",
  "slot_key": "",
  "search": "",
  "sort": "quota_desc"
}
```

  - `sort` 支持：`"time_desc"`（最新签到优先，默认）、`"quota_desc"`（最高额度优先）、`"quota_asc"`。
  - `search` 支持按用户名、显示名或数字用户 ID 过滤。
  - `date` 为空时查询整个有效保留窗口内记录；早于 `cutoffDate` 时直接返回空列表。
- **响应体**：返回标准分页 `{ items, total, page, page_size }`，每条包含 `user_id`、`username`、`display_name`、`checkin_date`、`created_at`、`tier_key`、`tier_name`、`tier_rank`、`pool_fallback`、`slot_key`、`slot_name`、`slot_quota_bps`、`raw_tier_quota`、`base_quota`、`reward_percent`、`quota_awarded`。

### 5.4 用户端签到状态与执行接口（向后兼容增强）

- `GET /api/user/checkin`：
  - `eligibility.BaseMinQuota` 与 `eligibility.BaseMaxQuota`：在 `tiered` 模式下自动取当前时段可达最低保底额度与最高可达基础额度（封顶于 `settings.MaxQuota`），使现有日历卡片无需大改即可正确显示如 `$6.00 ~ $60.00`。
  - 新增可选展示元数据 `reward_hint`（包含 `reward_mode`、`active_slot_name`、`leaderboard_enabled`），供个人中心卡片显示“当前时段提示”与“查看签到榜”入口按钮。
- `POST /api/user/checkin`：
  - 保留原有 `quota_awarded`、`checkin_date` 字段不变。
  - 新增返回 `tier_key`、`tier_name`、`tier_rank`、`slot_name`、`is_high_tier`（`tier_rank >= 1` 为 `true`）：抽中高阶档位时前端给予专属徽章高亮反馈，并引导查看今日手气榜。

### 5.5 用户端公开签到榜接口（新增）

- **路由**：`GET /api/user/checkin/leaderboard`（挂载于 `router/api-router.go` 的 `selfRoute` 普通登录用户路由组下）
- **访问控制与关闭态**：若签到未开启或 `pool.leaderboard.enabled == false`，返回 `{ "success": true, "data": { "enabled": false } }`（或清晰关闭态，前端自动隐藏入口）。
- **Query 参数**：
  - `tab`：可选，`"today"`（今日手气榜，默认） | `"jackpots"`（近期欧皇高光） | `"period"`（保留期内累计榜，默认近 `min(7, retention_days)` 天或支持 `days=7|30`）。
- **隐私脱敏强约束（服务端执行，严禁明文下发后前端遮罩）**：
  - 所有非本人条目**严禁返回** `user_id`、邮箱、钱包余额、消费活跃度或完整原始用户名。
  - 展示名优先取 `display_name`，为空则取 `username`；当 `mask_username == true` 时在服务端执行脱敏（按 Unicode rune 长度：`<=2` 字符保留首字 + `***`；`3~5` 字符保留首尾各 1 字中间 `***`；`>=6` 字符保留前 2 后 2 中间 `***`），并附加 `is_me: true|false` 布尔标记高亮当前用户自己。
- **响应结构示例**：

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "today": "2026-11-20",
    "timezone": "Asia/Shanghai",
    "retention_days": 30,
    "top_n": 20,
    "today_total_checkins": 512,
    "show_recent_jackpots": true,
    "my_rank": {
      "checked_in": true,
      "rank": 184,
      "quota_awarded": 4500000,
      "tier_key": "base",
      "tier_name": "日常保底",
      "beat_percent_bps": 6406
    },
    "today_top": [
      {
        "rank": 1,
        "display_name": "al***en",
        "is_me": false,
        "quota_awarded": 29500000,
        "tier_key": "jackpot",
        "tier_name": "锦鲤大奖",
        "tier_rank": 3,
        "slot_name": "早鸟时段",
        "checkin_at": 1763594208
      }
    ],
    "recent_jackpots": [
      {
        "checkin_date": "2026-11-20",
        "display_name": "al***en",
        "is_me": false,
        "quota_awarded": 29500000,
        "tier_key": "jackpot",
        "tier_name": "锦鲤大奖",
        "tier_rank": 3,
        "checkin_at": 1763594208
      }
    ],
    "period_top": [
      {
        "rank": 1,
        "display_name": "ki***88",
        "is_me": false,
        "checkin_days": 7,
        "total_quota": 62500000,
        "best_award": 28000000
      }
    ]
  }
}
```

> 排名与超越百分比算法：`my_rank.rank` 按 `COUNT(*) WHERE checkin_date = today AND (quota_awarded > myQuota OR (quota_awarded = myQuota AND id < myLogID)) + 1` 计算，并列额度先签到者排前；`beat_percent_bps = (totalCheckins - rank) * 10000 / max(totalCheckins - 1, 1)`（仅 1 人签到时为 `10000`）。

---

## 六、管理后台与前端交互设计（直观、好看、易懂、清晰）

前端严格遵循 `web/AGENTS.md` 与项目 `shadcn-ui` 规范：优先复用项目已有组件，图表统一使用 `@visactor/react-vchart`（配合 `@/lib/vchart` 的 `VCHART_OPTION` 与深浅色主题切换），金额额度统一使用 `@/lib/currency` 的 `formatQuotaWithCurrency`，普通数字使用 `@/lib/format` 的 `formatNumber` 并通过 `@/i18n/languages` 的 `toIntlLocale` 转换语言标签。

### 6.1 管理端页面结构与入口整合

在 `web/src/features/checkin/index.tsx`（路由 `/checkin`）中优化顶部 `Tabs` 结构：

1. **`签到数据看板`（新增 Tab，设为从签到设置页跳转的默认激活项）**：聚焦每日签到人数、档位命中比例、分时段占比与高额明细。
2. **`签到与余额`（现有 `CheckinActivityPanel`）**：单用户活跃度资格、钱包与限时签到余额核查。
3. **`全局消费概览` / `用户消费`（现有 `UserActivityOverviewPanel` / `UserActivityUsersPanel`）**：API 消耗活跃度分析。

顶部右侧工具栏提供：
- 周期选择器：`今日`、`近 7 天`、`近 14 天`、`近 N 天（最大 = 当前 stats_retention_days）`。
- 单日聚焦选择器：复用 `@/components/date-picker`，禁选早于 `earliest_date` 或晚于 `today` 的日期。
- 保留期状态胶囊徽标（`Badge variant="secondary"`）：`数据最多保留 {{days}} 天`，管理员点击可直接跳转 `/system-settings/billing/checkin` 修改保留时长。

### 6.2 管理端「签到数据看板」四层可视化布局

```text
+-----------------------------------------------------------------------------------+
| [Tab: 签到数据看板] [签到与余额] [全局消费概览]     [近7天 v] [2026-11-20] [刷新] |
| 数据保留期：最近 30 天（2026-10-22 至 2026-11-20） · 时区：Asia/Shanghai          |
+-------------------+-------------------+---------------------+---------------------+
| 今日签到人数       | 周期累计发放额度   | 高阶奖励实际命中率   | 今日奖池预算使用     |
| 512 人 (+5.3%)    | $35,120.00        | 19.71% (674 人次)   | $364 / $600 (60.7%) |
| 周期累计 3,420 人次| 人均单次 $10.27   | 理论配置占比 20.00%  | [========----] 回退6|
+-------------------+-------------------+---------------------+---------------------+
| 每日签到趋势与各档位占比 (占 8 列)              | 档位命中结构对比 (占 4 列)        |
| [视图切换: 按人数 | 按100%比例 | 按发放额度]    |       ( 环形图 Donut )            |
|   █ 锦鲤大奖  ▓ 幸运暴击  ▒ 进阶  ░ 日常保底    |  ● 日常保底  实际 80.3% / 配 80%  |
|   柱状堆叠趋势图（点击任意日期柱子下钻到该日）   |  ● 进阶奖励  实际 13.7% / 配 14%  |
|                                                 |  ● 幸运暴击  实际  5.0% / 配  5%  |
|                                                 |  ● 锦鲤大奖  实际  1.0% / 配  1%  |
+----------------------------------------+------------------------------------------+
| 分时段签到人数与额度比例（单日/周期）   | 24 小时签到热度分布 (00:00 - 23:00)       |
| 早鸟时段 (06:00-09:00)   164人  32.0%  |   ▁ ▁ ▂ ▆ █ ▅ ▃ ▄ ▃ ▂ ▂ ▅ ▆ ▄ ▂ ▁        |
| [========----------------] 额度占 39.4%|  清晰识别用户真实活跃波峰，指导时段配置    |
| 常规时段 (其余时间)      310人  60.6%  |                                           |
| [===============---------] 额度占 55.4%|                                           |
| 深夜时段 (00:00-06:00)    38人   7.4%  |                                           |
| [==----------------------] 额度占  5.2%|                                           |
+----------------------------------------+------------------------------------------+
| 签到抽奖明细与高额榜单                                                             |
| [搜索用户名/ID] [全部档位 v] [全部时段 v] [排序: 最高额度优先(欧皇榜) v]          |
| 用户      | 签到时间 | 所属时段 | 命中档位        | 基础额度 | 折算比例 | 实发额度 |
| alice     | 07:12:08 | 早鸟时段 | [锦鲤大奖]      | $59.00   | 100%     | $59.00   |
| bob       | 08:45:21 | 早鸟时段 | [日常保底·回退] | $8.50    | 100%     | $8.50    |
+-----------------------------------------------------------------------------------+
```

#### 视觉与易用性细节要求：

1. **语义化档位配色（兼顾亮色与暗色主题）**：
   - 第 0 档（保底低档）：中性柔和蓝灰/主色浅阶，传达稳定基数，避免视觉喧宾夺主。
   - 中间进阶/幸运档：活力青色 / 翠绿色（Sky / Emerald）。
   - 顶层大奖档：暖琥珀金 / 紫罗兰（Amber / Violet），在堆叠柱状图、环形图与明细表格 `Badge` 中保持完全一致的色彩映射。
2. **一图三看切换（`ToggleGroup`）**：
   - **按签到人数**：观察每日活跃规模与各档位绝对人数。
   - **按 100% 比例堆叠**：将每天归一化为 `100%` 柱高，管理员一眼核验每天各档位实际发放比例是否稳定贴合设定值。
   - **按发放额度**：直接看出 1% ~ 5% 的高阶奖励占用了当日多少预算，以及日常保底降档后省下了多少成本。
3. **实际比例 vs 设定比例直观对照**：
   - 右侧环形图下方采用紧凑对比列表，同时列出 `实际人数占比`、`设定目标比例` 与 `实际额度占比`，无需心算。
4. **分时段卡片 + 24 小时热度分布**：
   - 左侧用水平 `Progress` 条展示自定义时段的人数占比、额度占比与人均额度；右侧展示 `00:00 ~ 23:00` 真实分布，未开启分时段时也自动采集展示，辅助管理员科学划定时间区间。
5. **无障碍与空状态**：
   - 所有 `VChart` 图表参考现有 `UserActivityTrend` 模式，附带 `sr-only` 语义化列表，数据为空时统一渲染 `@/components/empty-state` 的 `EmptyState`。

### 6.3 管理端「签到设置页」交互设计（`CheckinSettingsSection`）

为避免复杂配置带来理解门槛，设置页采用**渐进式展开 + 一键推荐模板 + 实时比例校验条 + 成本期望测算卡**：

1. **奖励分配方式选择（`Select`）**：
   - `经典均匀随机`：仅展示现有的最小额度、最大额度输入框，保持极简。
   - `灵活奖池与分时段模式`：隐藏旧的单一 `min_quota` 输入框（由下方档位区间直接决定），展开以下四个清晰分区。
2. **分区 A：全局上限与数据保留设置**：
   - **单次最高奖励额度上限（`max_quota`）**：输入内部额度并实时回显 `formatQuotaWithCurrency` 货币值，注明“所有档位与时段加成后的单次基础奖励均不会超过此上限”。
   - **签到统计时区（`timezone`）**：下拉选择常用时区（默认 `Asia/Shanghai`、支持 `UTC` 及常见时区）。
   - **统计数据保留天数（`stats_retention_days`）**：数字输入（`min=1, max=30`，默认 `30`）+ 快捷按钮（`7 天` / `15 天` / `30 天`），明确提示：“控制后台每日签到统计看板、抽奖明细与签到榜历史保留时长，最多 30 天，超期自动清理且不影响账户已发放额度与当月上限核算”。
3. **分区 B：奖池档位比例编辑器**：
   - 顶部提供 **一键控本预设芯片**：`温和过渡（省约 22%）`、`均衡控本（省约 41%·推荐）`、`强控本博弈（省约 62%）`，点击按当前原均值自动填入对应档位，再由管理员微调。
   - **彩色分段比例总览条**：实时渲染各档位宽度色块；总和为 `100.00%` 显示绿色通过，否则高亮提示差值并提供 **「自动补齐到保底档」** 一键按钮。
   - 每行档位包含：`档位名称`、`最小额度`、`最大额度`、`触发比例 (%)`、`每日最多中奖人数（可选，保底档置灰不限）`、删除按钮（至少保留 2 档）。
   - **实时成本期望测算卡（`Alert` / 信息卡）**：
     - 前端按 `Σ (weight_bps / 10000) × (min + max) / 2` 实时计算并展示：
       `理论单次人均期望：约 $10.26（相比原均额 $17.50 预计节省 41.4%；按日均 500 人签到估算，日均总发放约 $5,130）`。
   - 可选开关 **「启用每日高阶奖池预算上限」**：开启后展示 `每日高阶档位累计额度上限`，说明超限后平滑回退至第 1 档保底发放。
4. **分区 C：分时段签到比例（可选 `Switch` 开关）**：
   - 关闭时完全折叠。开启后支持添加时段行（`HH:mm` 至 `HH:mm`，提供早鸟/午间/晚间/深夜一键快捷芯片）：
     - 设置该时段 **额度比例系数（%）**（默认 `100%`，可设为 `<100%` 如 `85%` 做低谷控本，或 `>100%` 做高峰激励）。
     - 可勾选 **「单独设置该时段各档位中奖比例」**：展开该时段档位百分比编辑（同样带 `100%` 实时校验条与一键补齐）。
   - 时段重叠时表单行实时标红拦截。
5. **分区 D：用户端公开签到榜设置（可选 `Switch` 开关）**：
   - 开关：`启用用户端签到榜`。
   - 配置项：`榜单显示人数 (5 ~ 50)`、`用户名脱敏保护（推荐开启）`、`显示我的今日排名与超越比例`、`显示近期欧皇高光播报`。

### 6.4 用户端「签到榜」页面与入口设计（新增）

#### 入口设计（自然融入，不打扰未开启该功能的站点）
1. **个人中心签到卡片联动**（`web/src/features/profile/components/checkin-calendar-card.tsx`）：
   - 当 `reward_hint.leaderboard_enabled == true` 时，卡片右上角展示轻量入口按钮 `签到榜`（带奖杯图标）。
   - 用户签到成功后，若抽中高阶档位展示专属祝贺徽章与“看看我的今日排名”快捷跳转。
2. **独立用户路由**（`web/src/routes/_authenticated/checkin-leaderboard.tsx`）：
   - 所有已登录用户可访问；若后台未开启签到或未开启榜单，页面友好渲染 `EmptyState`（提示“签到榜未开启”）。
   - 可选作为个人中心下/侧边栏快捷入口，受后端开关控制自动显隐。

#### 页面视觉布局（精致、直观、适配移动端与深浅色主题）

```text
+-----------------------------------------------------------------------------+
| 签到幸运榜 · 2026-11-20                     [今日共 512 人签到] [返回签到]  |
+-----------------------------------------------------------------------------+
|   [ 银牌 #2 ]                [ 金牌 #1 皇冠 ]               [ 铜牌 #3 ]     |
|    mi***99                     al***en                       zh***02        |
|    [锦鲤大奖]                  [锦鲤大奖]                    [幸运暴击]     |
|    $54.20                      $59.00                        $33.80         |
+-----------------------------------------------------------------------------+
| ★ 我的今日战绩：获得 $8.50（日常保底） · 今日第 184 名 · 超越 64.1% 的用户   |
+-----------------------------------------------------------------------------+
| [今日手气榜 (Top 20)]   [近期欧皇高光]   [近 7 天累计榜]                     |
+-----------------------------------------------------------------------------+
| 排名 | 用户       | 命中档位     | 所属时段 | 签到时间 | 获得额度           |
|  #4  | wa***li    | [幸运暴击]   | 早鸟时段 | 07:41:12 | $31.50             |
|  #5  | lu***77    | [幸运暴击]   | 常规时段 | 10:15:03 | $28.90             |
|  ...                                                                        |
+-----------------------------------------------------------------------------+
```

- **冷启动防冷清**：刚过 0 点若 `今日手气榜` 尚不足 3 人，领奖台自动降级为紧凑列表并展示柔和提示“今日虚位以待，快来抢占榜首”，同时用户切到 `近期欧皇高光` 仍能看到最近保留期内真实的高额中奖记录。
- **本人高亮**：当前用户在列表中出现时，行背景带淡主色高亮并附加 `我` 标签（`Badge`）。

### 6.5 前端文件拆分与组件复用清单

建议在 `web/src/features/checkin/` 下按职责组织文件：

| 文件路径 | 职责说明 | 主要复用组件 |
| --- | --- | --- |
| `web/src/features/checkin/types.ts` | 补充 `CheckinPoolSetting`、`CheckinAnalytics`、`CheckinDrawRecord`、`CheckinLeaderboardResponse` 等类型定义 | — |
| `web/src/features/checkin/api.ts` | 新增 `getCheckinAnalytics`、`listCheckinDraws`、`getCheckinLeaderboard` 请求封装 | `@/lib/api` |
| `web/src/features/checkin/utils/pool-math.ts` | 纯函数：百分比与 `bps` 互转、时段重叠检测、数学期望与节省比例计算、推荐预设生成器 | — |
| `web/src/features/checkin/components/analytics-panel.tsx` | 管理端签到数据看板主容器（周期/单日状态管理、4 张 KPI 卡、图表与明细联动） | `StatCard`, `Card`, `DatePicker`, `Select`, `Badge`, `Progress`, `LoadingState`, `ErrorState` |
| `web/src/features/checkin/components/analytics-charts.tsx` | 每日档位堆叠柱状图（人数/比例/额度切换）、档位环形对比图、24 小时热度柱状图 | `@visactor/react-vchart`, `VCHART_OPTION`, `ToggleGroup`, `EmptyState` |
| `web/src/features/checkin/components/draw-logs-table.tsx` | 管理端抽奖明细与高额榜分页表格，支持点击用户打开 `CheckinUserDetailDialog` | `DataTablePage`, `useDataTable`, `Input`, `Select`, `Badge` |
| `web/src/features/checkin/components/pool-settings-fields.tsx` | 奖池档位编辑器、一键预设按钮、分段比例条、成本期望测算卡、分时段与签到榜配置区 | `FormField`, `Input`, `Switch`, `Button`, `Alert`, `Progress` |
| `web/src/features/checkin/components/settings-section.tsx` | 接入 `PoolSettingsFields` 与 Zod 表单校验，保持乐观锁 `version` 逻辑 | 现有 `SettingsForm`, `SettingsSection` |
| `web/src/features/checkin/components/leaderboard-page.tsx` | 用户端公开签到榜页面（Top 3 领奖台、我的战绩横条、三 Tab 榜单） | `Card`, `Tabs`, `Badge`, `Avatar`, `Button`, `EmptyState`, `LoadingState`, `ErrorState` |
| `web/src/routes/_authenticated/checkin-leaderboard.tsx` | 用户端签到榜路由入口 | TanStack Router |
| `web/src/features/profile/components/checkin-calendar-card.tsx` | 增加高阶档位命中祝贺徽章、当前时段提示及“查看签到榜”入口按钮 | 现有 `Card`, `Badge`, `Dialog`, `Button` |

**国际化（i18n）要求**：
- 前端新增文案必须全部使用 `useTranslation()` 的 `t('English key')`，并同步补齐 `web/src/i18n/locales/{en,zh,zh-TW,fr,ja,ru,vi}.json` 七个语种文件（执行 `cd web && bun run i18n:sync` 校验无遗漏）。
- 后端新增错误提示或状态文案同步维护 `i18n/keys.go` 与 `i18n/locales/{en,zh-CN,zh-TW}.yaml`。

---

## 七、分阶段研发落地指南

建议其他开发者按以下 5 个独立可验证的步骤推进实现：

### 第 1 阶段：配置模型与存储同步（Backend Settings）
1. 在 `setting/operation_setting/checkin_setting.go` 定义 `CheckinPoolSetting`、`CheckinLeaderboardConfig` 及子结构体，实现 `Normalize()`（含 `tiered` 模式自动同步 `MinQuota`）与 `Validate()`。
2. 更新 `model/checkin_settings.go`、`controller/option.go`、`model/option.go`，确保 `/api/option/checkin` 与通用配置导出均完整读写 `checkin_setting.pool`，且旧版无 `pool` 字段的 JSON 配置无需人工迁移即可正常读取。

### 第 2 阶段：数据表、抽奖引擎与定时清理（Backend Core）
1. 新增 `model/checkin_pool.go`（或拆分 `model/checkin_analytics.go`）：
   - 定义 `CheckinDailyBucket`、`CheckinDrawLog`、`CheckinDailyPool` 并在 `model/main.go` 注册 `AutoMigrate`。
   - 实现纯函数 `resolveCheckinSlot`、`rollCheckinTier` 与 `maskLeaderboardName`（注入随机数源接口便于确定性单元测试）。
   - 在 `model/checkin.go` 的 `UserCheckin` 事务中接入奖池抽取（严格遵循不以旧 `MinQuota` 抬升的原则）、每日奖池限额回退、`CheckinDrawLog` 写入与 `CheckinDailyBucket` 固定顺序原子累加；同时更新 `HasCheckedInToday`、`GetUserCheckinStats`、`evaluateCheckin` 中的日期获取逻辑使其统一遵循配置的签到时区 `CheckinLocation(settings)`。
2. 实现 `CleanupExpiredCheckinStats(now time.Time)` 与后台定时任务 `StartCheckinStatsCleanup()`，在 `main.go` 启动。

### 第 3 阶段：管理端统计与用户端签到榜 API（Backend Controller & Router）
1. 在 `model/checkin_admin.go`（或 `model/checkin_analytics.go`）实现 `GetCheckinAnalytics`、`ListCheckinDrawLogs` 与带 `15 ~ 30s` 公共短缓存的 `GetCheckinLeaderboard`。
2. 在 `controller/checkin.go` 新增 `GetCheckinAnalytics`、`ListCheckinDraws`（挂载 `adminRoute`）与 `GetCheckinLeaderboard`（挂载 `selfRoute`），并在 `router/api-router.go` 注册路由。
3. 在 `DoCheckin` 与 `GetCheckinStatus` 响应中补充非破坏性的档位/时段/榜单入口字段。

### 第 4 阶段：前端设置页、管理端看板与用户端签到榜（Frontend）
1. 实现 `pool-math.ts` 与 `pool-settings-fields.tsx`，集成进 `CheckinSettingsSection`（含一键预设、实时节省测算与 Zod 跨字段校验）。
2. 实现管理端 `analytics-panel.tsx`、`analytics-charts.tsx`、`draw-logs-table.tsx`，挂载到 `web/src/features/checkin/index.tsx` 的看板 Tab。
3. 实现用户端 `leaderboard-page.tsx` 与路由 `/checkin-leaderboard`，并在 `CheckinCalendarCard` 接入跳转入口与高阶档位提示。
4. 补齐全部 7 种前端语言翻译并通过 `oxlint` / TypeScript 类型检查。

### 第 5 阶段：测试与三数据库兼容性验证（Mandatory Verification）

遵循仓库 `AGENTS.md` 测试与数据库强制规范：

1. **后端确定性单元测试（集中扩展 `model/checkin_policy_test.go`，不零散堆砌测试文件）**：
   - 使用 `stretchr/testify/require` 与 `assert` 编写表驱动测试：
     - 老配置无 `pool` 字段平滑升级兼容性测试。
     - `Validate()` 边界拦截测试：权重之和不为 `10000`、档位 `max_quota` 超出全局上限、时段重叠、`stats_retention_days` 为 `0` 或 `31`、保底档误配人数限制、`leaderboard.top_n` 越界。
     - 分时段匹配（含 `<100%` 低谷降本与 `>100%` 高峰加成）与万分比临界抽档测试，验证 **`tiered` 模式下不会被旧 `settings.MinQuota` 强行抬升**。
     - 每日奖池预算耗尽与单档位名额耗尽时的自动保底回退（`pool_fallback = true`）及并发安全性测试。
     - `Mode 1`（叠加活跃度折扣与 `MonthlyCap` 截断）和 `Mode 2`（限时 `CheckinGrant`）组合测试。
     - `stats_retention_days = 7` 时清理过期 `checkin_draw_logs` / `checkin_daily_buckets` 后，`checkins` 当月 `MonthlyAwarded` 账本不受影响的回归测试。
     - 签到榜脱敏与隐私边界测试：验证 `mask_username=true` 时 Unicode/中文/短用户名脱敏正确，且接口响应绝不包含他人 `user_id`、余额或明文用户名，排名与超越百分比准确。
2. **三数据库实库验证（SQLite + MySQL >= 5.7.8 + PostgreSQL >= 9.6）**：
   - 由于新增了 GORM 模型、唯一索引、行锁与批量清理 SQL，完成代码实现后必须在真实 **SQLite、MySQL、PostgreSQL** 实例上分别执行：
     - 全新空库启动 `AutoMigrate` + 旧版本代表性库升级迁移。
     - 连续启动至少 2 次验证迁移幂等性（无重复 `ALTER TABLE`）。
     - 实测并发签到、每日奖池扣减回退、看板聚合查询、签到榜排序查询与过期分批清理在三种数据库方言下结果一致。
3. **前端测试与构建检查（低并发串行执行）**：
   - 在 `web/src/features/profile/__tests__/checkin.test.tsx` 或 `web/src/features/checkin/__tests__/` 补充阶梯配置表单校验、预设模板计算、30 天看板渲染以及用户端签到榜展示单测。
   - 串行运行后端 `GOMAXPROCS=2 go test -p 1 ./model/... ./controller/... ./setting/...` 与前端单 worker 测试及 `bun run build`，禁止前后端构建并发执行。

---

## 八、当前实现与验证记录（2026-11-21）

### 实际入口与组件复用

- 管理员设置入口：`/system-settings/billing/checkin`，通过现有 `SettingsForm`、表单字段、开关和输入组件配置阶梯奖池、百分比、预设、分时段规则、每日上限、保留期与榜单。
- 管理员统计入口：`/checkin` →「签到与余额」，在已有活跃度页面中接入 `RewardAnalytics`，展示人数、比例、发放额度、实际与配置比例、时段及 24 小时分布。复用现有 `Card`、`Progress`、`Tabs` 和 VChart。
- 用户榜单入口：交流社区签到卡 →「查看完整签到榜」，使用现有 `Dialog` 承载完整榜单、前三名、个人排名与三个榜单标签，支持手机布局与键盘关闭。
- 后端新增 `GET /api/user/checkin/analytics` 与 `GET /api/user/checkin/leaderboard`；统计、抽奖记录和每日奖池状态与核心签到账本分开存储。

### 验证中修复的问题

- 每日高阶预算改为按时段倍率、活跃度比例与月度截断后的实际发放额度扣减，预算不足在同一事务内回退保底，避免倍率加成造成超发。
- 阶梯模式抽到零额度仍记录当日签到，避免重复尝试直到抽到高额奖励；钱包入账失败时奖池扣减、统计和签到记录一起回滚。
- 旧配置缺失奖池字段时保留原服务器时区；新阶梯配置使用显式签到时区，日期、月份与分时规则保持一致。
- 从均匀随机切换到空阶梯配置时自动填入推荐预设，防止空档位访问错误；图表使用档位唯一标识区分系列，并固定颜色映射。
- 修复此前 `cached_batched_wallet_stays_separate` 的 Redis 测试夹具，使用项目缓存写入方法生成有效完整性签名；未调整认证校验或钱包业务规则。

### 实际执行的验证

以下检查均已观察到成功结果；前后端生产构建串行执行。

| 检查 | 实际命令 | 结果 |
| --- | --- | --- |
| 受影响后端包 | `GOMAXPROCS=2 /usr/local/go/bin/go test -p 1 ./model ./controller ./service ./setting/operation_setting -count=1` | 四个包全部通过 |
| 三数据库实库矩阵 | `GOMAXPROCS=2 GOWORK=off /usr/local/go/bin/go test -p 1 ./model -run '^TestCheckinPolicyDatabaseMatrix$' -count=1 -v`，设置 `TEST_MYSQL_DSN`、`TEST_POSTGRES_DSN` 指向隔离测试库 | SQLite、MySQL、PostgreSQL 全部通过，无跳过；矩阵总耗时 5.43 秒 |
| 前端回归 | `/root/.bun/bin/bun run test --maxWorkers=1 src/features/checkin/__tests__ src/features/profile/__tests__/checkin.test.tsx src/features/community/__tests__/activities.test.tsx` | 5 个文件、77 项测试通过 |
| 图表调整后回归 | `/root/.bun/bin/bun run test --maxWorkers=1 src/features/checkin/__tests__/activity.test.tsx` | 20 项测试通过 |
| 类型与 lint | `/root/.bun/bin/bun run typecheck`；`/root/.bun/bin/bun run lint` | 均通过；lint 无错误，仍有项目已有 warning |
| 国际化 | `/root/.bun/bin/bun run i18n:sync`；检查签到组件静态翻译键 | 同步成功；180 个静态键在七种语言均存在 |
| 前端生产构建 | `RAYON_NUM_THREADS=2 UV_THREADPOOL_SIZE=2 /root/.bun/bin/bun run build` | 通过 |
| 后端生产构建 | `GOMAXPROCS=2 /usr/local/go/bin/go build -p 1 -o /tmp/checkin-feature-review/new-api .` | 通过，嵌入最终前端构建 |
| 差异检查 | `git diff --check` | 通过 |

三数据库的实际版本为 **SQLite 3.50.4、MySQL 8.4.10、PostgreSQL 16.14**。每种数据库均验证了签到相关表的全新迁移，以及以 `v1.0.0-rc.51` 签到表结构和已有数据创建的代表性升级场景；每个场景迁移两次，检查已有数据和唯一约束。回归覆盖时段边界、倍率封顶、每日预算、并发名额、重复签到、入账失败回滚、榜单排序与脱敏，以及清理统计后核心账本仍保留。测试使用独立临时数据库，结束后已删除。

浏览器使用最终生产构建和隔离 SQLite 数据库，正常登录后验证了设置保存与刷新、非法概率阻止提交、三种统计图切换、三种榜单切换、390 像素手机布局与 Esc 关闭。记录中页面运行错误为零，手机页面无横向溢出。截图与 GIF 使用 **60 个演示用户、14 天本地测试数据**，不代表实际站点运营数据。
