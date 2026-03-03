DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_email_domain_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      DROP CONSTRAINT users_email_domain_check;
  END IF;

  ALTER TABLE public.users
    ADD CONSTRAINT users_email_domain_check
    CHECK (
      lower(trim(email)) ~ '^[a-z0-9._%+\-]+@(nxtwave\.co\.in|nxtwave\.in|nxtwave\.tech)$'
    );
END $$;
