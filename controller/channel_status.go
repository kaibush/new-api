package controller

import (
	"context"
	"fmt"
	"io"
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
type channelInventory struct {
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
	common.OptionMapRWMutex.RLock()
	base := common.OptionMap["GrokIQBaseURL"]
	token := common.OptionMap["GrokIQAdminToken"]
	common.OptionMapRWMutex.RUnlock()
	c.Header("Cache-Control", "no-store")
	if base == "" || token == "" {
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"configured": false}})
		return
	}
	if err := validateGrokIQURL(base); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	client := *service.GetSSRFProtectedHTTPClient()
	// Never forward the administrator credential to a redirect destination.
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	var inventory channelInventory
	var audits struct {
		ClientKeys []channelAuditClient `json:"clientKeys"`
		Callers    []channelAuditClient `json:"callers"`
	}
	var inventoryErr, auditErr error
	var wg sync.WaitGroup
	wg.Go(func() { inventoryErr = fetchGrokIQ(ctx, &client, base, token, "public/upstream-accounts", &inventory) })
	wg.Go(func() {
		auditErr = fetchGrokIQ(ctx, &client, base, token, "request-audits?window="+window+"&pageSize=1", &audits)
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
		result["inventory"] = inventory
	}
	if auditErr != nil {
		result["auditError"] = auditErr.Error()
	} else {
		// Keys partition all requests; caller identities may still be pending enrichment.
		total := channelAuditClient{Name: "GrokIQ"}
		var samples, successes int64
		hasSamples, hasSuccesses := true, true
		for _, item := range audits.ClientKeys {
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
		// Match both authenticated values, never a caller ID supplied in the query.
		clients := make([]channelAuditClient, 0)
		for _, item := range audits.Callers {
			if c.GetInt("role") < common.RoleAdminUser {
				raw, ok := strings.CutPrefix(item.ID, "user:")
				var identity []string
				if !ok || common.UnmarshalJsonStr(raw, &identity) != nil || len(identity) != 2 || identity[0] != strconv.Itoa(c.GetInt("id")) || identity[1] != c.GetString("username") {
					continue
				}
			}
			clients = append(clients, item)
		}
		result["clients"] = clients
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}
