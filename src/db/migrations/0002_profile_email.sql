ALTER TABLE "app"."profiles" ADD COLUMN "email" text;--> statement-breakpoint
-- Keep profiles.email in sync with auth.users (insert and email change).
CREATE OR REPLACE FUNCTION app.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO app.profiles (user_id, full_name, email)
  VALUES (NEW.id, nullif(NEW.raw_user_meta_data ->> 'full_name', ''), lower(NEW.email))
  ON CONFLICT (user_id) DO UPDATE SET email = excluded.email;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.handle_auth_user_email_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE app.profiles SET email = lower(NEW.email) WHERE user_id = NEW.id;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.handle_auth_user_email_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_email_changed_app_profile
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION app.handle_auth_user_email_change();
--> statement-breakpoint
UPDATE app.profiles p SET email = lower(u.email) FROM auth.users u WHERE u.id = p.user_id;
