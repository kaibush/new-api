package controller

import (
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/errorfilter"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
)

func GetErrorFilter(c *gin.Context) {
	cfg, _, err := setting.ParseErrorFilter(setting.ErrorFilterConfig())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": cfg})
}

func UpdateErrorFilter(c *gin.Context) {
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, errorfilter.MaxConfigBytes))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Configuration exceeds 256 KiB"})
		return
	}
	cfg, _, err := setting.ParseErrorFilter(string(body))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	canonical, err := common.Marshal(cfg)
	if err == nil {
		err = model.UpdateOptionsBulk(map[string]string{setting.ErrorFilterOptionKey: string(canonical)})
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": cfg})
}

func PreviewErrorFilter(c *gin.Context) {
	var request struct {
		Config common.RawMessage `json:"config"`
		Sample errorfilter.Input `json:"sample"`
		Body   string            `json:"body"`
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 2*errorfilter.MaxErrorBytes))
	if err == nil {
		err = common.Unmarshal(body, &request)
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid or oversized preview request"})
		return
	}
	_, policy, err := setting.ParseErrorFilter(string(request.Config))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	if request.Sample.Status < 100 || request.Sample.Status > 599 || request.Sample.ChannelID < 0 || len(request.Body) > errorfilter.MaxErrorBytes || len(request.Sample.Message) > errorfilter.MaxErrorBytes {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid preview status, channel, or message size"})
		return
	}
	data := []byte(request.Body)
	if request.Body == "" {
		data, _ = common.Marshal(gin.H{"error": gin.H{"message": request.Sample.Message, "type": request.Sample.Type, "code": request.Sample.Code}})
	} else {
		// A pasted response supplies its own message, type and code.
		request.Sample.Message = ""
	}
	output, result := service.RewritePublicError(policy, request.Sample, data, true)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"result": result, "body": string(output)}})
}
