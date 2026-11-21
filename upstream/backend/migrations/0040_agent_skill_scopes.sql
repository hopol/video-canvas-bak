-- 技能使用场景拆分：enabled 只表示画布 Agent，短剧环节不再要求先启用。
-- 现在停用但标了短剧环节的技能，上线前对用户不可见；清空它们的环节，迁移后保持不可见。
-- drama_steps 列由 0025 加入；只在列存在时处理（迁移测试会跳过 0025 单独回放）。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'agent_skills' AND column_name = 'drama_steps'
    ) THEN
        UPDATE agent_skills SET drama_steps = '[]'::jsonb
         WHERE enabled = false AND drama_steps <> '[]'::jsonb;
    END IF;
END $$;
