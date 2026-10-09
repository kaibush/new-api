package controller_test

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func helpImageRequest(t *testing.T, data []byte, filenames ...string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	filename := "upload.png"
	if len(filenames) > 0 {
		filename = filenames[0]
	}
	part, err := writer.CreateFormFile("file", filename)
	require.NoError(t, err)
	_, err = part.Write(data)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	request := httptest.NewRequest(http.MethodPost, "/api/option/help-center/images", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request
}

func configureHelpImageStore(t *testing.T, endpoint string) {
	t.Helper()
	t.Setenv("HELP_CENTER_IMAGE_S3_ENDPOINT", endpoint)
	t.Setenv("HELP_CENTER_IMAGE_S3_BUCKET", "help-images")
	t.Setenv("HELP_CENTER_IMAGE_S3_REGION", "us-east-1")
	t.Setenv("HELP_CENTER_IMAGE_S3_ACCESS_KEY", "help-test")
	t.Setenv("HELP_CENTER_IMAGE_S3_SECRET_KEY", "help-test-secret")
	t.Setenv("HELP_CENTER_IMAGE_PUBLIC_URL", "https://images.example.com")
}

func TestHelpCenterImageUpload(t *testing.T) {
	var pngData, jpegData, widePNG bytes.Buffer
	pixels := image.NewRGBA(image.Rect(0, 0, 2, 3))
	require.NoError(t, png.Encode(&pngData, pixels))
	require.NoError(t, jpeg.Encode(&jpegData, pixels, nil))
	require.NoError(t, png.Encode(&widePNG, image.NewRGBA(image.Rect(0, 0, 8193, 1))))
	for _, tc := range []struct {
		name                  string
		data                  []byte
		storageStatus, status int
		mime                  string
	}{
		{"PNG strips appended content and generates a filename", append(bytes.Clone(pngData.Bytes()), []byte("<script>private metadata</script>")...), 200, 200, "image/png"},
		{"JPEG retains image MIME", jpegData.Bytes(), 200, 200, "image/jpeg"},
		{"SVG is rejected", []byte(`<svg onload="alert(1)"></svg>`), 200, 400, ""},
		{"empty image is rejected", nil, 200, 400, ""},
		{"oversized dimensions are rejected", widePNG.Bytes(), 200, 400, ""},
		{"truncated image is rejected", pngData.Bytes()[:40], 200, 400, ""},
		{"oversized file is rejected", make([]byte, 5<<20+1), 200, 400, ""},
		{"storage failure returns no link or credentials", pngData.Bytes(), 403, 502, "image/png"},
		{"storage redirects are not followed", pngData.Bytes(), 307, 502, "image/png"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var uploaded []byte
			var objectPath, mime, authorization, hash string
			var calls int
			store := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				uploaded, _ = io.ReadAll(r.Body)
				objectPath, mime, authorization, hash = r.URL.Path, r.Header.Get("Content-Type"), r.Header.Get("Authorization"), r.Header.Get("X-Amz-Content-Sha256")
				if tc.storageStatus == 307 {
					w.Header().Set("Location", "/redirect-target")
				}
				w.WriteHeader(tc.storageStatus)
				if tc.storageStatus != 200 {
					_, _ = w.Write([]byte("help-test-secret"))
				}
			}))
			defer store.Close()
			configureHelpImageStore(t, store.URL)
			router := gin.New()
			router.POST("/api/option/help-center/images", controller.UploadHelpCenterImage)
			response := httptest.NewRecorder()
			filename := "upload.png"
			if tc.mime == "image/jpeg" {
				filename = "upload.jpg"
			}
			router.ServeHTTP(response, helpImageRequest(t, tc.data, filename))
			require.Equal(t, tc.status, response.Code, response.Body.String())
			assert.NotContains(t, response.Body.String(), "help-test-secret")
			if tc.status == 400 {
				assert.Zero(t, calls)
				return
			}
			require.Equal(t, 1, calls)
			assert.Contains(t, authorization, "AWS4-HMAC-SHA256 Credential=help-test/")
			assert.Equal(t, fmt.Sprintf("%x", sha256.Sum256(uploaded)), hash)
			assert.Equal(t, tc.mime, mime)
			assert.Regexp(t, `^/help-images/help-center/[a-f0-9-]+\.(png|jpeg)$`, objectPath)
			assert.NotContains(t, string(uploaded), "private metadata")
			if tc.status == 200 {
				var result struct {
					Success bool
					Data    struct{ URL string }
				}
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				assert.True(t, result.Success)
				assert.Equal(t, "https://images.example.com"+strings.TrimPrefix(objectPath, "/help-images"), result.Data.URL)
				decoded, _, err := image.Decode(bytes.NewReader(uploaded))
				require.NoError(t, err)
				assert.Equal(t, pixels.Bounds(), decoded.Bounds())
			}
		})
	}
}

func TestHelpCenterImageRequiresStorageAndAuthorization(t *testing.T) {
	t.Run("missing storage configuration is actionable", func(t *testing.T) {
		t.Setenv("HELP_CENTER_IMAGE_S3_ACCESS_KEY", "")
		router := gin.New()
		router.POST("/api/option/help-center/images", controller.UploadHelpCenterImage)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, helpImageRequest(t, []byte("image")))
		assert.Equal(t, http.StatusServiceUnavailable, response.Code)
	})
	for _, cookie := range []string{"", "session=forged"} {
		t.Run("cookie alone never authorizes upload "+cookie, func(t *testing.T) {
			router := gin.New()
			router.POST("/api/option/help-center/images", middleware.RootAuth(), controller.UploadHelpCenterImage)
			request := helpImageRequest(t, []byte("image"))
			request.Header.Set("Cookie", cookie)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			assert.Equal(t, http.StatusUnauthorized, response.Code)
		})
	}
}
