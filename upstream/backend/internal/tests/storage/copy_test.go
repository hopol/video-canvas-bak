package storage_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	. "video-canvas/internal/storage"
)

// S3 兼容存储的复制走服务端 CopyObject：内容不经过后端，源对象保留，类型跟着源走。
func TestS3Storage_CopyIsServerSide(t *testing.T) {
	f := newFakeS3(t, "vc-bucket")
	spec := f.spec()
	spec.PathPrefix = "prod"
	s, err := NewFromSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	f.put("prod/u1/src.png", []byte("png-bytes"), "image/png")

	if err := s.Copy(context.Background(), "u1/src.png", "u2/dst.png"); err != nil {
		t.Fatal(err)
	}
	if got := f.objects["prod/u2/dst.png"]; !bytes.Equal(got, []byte("png-bytes")) || f.types["prod/u2/dst.png"] != "image/png" {
		t.Fatalf("副本内容或类型不对：%q %q", got, f.types["prod/u2/dst.png"])
	}
	if _, ok := f.objects["prod/u1/src.png"]; !ok {
		t.Fatal("源对象必须保留")
	}
	if len(f.copies) != 1 || f.copies[0] != "prod/u1/src.png" || f.gets != 0 {
		t.Fatalf("应只发一次服务端复制、不读回内容：copies=%v gets=%d", f.copies, f.gets)
	}
}

func TestS3Storage_CopyMissingSource(t *testing.T) {
	f := newFakeS3(t, "vc-bucket")
	s, err := NewFromSpec(f.spec())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Copy(context.Background(), "u1/lost.png", "u2/dst.png"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("源不存在应返回 ErrNotFound，实际：%v", err)
	}
	if err := s.Copy(context.Background(), "../x", "u2/dst.png"); err == nil {
		t.Fatal("非法 key 应被拒绝")
	}
}

func TestLocalStorage_Copy(t *testing.T) {
	ctx := context.Background()
	l := newTestLocal(t, "/files")
	if err := l.Put(ctx, "u1/src.png", strings.NewReader("png-bytes"), 9, "image/png"); err != nil {
		t.Fatal(err)
	}
	if err := l.Copy(ctx, "u1/src.png", "u2/202611/dst.png"); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"u1/src.png", "u2/202611/dst.png"} {
		body, err := l.Open(ctx, key)
		if err != nil {
			t.Fatalf("%s 读不到：%v", key, err)
		}
		b, _ := io.ReadAll(body)
		_ = body.Close()
		if string(b) != "png-bytes" {
			t.Fatalf("%s 内容不对：%q", key, b)
		}
	}
	if err := l.Copy(ctx, "u1/lost.png", "u2/x.png"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("源不存在应返回 ErrNotFound，实际：%v", err)
	}
}
