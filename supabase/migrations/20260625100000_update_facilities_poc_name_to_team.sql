-- Update Facilities team POC name from "Siva Prasad Chary" (left) to generic "Facilities_Team"
-- Idempotent: only updates if poc_name still holds the old value
UPDATE teams
SET
    poc_name   = 'Facilities_Team',
    updated_at = NOW()
WHERE id       = '6e7294b4-e6d0-486e-a42d-4e85593c8551'
  AND poc_name = 'Siva Prasad Chary';
