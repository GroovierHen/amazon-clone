-- Supabase serves every table in the public schema over its Data API, to anyone
-- holding the project's public key. Row level security with no policies shuts that
-- door. The app is unaffected: it connects as the table owner, which bypasses it.

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
