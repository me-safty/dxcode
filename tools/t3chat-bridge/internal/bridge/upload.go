package bridge

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"time"
)

const uploadthingURL = "https://t3.chat/api/uploadthing?actionType=upload&slug=attachmentUploader"

type uploadRequest struct {
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	Size     int    `json:"size"`
	Data     string `json:"data"` // base64-encoded file content
}

type uploadResponse struct {
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	Size     int    `json:"size"`
	Key      string `json:"key"`
	URL      string `json:"url"`
}

type utPresignedFile struct {
	Key        string `json:"key"`
	Name       string `json:"fileName"`
	FileURL    string `json:"fileUrl"`
	URL        string `json:"url"`
	PollingURL string `json:"pollingUrl"`
	PollingJWT string `json:"pollingJwt"`
}

type utPresignedResponse []utPresignedFile

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req uploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": fmt.Sprintf("invalid request body: %v", err)})
		return
	}

	fileData, err := base64.StdEncoding.DecodeString(req.Data)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": fmt.Sprintf("invalid base64 data: %v", err)})
		return
	}

	// Step 1: Request presigned URL from UploadThing via t3.chat
	utBody, _ := json.Marshal(map[string]any{
		"input": map[string]any{
			"originalMimeType": req.MimeType,
			"isTemporary":      false,
		},
		"files": []map[string]any{
			{
				"name":         req.Name,
				"size":         req.Size,
				"type":         req.MimeType,
				"lastModified": time.Now().UnixMilli(),
			},
		},
	})

	presignReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, uploadthingURL, bytes.NewReader(utBody))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": fmt.Sprintf("create presign request: %v", err)})
		return
	}
	s.applyT3Headers(presignReq)
	presignReq.Header.Set("x-uploadthing-version", "7.7.4")

	presignResp, err := s.config.Client.Do(presignReq)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("presign request failed: %v", err)})
		return
	}
	defer presignResp.Body.Close()

	presignBody, err := io.ReadAll(presignResp.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("read presign response: %v", err)})
		return
	}

	if presignResp.StatusCode != http.StatusOK {
		log.Printf("[upload] presign failed (%d): %s", presignResp.StatusCode, string(presignBody))
		writeJSON(w, presignResp.StatusCode, map[string]any{"error": fmt.Sprintf("presign failed (%d): %s", presignResp.StatusCode, string(presignBody))})
		return
	}

	log.Printf("[upload] presign response: %s", string(presignBody))

	var presigned utPresignedResponse
	if err := json.Unmarshal(presignBody, &presigned); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("parse presign response: %v", err)})
		return
	}
	if len(presigned) == 0 {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "no presigned URL returned"})
		return
	}

	file := presigned[0]
	log.Printf("[upload] presigned key=%s fileUrl=%s uploadUrl=%s pollingUrl=%s", file.Key, file.FileURL, file.URL, file.PollingURL)

	// Step 2: Upload file to presigned URL using multipart/form-data
	var mpBody bytes.Buffer
	mpWriter := multipart.NewWriter(&mpBody)
	part, err := mpWriter.CreateFormFile("file", req.Name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": fmt.Sprintf("create form file: %v", err)})
		return
	}
	if _, err := part.Write(fileData); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": fmt.Sprintf("write form file: %v", err)})
		return
	}
	mpWriter.Close()

	putReq, err := http.NewRequestWithContext(r.Context(), http.MethodPut, file.URL, &mpBody)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": fmt.Sprintf("create upload request: %v", err)})
		return
	}
	putReq.Header.Set("Content-Type", mpWriter.FormDataContentType())

	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("upload failed: %v", err)})
		return
	}
	defer putResp.Body.Close()
	putBody, _ := io.ReadAll(putResp.Body)

	if putResp.StatusCode < 200 || putResp.StatusCode >= 300 {
		log.Printf("[upload] PUT failed (%d): %s", putResp.StatusCode, string(putBody))
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("upload returned status %d", putResp.StatusCode)})
		return
	}
	log.Printf("[upload] PUT succeeded (%d)", putResp.StatusCode)

	// Step 3: Poll UploadThing to confirm upload is processed
	if file.PollingURL != "" {
		for i := 0; i < 10; i++ {
			pollReq, pollErr := http.NewRequestWithContext(r.Context(), http.MethodGet, file.PollingURL, nil)
			if pollErr != nil {
				break
			}
			if file.PollingJWT != "" {
				pollReq.Header.Set("x-uploadthing-polling-key", file.PollingJWT)
			}
			pollResp, pollErr := http.DefaultClient.Do(pollReq)
			if pollErr != nil {
				log.Printf("[upload] poll request failed: %v", pollErr)
				break
			}
			pollBody, _ := io.ReadAll(pollResp.Body)
			pollResp.Body.Close()

			var pollResult map[string]any
			if json.Unmarshal(pollBody, &pollResult) == nil {
				log.Printf("[upload] poll response: %s", string(pollBody))
				if status, ok := pollResult["status"].(string); ok && status == "done" {
					if fileData, ok := pollResult["fileData"].(map[string]any); ok {
						if fileURL, ok := fileData["fileUrl"].(string); ok {
							file.FileURL = fileURL
						}
					}
					break
				}
			}
			time.Sleep(500 * time.Millisecond)
		}
	}

	fileURL := file.FileURL
	if fileURL == "" && file.Key != "" {
		appID := "upoevdcxa3"
		if parsed, parseErr := url.Parse(file.URL); parseErr == nil {
			if id := parsed.Query().Get("x-ut-identifier"); id != "" {
				appID = id
			}
		}
		fileURL = fmt.Sprintf("https://%s.ufs.sh/f/%s", appID, file.Key)
	}

	log.Printf("[upload] done: key=%s url=%s", file.Key, fileURL)

	// Step 4: Return the file URL and key
	writeJSON(w, http.StatusOK, uploadResponse{
		Name:     req.Name,
		MimeType: req.MimeType,
		Size:     req.Size,
		Key:      file.Key,
		URL:      fileURL,
	})
}
