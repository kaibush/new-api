package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// RequestPluginFetcher returns the utils.fetch of a request processing
// instance's ingress, egress and report hooks: the plugin's allowedHosts and
// the hosts of the instance's url config values only. The destination is the
// instance's own service, not a channel's upstream, so requests use no
// channel proxy and always verify TLS; a redirect reaches the plugin as it is.
func RequestPluginFetcher(plugin *jsplugin.LoadedPlugin, config json.RawMessage) jsplugin.Fetcher {
	return func(ctx context.Context, request jsplugin.FetchRequest) (jsplugin.FetchResponse, error) {
		hosts := append(slices.Clone(plugin.Meta.AllowedHosts), plugin.ConfigURLHosts(config)...)
		if err := jsplugin.ValidateServiceURL(request.URL, hosts); err != nil {
			return jsplugin.FetchResponse{}, err
		}
		client, err := GetHttpClientWithProxySettings("", dto.ChannelSettings{})
		if err != nil {
			return jsplugin.FetchResponse{}, err
		}
		return sendPluginFetch(ctx, plugin, client, request)
	}
}

// sendPluginFetch sends one checked utils.fetch request with client. A
// redirect reaches the plugin as it is; fetching its location is a new
// request, checked and counted again.
func sendPluginFetch(ctx context.Context, plugin *jsplugin.LoadedPlugin, client *http.Client, request jsplugin.FetchRequest) (jsplugin.FetchResponse, error) {
	noRedirects := *client
	noRedirects.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	var body io.Reader
	if request.Method == http.MethodPost {
		body = strings.NewReader(request.Body)
		if request.BodyStream != nil {
			// The body names media of the request, streamed as data URLs.
			body = request.BodyStream
		}
	}
	req, err := http.NewRequestWithContext(ctx, request.Method, request.URL, body)
	if err != nil {
		return jsplugin.FetchResponse{}, err
	}
	if request.Method == http.MethodPost && request.BodyStream != nil {
		req.ContentLength = request.BodySize
	}
	for name, value := range request.Headers {
		req.Header.Set(name, value)
	}
	started := time.Now()
	resp, err := noRedirects.Do(req)
	if err != nil {
		logger.LogDebug(ctx, "task_plugin subsystem=fetch event=failed plugin=%q hook=%q method=%q host=%q reason=transport_error elapsed_ms=%d",
			plugin.Meta.Key, request.Hook, request.Method, req.URL.Host, time.Since(started).Milliseconds())
		return jsplugin.FetchResponse{}, err
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, jsplugin.MaxFetchBodyBytes+1))
	if err != nil {
		return jsplugin.FetchResponse{}, err
	}
	headers := make(map[string]string, len(resp.Header))
	for name, values := range resp.Header {
		if len(values) > 0 {
			headers[name] = values[0]
		}
	}
	logger.LogDebug(ctx, "task_plugin subsystem=fetch event=done plugin=%q hook=%q method=%q host=%q status=%d bytes=%d elapsed_ms=%d",
		plugin.Meta.Key, request.Hook, request.Method, req.URL.Host, resp.StatusCode, len(responseBody), time.Since(started).Milliseconds())
	return jsplugin.FetchResponse{Status: resp.StatusCode, Headers: headers, Body: responseBody}, nil
}
