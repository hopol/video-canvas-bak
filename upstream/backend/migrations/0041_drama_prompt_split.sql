-- 「剧本改编」(adapt) 拆成「分集规划」(plan) 与「分集剧本」(scripts) 两个独立环节。
-- 1. 我的提示词按页拆：有规划页的行原地改成 plan（保留 id），有剧本页的另建一行 scripts，没有规划页的旧行删除。
-- 2. drama_prompt_splits 记下旧 id → 新 id；项目快照里的 id 是应用密钥编码的，SQL 算不出，
--    由后端启动时按这张表修补（service.SplitAdaptPromptSettings）。
-- 3. 技能的 adapt 换成 plan + scripts，保持原有行为。
-- 表和列由 0025 加入；迁移测试会跳过 0025 单独回放，所以都先判断存在。
CREATE TABLE drama_prompt_splits (
    old_id bigint PRIMARY KEY,
    plan_id bigint,
    scripts_id bigint
);

DO $$
BEGIN
    IF to_regclass('drama_prompts') IS NOT NULL THEN
        INSERT INTO drama_prompt_splits (old_id, plan_id)
        SELECT id, CASE WHEN btrim(COALESCE(bodies->>'plan', '')) <> '' THEN id END
          FROM drama_prompts WHERE step = 'adapt';

        WITH src AS (
            SELECT id, user_id, name, bodies->>'scripts' AS body, created_at
              FROM drama_prompts
             WHERE step = 'adapt' AND btrim(COALESCE(bodies->>'scripts', '')) <> ''
        ), ins AS (
            INSERT INTO drama_prompts (user_id, step, name, bodies, revision, created_at, updated_at)
            SELECT user_id, 'scripts', name, jsonb_build_object('scripts', body), 1, created_at, NOW() FROM src
            RETURNING id, user_id, name
        )
        UPDATE drama_prompt_splits sp SET scripts_id = ins.id
          FROM ins JOIN src ON src.user_id = ins.user_id AND src.name = ins.name
         WHERE sp.old_id = src.id;

        UPDATE drama_prompts
           SET step = 'plan', bodies = jsonb_build_object('plan', bodies->>'plan'), updated_at = NOW()
         WHERE step = 'adapt' AND btrim(COALESCE(bodies->>'plan', '')) <> '';
        DELETE FROM drama_prompts WHERE step = 'adapt';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'agent_skills' AND column_name = 'drama_steps'
    ) THEN
        UPDATE agent_skills s
           SET drama_steps = (
               SELECT COALESCE(jsonb_agg(to_jsonb(u.step) ORDER BY e.ord, u.sub), '[]'::jsonb)
                 FROM jsonb_array_elements_text(s.drama_steps) WITH ORDINALITY AS e(step, ord)
                 CROSS JOIN LATERAL unnest(CASE WHEN e.step = 'adapt' THEN ARRAY['plan', 'scripts'] ELSE ARRAY[e.step] END)
                       WITH ORDINALITY AS u(step, sub)
           )
         WHERE drama_steps ? 'adapt';
    END IF;
END $$;
