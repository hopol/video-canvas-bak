package migration_test

import (
	"strings"
	"testing"
)

// 公开音色随迁移一起入库：181 条（方舟国内 80 + BytePlus 101），文件在公网地址上，
// 记录里不依赖任何存储配置（storage_id 为 0），新环境跑完迁移就有完整音色库。
// 音色就是一条带公网地址的素材：所有模型都按这个地址取用，没有官方素材 ID / 资源域这类额外字段。
func TestOfficialVoicesMigration_SeedsVoicesWithPublicURL(t *testing.T) {
	db := isolatedDB(t)
	runReal(t, db)

	var total int64
	if err := db.Raw(`SELECT count(*) FROM assets
		WHERE source = 'official' AND kind = 'audio' AND user_id = 0`).Scan(&total).Error; err != nil {
		t.Fatal(err)
	}
	if total != 181 {
		t.Fatalf("公开音色数量不对：%d，期望 181", total)
	}

	// 每条都有公网音频地址与缩略图地址，不挂存储，带分类标签。
	var bad int64
	if err := db.Raw(`SELECT count(*) FROM assets WHERE source = 'official' AND (
			public_url NOT LIKE 'https://img.vbing.site/official-voices/%' OR thumbnail_url NOT LIKE 'https://img.vbing.site/official-voices/%'
			OR storage_id <> 0
			OR voice_age = '' OR voice_gender = '' OR voice_lang = ''
			OR public_url NOT LIKE '%/' || storage_key OR byte_size <= 0 OR sha256 = '')`).Scan(&bad).Error; err != nil {
		t.Fatal(err)
	}
	if bad != 0 {
		t.Fatalf("有 %d 条公开音色缺公网地址或分类标签", bad)
	}

	// 语言以每条音色自己的为准：BytePlus 的 101 条名字是「年龄 - 性别 - 名字」，全是英文；
	// 方舟国内的 80 条里有 7 条英文声音（名字就是英文角色），其余 73 条中文。对象 key 里带着官方素材 ID，可以据此认出这 7 条。
	englishInArk := []string{
		"%-5rq88-audio.%", // Chucky
		"%-ccgx8-audio.%", // Clown Man
		"%-qltvl-audio.%", // Jigsaw
		"%-kl5gf-audio.%", // Kevin McCallister
		"%-dqph5-audio.%", // Noah
		"%-k7px4-audio.%", // Xavier
		"%-j7z55-audio.%", // Zayne
	}
	isEnglishInArk := "storage_key LIKE '" + strings.Join(englishInArk, "' OR storage_key LIKE '") + "'"
	var wrongEnglish int64
	if err := db.Raw(`SELECT count(*) FROM assets WHERE source = 'official'
		AND file_name NOT LIKE '% - % - %' AND (` + isEnglishInArk + `) <> (voice_lang = 'en')`).Scan(&wrongEnglish).Error; err != nil {
		t.Fatal(err)
	}
	if wrongEnglish != 0 {
		t.Fatalf("有 %d 条方舟国内音色语言不对（只有那 7 条英文声音应为 en）", wrongEnglish)
	}
	var bytePlusNotEnglish int64
	if err := db.Raw(`SELECT count(*) FROM assets WHERE source = 'official'
		AND file_name LIKE '% - % - %' AND voice_lang <> 'en'`).Scan(&bytePlusNotEnglish).Error; err != nil {
		t.Fatal(err)
	}
	if bytePlusNotEnglish != 0 {
		t.Fatalf("有 %d 条 BytePlus 音色不是英文", bytePlusNotEnglish)
	}
	var zh, en int64
	if err := db.Raw(`SELECT count(*) FILTER (WHERE voice_lang = 'zh'), count(*) FILTER (WHERE voice_lang = 'en')
		FROM assets WHERE source = 'official'`).Row().Scan(&zh, &en); err != nil {
		t.Fatal(err)
	}
	if zh != 73 || en != 108 {
		t.Fatalf("语言分布不对：zh=%d en=%d，期望 73 / 108", zh, en)
	}

	// 不再有缩略图单独成行，也没有官方素材 ID、资源域这类只服务 asset:// 引用的列。
	var thumbs int64
	if err := db.Raw(`SELECT count(*) FROM assets WHERE source = 'official_thumb'`).Scan(&thumbs).Error; err != nil || thumbs != 0 {
		t.Fatalf("不应再有 official_thumb 行：%d %v", thumbs, err)
	}
	var cols []string
	if err := db.Raw(`SELECT column_name FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'assets'`).Scan(&cols).Error; err != nil {
		t.Fatal(err)
	}
	has := map[string]bool{}
	for _, c := range cols {
		has[c] = true
	}
	for _, want := range []string{"public_url", "thumbnail_url", "voice_age", "voice_gender", "voice_lang"} {
		if !has[want] {
			t.Fatalf("assets 缺少列 %s：%s", want, strings.Join(cols, ","))
		}
	}
	for _, gone := range []string{"thumbnail_key", "official_channel_key", "official_asset_id", "official_scope"} {
		if has[gone] {
			t.Fatalf("assets 不应再有列 %s", gone)
		}
	}
}

// 渠道上不再有「公开素材资源域」：音色按公网地址传，不需要判断渠道属于哪个素材库。
func TestOfficialVoicesMigration_NoChannelVoiceScope(t *testing.T) {
	db := isolatedDB(t)
	runReal(t, db)
	var n int64
	if err := db.Raw(`SELECT count(*) FROM information_schema.columns
		WHERE table_schema = current_schema() AND table_name = 'ai_channels' AND column_name = 'voice_scope'`).Scan(&n).Error; err != nil || n != 0 {
		t.Fatalf("ai_channels 不应有 voice_scope 列：%d %v", n, err)
	}
}
