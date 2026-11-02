-- #987 Billing 2/5 — backfill default prices onto existing plan versions.
--
-- The `plan_versions.pricing` column was added (nullable) in 0027 but left
-- null; #970's seed wrote no prices. On a database that already ran the old
-- seed, the default plans' current version rows have pricing = NULL. This
-- migration sets the operator's default prices (2026-11-02) on those rows so
-- /pricing and checkout have a live price without waiting for an admin edit.
--
-- Amounts are in the currency's MINOR unit (paise; ₹1 = 100). Yearly is 10×
-- monthly (two months free):
--   Starter ₹59/mo (5900)  ₹590/yr (59000)
--   Pro     ₹199/mo (19900) ₹1,990/yr (199000)
--   Team    ₹299/mo (29900) ₹2,990/yr (299000)
--
-- IDEMPOTENT and NON-DESTRUCTIVE: it writes only the CURRENT version of each of
-- the three default plans, and ONLY when that version's pricing is still NULL,
-- so an admin who has already edited a price (pricing set) is never clobbered,
-- a fresh database whose boot seed already wrote prices is a no-op, and a plan
-- an admin removed simply matches no row. It touches no schema.

UPDATE plan_versions pv
   SET pricing = p.price
  FROM plans pl
  CROSS JOIN LATERAL (
    VALUES
      ('starter', '{"primaryCurrency":"INR","amounts":{"monthly":{"INR":5900},"yearly":{"INR":59000}}}'::jsonb),
      ('pro',     '{"primaryCurrency":"INR","amounts":{"monthly":{"INR":19900},"yearly":{"INR":199000}}}'::jsonb),
      ('team',    '{"primaryCurrency":"INR","amounts":{"monthly":{"INR":29900},"yearly":{"INR":299000}}}'::jsonb)
  ) AS p(key, price)
 WHERE pv.id = pl.current_version_id
   AND lower(pl.key) = p.key
   AND pv.pricing IS NULL;
