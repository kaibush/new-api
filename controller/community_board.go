package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetCommunityBoard(c *gin.Context) {
	d, err := model.GetCommunityBoard()
	if err != nil {
		communityError(c, 500, "Could not load community board")
		return
	}
	// Disabled content is never delivered to public clients.
	if c.FullPath() == "/api/community/board" {
		blocks := make([]model.CommunityBoardBlock, 0, len(d.Blocks))
		for _, b := range d.Blocks {
			if b.Enabled {
				blocks = append(blocks, b)
			}
		}
		d.Blocks = blocks
	}
	c.JSON(200, gin.H{"success": true, "data": d})
}
func UpdateCommunityBoard(c *gin.Context) {
	var d model.CommunityBoardDocument
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
	if common.DecodeJson(c.Request.Body, &d) != nil {
		communityError(c, 400, model.ErrCommunityBoardInvalid.Error())
		return
	}
	saved, err := model.SaveCommunityBoard(d)
	if err != nil {
		code := 500
		if errors.Is(err, model.ErrCommunityBoardInvalid) {
			code = 400
		}
		if errors.Is(err, model.ErrCommunityBoardConflict) {
			code = 409
		}
		message := err.Error()
		if code == 500 {
			message = "Could not save community board"
		}
		communityError(c, code, message)
		return
	}
	recordManageAudit(c, "community.board_update", map[string]any{"version": saved.Version})
	c.JSON(200, gin.H{"success": true, "data": saved})
}
