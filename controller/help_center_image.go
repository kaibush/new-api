package controller

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/QuantumNous/new-api/pkg/helpcenter"
	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/webp"
)

const maxHelpImageBytes = 5 << 20

func UploadHelpCenterImage(c *gin.Context) {
	store, err := helpcenter.ImageStoreFromEnv()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxHelpImageBytes+(64<<10))
	if err := c.Request.ParseMultipartForm(maxHelpImageBytes); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid image upload or file exceeds 5 MiB"})
		return
	}
	defer c.Request.MultipartForm.RemoveAll()
	files := c.Request.MultipartForm.File["file"]
	if len(files) != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Select one image"})
		return
	}
	extension := strings.ToLower(filepath.Ext(files[0].Filename))
	expectedFormat := map[string]string{".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp"}[extension]
	if expectedFormat == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Use a PNG, JPEG or WebP file extension"})
		return
	}
	file, err := files[0].Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Could not read image"})
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxHelpImageBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxHelpImageBytes {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Image must be between 1 byte and 5 MiB"})
		return
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || format != expectedFormat || config.Width <= 0 || config.Height <= 0 || config.Width > 8192 || config.Height > 8192 || int64(config.Width)*int64(config.Height) > 16_000_000 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Use a valid PNG, JPEG or WebP image up to 16 megapixels and 8192 pixels per side"})
		return
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Image is damaged or incomplete"})
		return
	}
	// Re-encode pixels to strip metadata and appended non-image content.
	var clean bytes.Buffer
	if format == "jpeg" {
		err = jpeg.Encode(&clean, decoded, &jpeg.Options{Quality: 90})
	} else {
		format = "png"
		err = png.Encode(&clean, decoded)
	}
	if err != nil || clean.Len() > maxHelpImageBytes {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Processed image exceeds 5 MiB; resize it before uploading"})
		return
	}
	imageURL, err := store.PutImage(c.Request.Context(), clean.Bytes(), format)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"url": imageURL}})
}
