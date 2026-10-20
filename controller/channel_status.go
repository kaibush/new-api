package controller

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// Only this projection is exposed. Audit rows can contain credentials and prompts.
type channelAuditClient struct {
	ID                     string  `json:"id,omitempty"`
	Name                   string  `json:"name"`
	LastSeenAt             *string `json:"lastSeenAt,omitempty"`
	RequestCount           int64   `json:"requestCount"`
	ThinkingRequests       int64   `json:"thinkingRequests"`
	ThinkingSampleRequests *int64  `json:"thinkingSampleRequests"`
	HTTPSuccessRequests    *int64  `json:"httpSuccessRequests"`
}
type channelProviderCounts struct {
	Total     int64 `json:"total"`
	Available int64 `json:"available"`
}
type channelRecovery struct {
	Cooldown     int64 `json:"cooldown"`
	WaitingReset int64 `json:"waitingReset"`
	Probing      int64 `json:"probing"`
}
type channelIssues struct {
	Disabled       int64 `json:"disabled"`
	ReauthRequired int64 `json:"reauthRequired"`
}
type channelInventory struct {
	Risk       int64                            `json:"risk"`
	Recovery   *channelRecovery                 `json:"recovery"`
	Issues     *channelIssues                   `json:"issues"`
	Reachable  bool                             `json:"reachable"`
	UpdatedAt  *string                          `json:"updatedAt"`
	Total      int64                            `json:"total"`
	Available  int64                            `json:"available"`
	Recovering int64                            `json:"recovering"`
	Attention  int64                            `json:"attention"`
	Providers  map[string]channelProviderCounts `json:"providers"`
}

func validateGrokIQURL(value string) error {
	if value == "" {
		return nil
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("GrokIQ requires an HTTPS base URL without credentials, query or fragment")
	}
	return nil
}

func fetchGrokIQ(ctx context.Context, client *http.Client, base, token, path string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/api/"+path, nil)
	if err != nil {
		return fmt.Errorf("invalid GrokIQ address")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("GrokIQ connection failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GrokIQ returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20+1))
	if err != nil || len(data) > 4<<20 {
		return fmt.Errorf("invalid GrokIQ response size")
	}
	if common.Unmarshal(data, target) != nil {
		return fmt.Errorf("invalid GrokIQ response")
	}
	return nil
}

func GetChannelStatus(c *gin.Context) {
	window := c.DefaultQuery("window", "24h")
	if !slices.Contains([]string{"1h", "3h", "6h", "24h", "7d"}, window) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid time window"})
		return
	}
	dataset := c.DefaultQuery("dataset", "overview")
	period := c.DefaultQuery("period", "24h")
	if !slices.Contains([]string{"overview", "health", "usage"}, dataset) || !slices.Contains([]string{"24h", "7d", "30d", "90d", "custom"}, period) || (dataset != "usage" && period == "custom") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid status query"})
		return
	}
	params := url.Values{"period": {period}, "timezone": {"Asia/Shanghai"}}
	if period == "custom" {
		start, startErr := time.Parse(time.RFC3339, c.Query("start"))
		end, endErr := time.Parse(time.RFC3339, c.Query("end"))
		if startErr != nil || endErr != nil || !end.After(start) || end.Sub(start) > 90*24*time.Hour {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid custom range (maximum 90 days)"})
			return
		}
		params.Set("start", start.UTC().Format(time.RFC3339))
		params.Set("end", end.UTC().Format(time.RFC3339))
	}
	common.OptionMapRWMutex.RLock()
	base := common.OptionMap["GrokIQBaseURL"]
	token := common.OptionMap["GrokIQAdminToken"]
	common.OptionMapRWMutex.RUnlock()
	c.Header("Cache-Control", "no-store")
	if base == "" || token == "" {
		if dataset != "overview" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "GrokIQ is not configured"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"configured": false}})
		return
	}
	if err := validateGrokIQURL(base); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	timeout := 15 * time.Second
	if dataset == "usage" {
		timeout = 75 * time.Second
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
	defer cancel()
	client := *service.GetSSRFProtectedHTTPClient()
	// Never forward the integration credential to a redirect destination.
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	if dataset != "overview" {
		prefix := "public/"
		if strings.HasPrefix(token, "giq_") {
			prefix = "integration/v1/"
		}
		var target any
		var path string
		switch dataset {
		case "health":
			target = &channelHealth{}
			path = "upstream-health"
		case "usage":
			target = &channelUsage{}
			path = "upstream-usage"

		}
		err := fetchGrokIQ(ctx, &client, base, token, prefix+path+"?"+params.Encode(), target)
		if err == nil {
			switch data := target.(type) {
			case *channelHealth:
				if data.Windows == nil || data.Series == nil || data.Models == nil || data.Errors == nil {
					err = fmt.Errorf("GrokIQ health statistics are missing")
				}
			case *channelUsage:
				if data.Series == nil || data.Activity == nil || data.TopModels == nil || data.Providers == nil {
					err = fmt.Errorf("GrokIQ usage statistics are missing")
				}

			}
		}
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": target})
		return
	}
	var inventory channelInventory
	var audits struct {
		ClientKeys []channelAuditClient `json:"clientKeys"`
		Callers    []channelAuditClient `json:"callers"`
	}
	var inventoryErr, auditErr error
	// Preserve existing JWT integrations while scoped keys use projections that
	// never expose raw audit records. Keep the stored option name for upgrades.
	inventoryPath := "public/upstream-accounts"
	auditPath := "request-audits?window=" + window + "&pageSize=1"
	if strings.HasPrefix(token, "giq_") {
		inventoryPath = "integration/v1/upstream-accounts"
		auditPath = "integration/v1/request-statistics?window=" + window
	}
	var wg sync.WaitGroup
	wg.Go(func() { inventoryErr = fetchGrokIQ(ctx, &client, base, token, inventoryPath, &inventory) })
	wg.Go(func() {
		auditErr = fetchGrokIQ(ctx, &client, base, token, auditPath, &audits)
	})
	wg.Wait()
	if auditErr == nil && audits.ClientKeys == nil {
		auditErr = fmt.Errorf("GrokIQ audit response is missing client statistics")
	}
	if inventoryErr == nil && inventory.Providers == nil {
		inventoryErr = fmt.Errorf("GrokIQ inventory response is missing provider statistics")
	}
	result := gin.H{"configured": true, "window": window, "checkedAt": time.Now().UTC().Format(time.RFC3339)}
	if inventoryErr != nil {
		result["inventoryError"] = inventoryErr.Error()
	} else {
		providers := make(map[string]gin.H, len(inventory.Providers))
		for name, counts := range inventory.Providers {
			capacity := 0.0
			if counts.Total > 0 {
				capacity = math.Round(float64(counts.Available) * 100 / float64(counts.Total))
			}
			providers[name] = gin.H{"capacity": max(0, min(100, capacity))}
		}
		public := gin.H{"reachable": inventory.Reachable, "updatedAt": inventory.UpdatedAt, "providers": providers}
		if c.GetInt("role") >= common.RoleAdminUser {
			public["accounts"] = gin.H{"total": inventory.Total, "available": inventory.Available, "recovering": inventory.Recovering, "attention": inventory.Attention, "risk": inventory.Risk, "recovery": inventory.Recovery, "issues": inventory.Issues}
		}
		result["inventory"] = public
	}
	if auditErr != nil {
		result["auditError"] = auditErr.Error()
	} else {
		isAdmin := c.GetInt("role") >= common.RoleAdminUser
		// Match both authenticated values, never a caller ID supplied in the query.
		clients := make([]channelAuditClient, 0)
		for _, item := range audits.Callers {
			if !isAdmin {
				raw, ok := strings.CutPrefix(item.ID, "user:")
				var identity []string
				if !ok || common.UnmarshalJsonStr(raw, &identity) != nil || len(identity) != 2 || identity[0] != strconv.Itoa(c.GetInt("id")) || identity[1] != c.GetString("username") {
					continue
				}
			}
			clients = append(clients, item)
		}
		result["clients"] = clients

		// Personal quality uses only identified requests owned by the current user.
		// Administrators use keys, which partition all requests even before caller enrichment.
		summaryClients := clients
		if isAdmin {
			summaryClients = audits.ClientKeys
		}
		total := channelAuditClient{Name: "GrokIQ"}
		var samples, successes int64
		hasSamples, hasSuccesses := true, true
		for _, item := range summaryClients {
			total.RequestCount += item.RequestCount
			total.ThinkingRequests += item.ThinkingRequests
			if item.ThinkingSampleRequests == nil {
				hasSamples = false
			} else {
				samples += *item.ThinkingSampleRequests
			}
			if item.HTTPSuccessRequests == nil {
				hasSuccesses = false
			} else {
				successes += *item.HTTPSuccessRequests
			}
		}
		if hasSamples {
			total.ThinkingSampleRequests = &samples
		}
		if hasSuccesses {
			total.HTTPSuccessRequests = &successes
		}
		result["summary"] = total
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}
