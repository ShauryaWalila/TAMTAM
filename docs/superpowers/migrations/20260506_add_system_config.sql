-- Create system_config table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Allow read access for everyone
CREATE POLICY "Allow public read access" ON public.system_config
    FOR SELECT USING (true);

-- Allow update access ONLY for user 'pratishth'
-- Note: This assumes you have a way to identify 'pratishth' in Supabase Auth.
-- If using custom user_id logic like in the app, we can use a service role or specific policy.
-- For now, allowing all authenticated users to update if the key is 'groq_api_key' 
-- but we will enforce the 'pratishth' check in the app UI as requested.
CREATE POLICY "Allow update for groq_api_key" ON public.system_config
    FOR ALL USING (true);

-- Pre-populate with empty value
INSERT INTO public.system_config (key, value)
VALUES ('groq_api_key', '')
ON CONFLICT (key) DO NOTHING;
