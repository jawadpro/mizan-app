-- A bank account can carry the last digits of its cards too ("1234, 4321"), so card alerts find the right account.
ALTER TABLE app.banks DROP CONSTRAINT IF EXISTS banks_account_hint_check;
ALTER TABLE app.banks ADD CONSTRAINT banks_account_hint_check
  CHECK (account_hint ~ '^([0-9]{3,4}(, [0-9]{3,4}){0,5})?$');
