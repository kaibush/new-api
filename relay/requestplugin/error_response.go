package requestplugin

import (
	"context"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/pkg/errorfilter"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// FilterErrors pins the same plugin plan ingress will use. The existing wire
// writer is installed only when a legacy policy or an error hook is enabled.
func FilterErrors(c *gin.Context, format types.RelayFormat) func() {
	plan := NewPlan(common.GetContextKeyInt(c, constant.ContextKeyUserId))
	c.Set(planContextKey, plan)
	if plan == nil || !plan.errors {
		return service.FilterRelayErrors(c)
	}
	// Bound cumulative hook time for this response, including repeated SSE errors.
	remaining := 100 * time.Millisecond
	return service.FilterRelayErrors(c, func(in errorfilter.Input) errorfilter.Result {
		settings, _ := common.GetContextKeyType[dto.ChannelSettings](c, constant.ContextKeyChannelSetting)
		user, token := requester(c)
		call := Call{Format: string(format), Path: c.Request.URL.Path, Model: in.Model,
			Group: requestGroup(c), Bound: settings.RequestPlugins, User: user, Token: token}
		if in.ChannelID > 0 {
			call.Channel = &jsplugin.TransformChannel{ID: in.ChannelID, Type: common.GetContextKeyInt(c, constant.ContextKeyChannelType)}
		}
		started := time.Now()
		ctx, cancel := context.WithTimeout(c.Request.Context(), remaining)
		defer cancel()
		result, steps := plan.errorResponse(ctx, call, in)
		remaining = max(0, remaining-time.Since(started))
		for _, step := range steps {
			if step.Error != "" {
				logger.LogWarn(c, common.LogText("request plugin instance %s (%s) errorResponse failed: %s", step.Instance, step.Plugin, step.Error))
			}
		}
		return result
	})
}

// errorResponse stops at the first replacement. Failure of a required instance
// returns a generic error; optional failures leave later policies eligible.
func (p *Plan) errorResponse(ctx context.Context, call Call, in errorfilter.Input) (errorfilter.Result, []Step) {
	result := errorfilter.Result{Input: in, Action: "preserve"}
	var steps []Step
	for _, instance := range p.scope(jsplugin.ErrorResponseHook, call.Group, call.Model, call.channelType(), call.Bound) {
		plugin := p.plugins[instance.Plugin]
		started := time.Now()
		response, err := plugin.CallErrorResponse(ctx, jsplugin.TransformContext{
			Format: call.Format, Path: call.Path, Model: call.Model, Group: call.Group,
			Channel: call.Channel, User: call.User, Token: call.Token,
			Instance: jsplugin.TransformInstance{ID: instance.ID, Name: instance.Name}, Config: instance.Config,
		}, jsplugin.ErrorResponse{Status: in.Status, Message: in.Message, Type: in.Type, Code: in.Code})
		step := Step{RequestPluginStep: relaycommon.RequestPluginStep{
			Instance: instance.ID, Name: instance.Name, Plugin: plugin.Meta.Key, Version: plugin.Meta.Version,
			Stage: jsplugin.ErrorResponseHook, Action: response.Action, DurationMS: time.Since(started).Milliseconds(),
		}}
		if err != nil {
			step.Action, step.Error = "fail", jsplugin.TransformErrorFailed
			var failure *jsplugin.TransformError
			if errors.As(err, &failure) {
				step.Error = failure.Class
			}
			step.Detail = err.Error()
			steps = append(steps, step)
			if plugin.Meta.Optional {
				continue
			}
			result.Action, result.Message, result.StripDetails = "replace", errorfilter.DefaultMessage, true
			return result, steps
		}
		steps = append(steps, step)
		if response.Action == "replace" || response.Action == "redact" {
			result.Action, result.Message, result.StripDetails = response.Action, response.Message, true
			return result, steps
		}
	}
	return result, steps
}
