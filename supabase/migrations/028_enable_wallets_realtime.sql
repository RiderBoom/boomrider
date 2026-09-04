-- Enable Supabase Realtime publication for public.wallets table
-- Allows client applications to receive real-time balance and history updates.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'wallets'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
    END IF;
  END IF;
END $$;
