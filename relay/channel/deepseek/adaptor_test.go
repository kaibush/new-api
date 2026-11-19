package deepseek

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDeveloperRoleCompatibility(t *testing.T) {
	adaptor := &Adaptor{}
	request := &dto.GeneralOpenAIRequest{Model: "deepseek-chat", Messages: []dto.Message{
		{Role: "developer", Content: "Follow these instructions"},
		{Role: "system", Content: "Existing system message"},
		{Role: "user", Content: "Hello"},
	}}
	converted, err := adaptor.ConvertOpenAIRequest(nil, nil, request)
	require.NoError(t, err)
	assert.Equal(t, &dto.GeneralOpenAIRequest{Model: "deepseek-chat", Messages: []dto.Message{
		{Role: "system", Content: "Follow these instructions"},
		{Role: "system", Content: "Existing system message"},
		{Role: "user", Content: "Hello"},
	}}, converted)

	responses := dto.OpenAIResponsesRequest{Model: "deepseek-chat", Input: []byte(`[{"role":"developer","content":"Follow these instructions"}]`)}
	converted, err = adaptor.ConvertOpenAIResponsesRequest(nil, nil, responses)
	require.NoError(t, err)
	assert.Equal(t, responses, converted)
}
