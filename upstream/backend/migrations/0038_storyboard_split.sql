-- 画布分镜表「从剧本拆分镜」：同步调 Agent 模型，按实际用量扣费；扣费流水关联画布（同一画布可多次拆分镜，不唯一）。
ALTER TABLE credit_ledger ADD COLUMN canvas_id bigint;
CREATE INDEX idx_ledger_canvas ON credit_ledger (canvas_id) WHERE canvas_id IS NOT NULL;
