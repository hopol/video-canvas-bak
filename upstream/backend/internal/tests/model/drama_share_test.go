package model_test

import (
	"testing"

	"github.com/gin-gonic/gin/binding"

	. "video-canvas/internal/model"
)

// 共享请求的校验要和前端约定一致：仅查看不带请求键；副本和转移带前端生成的 32 位十六进制键。
func TestDramaShareReqValidation(t *testing.T) {
	key := "0123456789abcdef0123456789abcdef"
	cases := []struct {
		name string
		req  DramaShareReq
		ok   bool
	}{
		{"仅查看不带请求键", DramaShareReq{Mode: "view", Email: "a@example.com"}, true},
		{"副本带十六进制请求键", DramaShareReq{Mode: "copy", Email: "a@example.com", RequestKey: key}, true},
		{"转移带十六进制请求键", DramaShareReq{Mode: "transfer", Email: "a@example.com", RequestKey: key}, true},
		{"副本缺请求键", DramaShareReq{Mode: "copy", Email: "a@example.com"}, false},
		{"转移缺请求键", DramaShareReq{Mode: "transfer", Email: "a@example.com"}, false},
		{"请求键超过 64 字符", DramaShareReq{Mode: "copy", Email: "a@example.com", RequestKey: key + key + "x"}, false},
	}
	for _, c := range cases {
		err := binding.Validator.ValidateStruct(&c.req)
		if (err == nil) != c.ok {
			t.Errorf("%s：期望通过=%v，实际错误=%v", c.name, c.ok, err)
		}
	}
}
