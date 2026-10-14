# Food Cost – prvý finančný míľnik

## Aktivácia v existujúcej produkcii

Nová verzia aplikácie potrebuje **iba novú migráciu 007**: `supabase/migrations/202610140007_food_cost.sql`. Migrácie 001–006 sa nemenia a nemajú sa znovu spúšťať. Migrácia pridáva nákupné tabuľky, súkromný bucket a nové RPC. Nevykonáva aktualizáciu existujúcich receptov, fotografií, várok, skladových balíčkov ani historických nákladov.

Pred produkčným DDL si overte projekt `vhjuweumaaysfklkitfi`, stav záloh a schváľte tento konkrétny súbor. V Supabase otvorte **SQL Editor → New query**, vložte **celý** súbor 007 a zvoľte **Run**. Súbor je určený na jedno vykonanie; pri už dokončenej migrácii ho nespúšťajte opakovane. Ak SQL editor oznámi chybu, nepokračujte manuálnym mazaním tabuliek. Vráťte presné chybové hlásenie. CLI `supabase db push` používa transakciu migrácie. V SQL Editore spustite celý obsah v jednom vykonaní.

Kontrola po aktivácii:

```sql
select to_regclass('public.purchase_receipts') is not null as receipts_ready,
       to_regclass('public.purchase_price_history') is not null as prices_ready,
       exists(select 1 from storage.buckets where id='purchase-receipts' and public=false) as private_bucket_ready;
```

Git push spustí nasadenie iba vtedy, keď je existujúci projekt Vercel prepojený s vetvou main. Stav buildov overte vo **Vercel → freezer-os → Deployments**. Bez 007 sa nové obrazovky pravdivo hlásia ako neaktivované; staré moduly zostávajú použiteľné.

## Prvý nákup

1. Na mobile otvorte **Viac → Food Cost → Naskenovať účtenku**. Desktop má Food Cost v bočnom paneli.
2. Vytvorte pracovný návrh. Vyberte dokumenty, odfoťte účtenku alebo vyplňte položky ručne.
3. Fotografie JPG/PNG/WEBP do 20 MB sa v prehliadači zmenšia; server overí skutočný formát a odstráni metadáta. PDF do 4 MB môže mať až 20 strán. Jedna účtenka má najviac 8 súborov, nahrávajú sa samostatne kvôli limitu požiadavky Vercel. HEIC nie je podporovaný.
4. Vyplňte obchod, dátum, číslo objednávky, konečnú zaplatenú sumu a položky. **Celkom po zľave** je konečná cena riadku. Neznáma zľava zostáva prázdna, nie automaticky nulová. Zľava je samostatná informácia a neodpočítava sa druhýkrát. Dopravu a poplatky vložte ako skutočné riadky. Nepridávajte vymyslené vyrovnávacie položky.
5. Neznáme množstvo a jednotku nechajte prázdne. Každá cena a konečný súčet musia byť známe pred potvrdením. **Uložiť pracovný návrh** uchová neúplné údaje bez započítania výdavku.
6. Skontrolujte opakované položky a nesúlad súčtu. **Potvrdiť nákup** transakčne zapíše položky a audit, potom otvorí dashboard.
7. Nákup otvorte cez Účtenky/Nákupy. Oprava vytvorí auditnú revíziu toho istého nákupu. Storno ho vyradí z finančných súčtov, ale nezmaže históriu. Vratku môžete zadať ako samostatný potvrdený doklad so zápornými skutočnými položkami.

## Automatické rozpoznávanie – stav a konfigurácia

Je implementovaný serverový provider pre OpenAI Responses API so štruktúrovaným JSON výstupom. Obrázky sa odovzdávajú ako obrazové vstupy, PDF ako súborové vstupy; provider môže spracovať text aj skenované viacstranové PDF. Regex slúži len na návrh kategórie, nie ako OCR.

**Reálne rozpoznávanie na vašom účte nie je overené, pokiaľ nie je zadaný kľúč a úspešne rozpoznaný testovací doklad.** Lokálne testy overujú integračný kontrakt simulovanými odpoveďami, úspech, chybu aj neúplný výsledok; nepredstierajú volanie živej AI.

Ak chcete OCR aktivovať: **Vercel → projekt freezer-os → Settings → Environment Variables → Add**:

- `RECEIPT_OPENAI_API_KEY`: váš tajný API kľúč, len server, nikdy do chatu ani GitHubu.
- `RECEIPT_OPENAI_MODEL`: voliteľné, predvolene `gpt-4.1-mini`; účet musí model podporovať.

Potom **Deployments → Redeploy**. Provider je platená externá služba podľa API účtu. Aplikácia odosiela priložené dokumenty iba po zaškrtnutí explicitného súhlasu a kliknutí na Rozpoznať položky. `store:false` žiada neukladať odpoveď v Responses API; neznamená to automaticky zmluvnú nulovú retenciu na strane poskytovateľa. Pred odoslaním zvážte osobné údaje na doklade. Server neposiela ďalšie zásoby ani recepty. Limity: jeden aktívny pokus, najviac päť pokusov za desať minút na účet. Zlyhanie nechá pracovný návrh a umožňuje manuálne zadanie.

## Presnosť a zdroje

- **Purchase Cost:** presná suma potvrdených riadkov v celých halieroch, vrátane skutočných zliav a záporných vratiek; storná sa nezapočítavajú.
- **Ingredient Cost / ceny:** zaplatená cena za kg/l/ks/balenie sa vypočíta iba z reálne zadaného množstva a jednotky. Balenia bez hmotnosti sa neprepočítajú na kg. Cenový trend pre vybraný rok používa kladné nákupné riadky; vratka nie je nová nákupná cena suroviny.
- **Recipe Cost / Portion Cost:** výslovne orientačný prepočet posledných známych kladných cien používateľsky mapovaných surovín. Chýbajúce ceny sú označené; neúplný recept nemá predstieranú presnú cenu porcie. Nevytvára nákladový snapshot.
- **Batch Cost / Consumption Cost / Inventory Value:** používa existujúce snapshoty a existujúce skladové transakcie. Nákupy ich nemenia. Dashboard hodnotu zostávajúcich zásob prezentuje ako prehľad známych nákladov; neznáme balíčky a konzumácie sú označené, nie počítané ako nulové.
- **Waste Cost:** zatiaľ neznámy, pretože existujúci sklad nemá nákladovú transakciu vyradenia. Nezobrazuje sa fiktívna nula.
- Rozpočet používa všetky potravinové výdavky daného mesiaca, oddelene od filtrov kategórie/obchodu. Nepotravinový tovar a doprava sú samostatné kategórie.

## Model, bezpečnosť a duplicity

Globálny nezmeniteľný katalóg `purchase_categories` obsahuje kategórie potravín, vybavenia a poplatkov; autentifikovaní používatelia ho môžu čítať.

Tabuľky `purchase_receipts`, `purchase_receipt_files`, `purchase_receipt_items`, `purchase_merchants`, `purchase_products`, `purchase_product_aliases`, `purchase_import_jobs`, `purchase_budgets`, `purchase_audit`; view `purchase_price_history` používa security_invoker. Používateľ má vlastné SELECT RLS, zmeny účteniek výhradne cez autorizované RPC; rozpočty majú vlastnícku write RLS. Súbory sú súkromné so signed URL na jednu hodinu. Žiadny service-role kľúč nie je potrebný v produkčnej aplikácii.

Normalizovaný produkt spája rôzne používateľom potvrdené označenia. Alias si pamätá kategóriu a mapovanú surovinu. Jednotlivé nákupné riadky uchovávajú vlastný názov, kategóriu, mapovanie a ceny ako historický snapshot.

Potvrdenie používa request UUID a payload idempotenciu; revízia a row lock bránia stratenej oprave. Zámok používateľa serializuje súbežné potvrdenia rozdielnych návrhov rovnakého nákupu. Detekcia možnej duplicity porovnáva obchod + objednávku, obchod + dátum + sumu, rovnaký obsah položiek a SHA256 priloženého dokumentu. Identické riadky z prekrývajúcich sa screenshotov sú pri kontrole označené, ale automaticky sa nemažú, pretože môžu predstavovať dva skutočné nákupy rovnakého tovaru. AI má pokyn prekrytie rozpoznať; posledné rozhodnutie zostáva používateľovi. Osobitná potvrdená výnimka umožňuje dva legitímne podobné nákupy.

## API

`POST /api/food-cost`, vždy vlastná prihlásená relácia a kontrola Origin:

- JSON `action:create`, `id` UUID: idempotentne založí návrh.
- Multipart `receipt`, `file`: overí a uloží súbor návrhu, hash a väzbu.
- JSON `action:recognize`, `id`, `consent:true`: spustí nakonfigurovaný serverový provider. Nákup nepotvrdzuje.
- JSON `action:draft`, `id`, `revision`, `data`: uloží neúplný návrh.
- JSON `action:save`, `id`, `revision`, `requestId`, `data`, `duplicateConfirmed`: potvrdí alebo opraví nákup.
- JSON `action:cancel`, `id`, `revision`, `requestId`: storno bez mazania histórie.

Validátory a jednotky: `src/lib/food-cost.ts`. Žiadne priame verejné integračné API ani automatické prepojenie nákupov s ingredient lots zatiaľ nie sú vyhlásené za hotové.

## Lokálne overenie

`npm test`, `npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`. DB testy odmietajú cloudový projekt; migrácie sa navyše overujú v izolovanej dočasnej databáze. E2E vytvárajú výhradne syntetické lokálne PNG/JPG/PDF doklady a nákupy a po skončení odstránia súkromné súbory testovacieho používateľa. Nepoužívajte skutočné účtenky v automatizovaných testoch.
