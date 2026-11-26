CREATE TABLE drama_viewers (
    drama_id bigint NOT NULL,
    user_id bigint NOT NULL,
    CONSTRAINT fk_drama_viewers_drama FOREIGN KEY (drama_id) REFERENCES drama_projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_drama_viewers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (drama_id, user_id)
);
CREATE INDEX idx_drama_viewers_user ON drama_viewers (user_id, drama_id);
CREATE TABLE drama_deliveries (
    user_id bigint NOT NULL,
    request_key varchar(64) NOT NULL,
    drama_id bigint NOT NULL,
    recipient bigint NOT NULL,
    mode varchar(12) NOT NULL,
    result_id bigint NOT NULL DEFAULT 0,
    status varchar(16) NOT NULL DEFAULT 'running',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, request_key)
);
