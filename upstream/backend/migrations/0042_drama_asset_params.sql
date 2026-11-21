-- 短剧三类资产（人物 / 场景 / 物品）新建节点时默认的比例、分辨率等生成参数。
ALTER TABLE drama_projects
    ADD COLUMN image_params jsonb NOT NULL DEFAULT '{}'::jsonb;
