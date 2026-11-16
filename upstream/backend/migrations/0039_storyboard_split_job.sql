-- 拆分镜异步任务：提交后立刻返回，后台 worker 跑模型，结果通过 WebSocket 推给前端。
-- 同画布同节点同时只允许一条非终态任务（部分唯一索引）。
CREATE TABLE storyboard_split_jobs (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL,
    canvas_id bigint NOT NULL,
    node_id varchar(64) NOT NULL,
    model_key varchar(128) NOT NULL DEFAULT '',
    script text NOT NULL DEFAULT '',
    status varchar(16) NOT NULL DEFAULT 'pending',
    error text NOT NULL DEFAULT '',
    shots jsonb,
    credits bigint NOT NULL DEFAULT 0,
    input_tokens bigint NOT NULL DEFAULT 0,
    output_tokens bigint NOT NULL DEFAULT 0,
    prompt_chars bigint NOT NULL DEFAULT 0,
    attempts bigint NOT NULL DEFAULT 0,
    created_at timestamptz,
    updated_at timestamptz
);
CREATE INDEX idx_storyboard_split_user ON storyboard_split_jobs (user_id);
CREATE UNIQUE INDEX uk_storyboard_split_active ON storyboard_split_jobs (canvas_id, node_id) WHERE status IN ('pending', 'running');
