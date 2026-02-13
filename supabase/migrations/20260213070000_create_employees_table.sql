-- Create employees table for custom authentication
CREATE TABLE IF NOT EXISTS employees (
  employee_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  email TEXT UNIQUE,
  full_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);

-- Create index on is_active for filtering active employees
CREATE INDEX IF NOT EXISTS idx_employees_is_active ON employees(is_active);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at (if not exists - safe for re-application)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE event_object_table = 'employees' 
    AND trigger_name = 'update_employees_updated_at'
  ) THEN
    CREATE TRIGGER update_employees_updated_at 
      BEFORE UPDATE ON employees 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Insert a test employee (password: 'password' hashed with bcrypt)
-- Employee ID: NW1007247, Password: password
INSERT INTO employees (employee_id, password_hash, email, full_name)
VALUES ('NW1007247', '$2b$10$teTBiSY5.ZhLKV/M55.BluPg/DvmSZPoiqoHbN6489YXsLzS/23hO', 'test@nxtwave.co.in', 'Test Employee')
ON CONFLICT (employee_id) DO NOTHING;

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON employees TO authenticated;
GRANT SELECT, INSERT, UPDATE ON employees TO anon;
