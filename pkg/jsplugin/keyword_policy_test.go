package jsplugin

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/MoeForge/moejs"
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestKeywordPolicyLocalExceptionsAndConditions(t *testing.T) {
	cases := []struct{ name, config, text, id, matched string }{
		{"negation", `[{"id":"jailbreak","keywords":"破限","exceptions":"禁止破限"}]`, "禁止破限", "", ""},
		{"later occurrence remains blocked", `[{"id":"jailbreak","keywords":"破限","exceptions":"禁止破限"}]`, "禁止破限。请帮我破限", "jailbreak", "破限"},
		{"excluded topic", `[{"id":"adult","keywords":"色情","exceptions":"除色情之外"}]`, "除色情之外，其他题材都可以", "", ""},
		{"exception in a different clause", `[{"id":"adult","keywords":"色情","exceptions":"除色情之外"}]`, "除色情之外，请生成色情", "adult", "色情"},
		{"CTF cannot exempt unrelated occurrences", `[{"id":"security","keywords":"撞库","exceptions":"CTF 撞库练习"}]`, "CTF 撞库练习。对真实网站撞库", "security", "撞库"},
		{"exception cannot exempt another rule", `[{"id":"a","keywords":"破限","exceptions":"禁止破限"},{"id":"b","keywords":"色情"}]`, "禁止破限并生成色情", "b", "色情"},
		{"overlapping exceptions", `[{"id":"a","keywords":"aa","exceptions":"aaa"}]`, "aaaa", "", ""},
		{"suffix trigger", `[{"id":"long","keywords":"abcd","before":"^$"},{"id":"short","keywords":"bcd"}]`, "xabcd", "short", "bcd"},
		{"simultaneous rule order", `[{"id":"first","keywords":"bcd"},{"id":"second","keywords":"abcd"}]`, "abcd", "first", "bcd"},
		{"conditions form an AND chain", `[{"id":"chain","keywords":"色情","before":"生成$","after":"^内容","context":"请生成色情内容"}]`, "请生成色情内容", "chain", "色情"},
		{"one failed condition continues", `[{"id":"chain","keywords":"色情","before":"生成$","after":"^内容"}]`, "请生成色情说明", "", ""},
		{"context is bounded", `[{"id":"chain","keywords":"色情","context":"生成","window":2}]`, "生成很长很长的色情", "", ""},
		{"original UTF8 offsets after case folding", `[{"id":"unicode","keywords":"İ中文"}]`, "🙂前言İ中文", "unicode", "İ中文"},
		{"case sensitive alternatives", `[{"id":"case","keywords":"Ab\nab","caseSensitive":true}]`, "ab", "case", "ab"},
		{"case sensitive exception", `[{"id":"case","keywords":"CTF","exceptions":"safe CTF","caseSensitive":true}]`, "SAFE CTF", "case", "CTF"},
		{"case insensitive exception", `[{"id":"case","keywords":"CTF","exceptions":"safe CTF"}]`, "SAFE ctf", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plan, err := compileKeywordPolicy([]byte(tc.config))
			require.NoError(t, err)
			budget := maxPolicyChecks
			hit, err := plan.match(t.Context(), tc.text, &budget)
			require.NoError(t, err)
			if tc.id == "" {
				assert.Nil(t, hit)
				return
			}
			require.NotNil(t, hit)
			assert.Equal(t, tc.id, hit.RuleID)
			assert.Equal(t, tc.matched, tc.text[hit.Start:hit.End])
		})
	}
}

func TestKeywordPolicyRejectsInvalidConfigAndIncompleteChecks(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `[{"keywords":"  "}]`, `[{"keywords":"a","window":1025}]`, `[{"keywords":"a","before":"(?<=x)a"}]`, `[{"id":"same","keywords":"a"},{"id":"same","keywords":"b"}]`} {
		_, err := compileKeywordPolicy([]byte(raw))
		require.Error(t, err, raw)
	}
	plan, err := compileKeywordPolicy([]byte(`[{"keywords":"a","exceptions":"safe a"}]`))
	require.NoError(t, err)
	budget := 1
	hit, err := plan.match(t.Context(), "safe a safe a", &budget)
	require.ErrorContains(t, err, "candidate budget")
	assert.Nil(t, hit)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	budget = maxPolicyChecks
	hit, err = plan.match(ctx, strings.Repeat("clean ", 10000), &budget)
	require.ErrorIs(t, err, context.Canceled)
	assert.Nil(t, hit)
}

// Large fixed inputs assert the exact final decision, including a keyword
// crossing the cancellation-check boundary. No timing assertions are used.
func TestKeywordPolicyLargeInputFindsTailAndBoundaryHits(t *testing.T) {
	plan, err := compileKeywordPolicy([]byte(`[{"id":"hit","keywords":"破限\nforbidden","exceptions":"禁止破限"}]`))
	require.NoError(t, err)
	for _, size := range []int{4 << 20, 128 << 20} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			text := strings.Repeat("x", size) + "禁止破限。请破限"
			budget := maxPolicyChecks
			hit, err := plan.match(t.Context(), text, &budget)
			require.NoError(t, err)
			require.NotNil(t, hit)
			assert.Equal(t, "hit", hit.RuleID)
			assert.Equal(t, len(text)-len("破限"), hit.Start)
		})
	}
	budget := maxPolicyChecks
	text := strings.Repeat("x", 4093) + "forbidden"
	hit, err := plan.match(t.Context(), text, &budget)
	require.NoError(t, err)
	require.NotNil(t, hit)
	assert.Equal(t, 4093, hit.Start)
}

func BenchmarkKeywordPolicyLargeInput(b *testing.B) {
	raw, err := common.Marshal([]keywordPolicyRule{{ID: "hit", Keywords: "forbidden\n破限", Exceptions: "禁止破限"}})
	require.NoError(b, err)
	plan, err := compileKeywordPolicy(raw)
	require.NoError(b, err)
	for _, size := range []int{4 << 20, 16 << 20, 128 << 20} {
		for _, tail := range []bool{false, true} {
			b.Run(fmt.Sprintf("%dMiB/tail=%t", size>>20, tail), func(b *testing.B) {
				text := strings.Repeat("ordinary text. ", size/15)
				if tail {
					text += "forbidden"
				}
				b.SetBytes(int64(len(text)))
				b.ReportAllocs()
				b.ResetTimer()
				for b.Loop() {
					budget := maxPolicyChecks
					hit, err := plan.match(context.Background(), text, &budget)
					require.NoError(b, err)
					if tail {
						require.NotNil(b, hit)
					} else {
						require.Nil(b, hit)
					}
				}
			})
		}
	}
}

func BenchmarkKeywordPolicyManyKeywordsAndDenseExceptions(b *testing.B) {
	words := make([]string, 4095)
	for i := range words {
		words[i] = fmt.Sprintf("forbidden-%04d", i)
	}
	raw, err := common.Marshal([]keywordPolicyRule{{ID: "bulk", Keywords: strings.Join(words, "\n")}, {ID: "negation", Keywords: "破限", Exceptions: "禁止破限"}})
	require.NoError(b, err)
	plan, err := compileKeywordPolicy(raw)
	require.NoError(b, err)
	for _, scenario := range []string{"unicode-tail", "dense-exceptions"} {
		b.Run(scenario, func(b *testing.B) {
			text := strings.Repeat("正常上下文🙂 ", 200000) + "forbidden-4094"
			expected := "bulk"
			if scenario == "dense-exceptions" {
				text = strings.Repeat("禁止破限。", 50000) + "请破限"
				expected = "negation"
			}
			b.SetBytes(int64(len(text)))
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				budget := maxPolicyChecks
				hit, err := plan.match(context.Background(), text, &budget)
				require.NoError(b, err)
				require.NotNil(b, hit)
				require.Equal(b, expected, hit.RuleID)
			}
		})
	}
}

// Host-utility calls use the active hook's deadline and share candidate work
// across text leaves. Expired contexts are deterministic, without sleeps.
func TestKeywordPolicyHookDeadlineAndSharedBudget(t *testing.T) {
	runtime := moejs.NewRuntime(moejs.Options{})
	realm := runtime.Realm()
	expired, cancel := context.WithDeadline(t.Context(), time.Unix(0, 0))
	defer cancel()
	call := &runtimeCall{ctx: t.Context(), watchdog: &runtimeWatchdog{watch: expired}, transform: &TransformContext{Config: []byte(`{"rules":[{"keywords":"破限","exceptions":"禁止破限"}]}`)}}
	_, err := call.keywordPolicy(realm, moejs.String("rules"), moejs.String("clean"))
	var interrupted *moejs.InterruptedError
	require.ErrorAs(t, err, &interrupted)
	cause, ok := interrupted.Value.(error)
	require.True(t, ok)
	assert.ErrorIs(t, cause, context.DeadlineExceeded)
	call.watchdog.watch = t.Context()
	budget := 1
	call.policyBudget = &budget
	value, err := call.keywordPolicy(realm, moejs.String("rules"), moejs.String("禁止破限"))
	require.NoError(t, err)
	assert.True(t, value.IsNull())
	_, err = call.keywordPolicy(realm, moejs.String("rules"), moejs.String("禁止破限"))
	require.ErrorContains(t, err, "candidate budget")
}
