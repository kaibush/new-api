package helpcenter

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/google/uuid"
)

// ImageStore uses a dedicated public bucket or CDN; URLs never contain credentials
// or expiring signatures. HELP_CENTER_IMAGE_PUBLIC_URL points to the bucket root.
type ImageStore struct {
	Endpoint, Bucket, Region, AccessKey, SecretKey, PublicURL string
}

func ImageStoreFromEnv() (ImageStore, error) {
	store := ImageStore{
		Endpoint:  os.Getenv("HELP_CENTER_IMAGE_S3_ENDPOINT"),
		Bucket:    os.Getenv("HELP_CENTER_IMAGE_S3_BUCKET"),
		Region:    os.Getenv("HELP_CENTER_IMAGE_S3_REGION"),
		AccessKey: os.Getenv("HELP_CENTER_IMAGE_S3_ACCESS_KEY"),
		SecretKey: os.Getenv("HELP_CENTER_IMAGE_S3_SECRET_KEY"),
		PublicURL: os.Getenv("HELP_CENTER_IMAGE_PUBLIC_URL"),
	}
	if store.Region == "" {
		store.Region = "us-east-1"
	}
	if store.AccessKey == "" || store.SecretKey == "" || !regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`).MatchString(store.Bucket) {
		return store, errors.New("Help center image storage is not configured")
	}
	for _, raw := range []string{store.Endpoint, store.PublicURL} {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.TrimSpace(raw) != raw || (u.Scheme != "https" && u.Scheme != "http") {
			return store, errors.New("Invalid help center image storage URL")
		}
	}
	if !strings.HasPrefix(store.PublicURL, "https://") {
		return store, errors.New("Help center public image URL must use HTTPS")
	}
	return store, nil
}

func (store ImageStore) PutImage(ctx context.Context, data []byte, format string) (string, error) {
	mime := map[string]string{"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}[format]
	if mime == "" {
		return "", errors.New("Unsupported image format")
	}
	key := "help-center/" + uuid.NewString() + "." + format
	endpoint := strings.TrimRight(store.Endpoint, "/") + "/" + store.Bucket + "/" + key
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, bytes.NewReader(data))
	if err != nil {
		return "", errors.New("Invalid image storage request")
	}
	request.Header.Set("Content-Type", mime)
	request.Header.Set("Cache-Control", "public, max-age=31536000, immutable")
	hash := fmt.Sprintf("%x", sha256.Sum256(data))
	request.Header.Set("X-Amz-Content-Sha256", hash)
	err = v4.NewSigner().SignHTTP(ctx, aws.Credentials{AccessKeyID: store.AccessKey, SecretAccessKey: store.SecretKey}, request, hash, "s3", store.Region, time.Now())
	if err != nil {
		return "", errors.New("Could not sign image storage request")
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return "", errors.New("Image storage is unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", errors.New("Image storage rejected the upload")
	}
	return strings.TrimRight(store.PublicURL, "/") + "/" + key, nil
}
