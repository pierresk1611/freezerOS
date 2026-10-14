# Oprava aktivácie fotografií

V projekte `vhjuweumaaysfklkitfi` bolo 14. 10. 2026 overené: `recipes.photo_revision` neexistuje (42703), `recipe_photos` a `recipe_image_references` nie sú dostupné v schéme (PGRST205). Bez týchto objektov sa fotografie nemôžu uložiť. „Success. No rows returned“ z iného alebo čiastočného SQL dotazu nepotvrdzuje ich vytvorenie.

1. Otvorte **tento konkrétny projekt**: [Supabase SQL Editor](https://supabase.com/dashboard/project/vhjuweumaaysfklkitfi/sql/new). V adrese musí byť `vhjuweumaaysfklkitfi`.
2. Otvorte [opravnú migráciu 006](https://github.com/pierresk1611/freezerOS/blob/main/supabase/migrations/202610140006_repair_photo_setup.sql), kliknite **Raw** a skopírujte celý SQL súbor.
3. Vložte ho do nového dotazu a kliknite **Run**. Na konci už skript zobrazí štyri overovacie hodnoty; všetky musia byť **true**. Skript možno zopakovať; nevytvorí duplicitné recepty a neprepisuje receptové funkcie ani metadáta z migrácie 005. Existujúce fotografie nemaže. Krátko zamyká upravované objekty; vykonajte ho mimo aktívneho uploadu.
4. Overte výsledok v tom istom editore:

```sql
select
  exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='recipes' and column_name='photo_revision') as photo_revision_exists,
  to_regclass('public.recipe_photos') is not null as photos_table_exists,
  to_regclass('public.recipe_image_references') is not null as references_table_exists,
  exists(select 1 from storage.buckets where id='recipe-photos' and public=false) as private_bucket_exists;
```

Všetky štyri hodnoty musia byť **true**. Potom obnovte aplikáciu, kliknite **Skúsiť načítať fotografie znova** a **Pridať fotografiu**.

Fotografie sa po výbere súboru ukladajú automaticky; samostatné ukladanie receptu nevykonáva upload. Tlačidlo **Uložiť novú verziu** je v spodnom paneli editora a týka sa receptového textu.

Ak overovací dotaz vracia true, ale aplikácia stále hlási chýbajúce objekty, porovnajte vo Verceli → projekt → Settings → Environment Variables → `NEXT_PUBLIC_SUPABASE_URL`: musí byť `https://vhjuweumaaysfklkitfi.supabase.co`. Pri odlišnej URL najprv skontrolujte, kde sú vaše skutočné recepty; nemeníte ju naslepo. Kľúče neposielajte do chatu.
