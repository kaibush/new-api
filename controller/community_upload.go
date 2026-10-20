package controller

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/helpcenter"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm/clause"
)

// CommunityGIFBudget checks frame dimensions before gif.DecodeAll allocates image buffers.
func CommunityGIFBudget(data []byte) bool {
	if len(data) < 13 {
		return false
	}
	pos := 13
	if data[10]&128 != 0 {
		pos += 3 * (1 << ((data[10] & 7) + 1))
	}
	pixels, frames := 0, 0
	for pos < len(data) {
		marker := data[pos]
		pos++
		switch marker {
		case 0x3b:
			return frames > 0
		case 0x21:
			if pos >= len(data) {
				return false
			}
			pos++
		case 0x2c:
			if pos+9 > len(data) {
				return false
			}
			pixels += int(binary.LittleEndian.Uint16(data[pos+4:])) * int(binary.LittleEndian.Uint16(data[pos+6:]))
			frames++
			if pixels > 16_000_000 || frames > 100 {
				return false
			}
			flags := data[pos+8]
			pos += 9
			if flags&128 != 0 {
				pos += 3 * (1 << ((flags & 7) + 1))
			}
			pos++ // LZW minimum code size
		default:
			return false
		}
		for {
			if pos >= len(data) {
				return false
			}
			size := int(data[pos])
			pos++
			if size == 0 {
				break
			}
			pos += size
		}
	}
	return false
}

func sanitizeCommunityUpload(data []byte, extension string, visual bool) ([]byte, string, string, error) {
	invalid := errors.New("Unsupported or invalid file")
	if len(data) == 0 || len(data) > 10<<20 {
		return nil, "", "", invalid
	}
	if !visual {
		detected := http.DetectContentType(data)
		valid := false
		switch extension {
		case ".txt", ".csv":
			valid = utf8.Valid(data) && !bytes.Contains(data, []byte{0})
		case ".pdf":
			valid = strings.HasPrefix(detected, "application/pdf")
		case ".zip", ".docx", ".xlsx", ".pptx":
			valid = bytes.HasPrefix(data, []byte{'P', 'K', 3, 4})
		}
		if !valid {
			return nil, "", "", invalid
		}
		return data, "application/octet-stream", extension, nil
	}
	if len(data) > 5<<20 {
		return nil, "", "", invalid
	}
	formats := map[string]string{".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp", ".gif": "gif"}
	expected := formats[extension]
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || expected == "" || format != expected || config.Width < 1 || config.Height < 1 || config.Width > 4096 || config.Height > 4096 || config.Width*config.Height > 16_000_000 {
		return nil, "", "", invalid
	}
	var clean bytes.Buffer
	if format == "gif" {
		if !CommunityGIFBudget(data) {
			return nil, "", "", invalid
		}
		frames, e := gif.DecodeAll(bytes.NewReader(data))
		if e != nil {
			return nil, "", "", invalid
		}
		err = gif.EncodeAll(&clean, frames)
	} else {
		decoded, _, e := image.Decode(bytes.NewReader(data))
		if e != nil {
			return nil, "", "", invalid
		}
		if format == "jpeg" {
			err = jpeg.Encode(&clean, decoded, &jpeg.Options{Quality: 90})
		} else {
			format = "png"
			err = png.Encode(&clean, decoded)
		}
	}
	if err != nil || clean.Len() > 5<<20 {
		return nil, "", "", invalid
	}
	return clean.Bytes(), "image/" + format, "." + format, nil
}

func UploadCommunityAttachment(c *gin.Context) {
	store, err := helpcenter.ImageStoreFromEnv()
	if err != nil {
		communityError(c, 503, "Help center image storage is not configured")
		return
	}
	public, _ := url.Parse(store.PublicURL)
	requestURL, _ := url.Parse("https://" + c.Request.Host)
	requestHost := requestURL.Hostname()
	if strings.EqualFold(public.Hostname(), requestHost) {
		communityError(c, 503, "Chat files require a separate storage domain")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, (10<<20)+(64<<10))
	if c.Request.ParseMultipartForm(1<<20) != nil {
		communityError(c, 400, "File exceeds 10 MiB")
		return
	}
	defer c.Request.MultipartForm.RemoveAll()
	files := c.Request.MultipartForm.File["file"]
	kind := c.PostForm("kind")
	if len(files) != 1 || (kind != "image" && kind != "sticker" && kind != "file" && kind != "avatar") {
		communityError(c, 400, "Select one supported file")
		return
	}
	text := strings.TrimSpace(c.PostForm("text"))
	if utf8.RuneCountInString(text) > 2000 {
		communityError(c, 400, "Message must contain 1 to 2000 characters")
		return
	}
	file, err := files[0].Open()
	if err != nil {
		communityError(c, 400, "Could not read file")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (10<<20)+1))
	if err != nil {
		communityError(c, 400, "Could not read file")
		return
	}
	data, contentType, ext, err := sanitizeCommunityUpload(data, strings.ToLower(filepath.Ext(files[0].Filename)), kind != "file")
	if err != nil {
		communityError(c, 400, err.Error())
		return
	}
	name := filepath.Base(files[0].Filename)
	if !utf8.ValidString(name) || len(name) > 180 || strings.ContainsAny(name, "\x00\r\n\\:") {
		communityError(c, 400, "Invalid filename")
		return
	}
	disposition := "inline"
	if kind == "file" {
		disposition = mime.FormatMediaType("attachment", map[string]string{"filename": name})
	}
	link, err := store.PutObject(c.Request.Context(), "community/"+uuid.NewString()+ext, data, contentType, disposition)
	if err != nil {
		communityError(c, 502, "File storage is unavailable")
		return
	}
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		communityError(c, 401, "A dashboard login session is required")
		return
	}
	if _, _, err := service.ValidateLoginSession(identity); err != nil {
		communityError(c, 401, "A dashboard login session is required")
		return
	}
	config, err := model.GetCommunityConfig()
	if err != nil || !config.Enabled {
		communityError(c, 403, "Community chat is disabled")
		return
	}
	if kind == "avatar" {
		profile := model.CommunityProfile{UserID: c.GetInt("id"), Avatar: link}
		if err = model.DB.Clauses(clause.OnConflict{UpdateAll: true}).Create(&profile).Error; err != nil {
			communityError(c, 500, "Could not save avatar")
			return
		}
		c.JSON(200, gin.H{"success": true, "data": gin.H{"url": link}})
		return
	}
	message := model.CommunityMessage{Text: text, Kind: kind, URL: link, Filename: name, Size: int64(len(data))}
	if err = model.CreateCommunityMessage(c.GetInt("id"), &message); err != nil {
		communityError(c, 500, "Could not send message")
		return
	}
	notifyCommunityBot(message)
	c.JSON(200, gin.H{"success": true, "data": message})
}
