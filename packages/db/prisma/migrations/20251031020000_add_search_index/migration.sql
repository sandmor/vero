-- CreateIndex
CREATE INDEX IF NOT EXISTS "Chat_title_gin_idx" ON "Chat" USING gin(to_tsvector('simple', title));

-- Shape constraint
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_path_shape_chk"
  CHECK (("path")::text ~ '^(_[0-9a-z]{2})(\._[0-9a-z]{2})*$');
