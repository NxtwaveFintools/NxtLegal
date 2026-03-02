-- Expand users email domain constraint to allow both approved NxtWave domains.

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
END $$;

ALTER TABLE public.users
  ADD CONSTRAINT users_email_domain_check
  CHECK (
    lower(email) LIKE '%@nxtwave.co.in'
    OR lower(email) LIKE '%@nxtwave.tech'
  );
