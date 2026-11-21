package controller

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetFrontendRelease(c *gin.Context) {
	release, err := model.GetFrontendRelease()
	if err != nil {
		communityError(c, 500, "Could not load frontend release")
		return
	}
	c.JSON(200, gin.H{"success": true, "data": release})
}

func PublishFrontendRelease(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16384)
	var input struct {
		Version string `json:"version"`
		Notes   string `json:"notes"`
	}
	if c.ShouldBindJSON(&input) != nil || strings.TrimSpace(input.Version) == "" || utf8.RuneCountInString(strings.TrimSpace(input.Version)) > 80 || utf8.RuneCountInString(strings.TrimSpace(input.Notes)) > 2000 {
		communityError(c, 400, "Invalid frontend release")
		return
	}
	release, err := model.PublishFrontendRelease(input.Version, input.Notes)
	if err != nil {
		communityError(c, 500, "Could not publish frontend release")
		return
	}
	recordManageAudit(c, "frontend.release.publish", map[string]any{"revision": release.Revision, "version": release.Version})
	c.JSON(200, gin.H{"success": true, "data": release})
}
