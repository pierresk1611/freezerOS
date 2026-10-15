# Hromadný import receptov FREEZER OS 1.0

## Použitie

**Recepty → Import** (`/recipes/import`):

1. Vyberte jeden JSON s viacerými receptami alebo viac JSON súborov súčasne. Na počítači ich môžete aj pretiahnuť do plochy importu; telefón používa systémový výber súborov. JSON môžete naďalej vložiť zo schránky. Predvolené receptové šablóny sa najprv načítajú do rovnakého náhľadu.
2. Skontrolujte všetky recepty, ich zdrojové súbory a podrobnosti. Limity: 10 súborov, 200 receptov a 2 MB spolu; schéma 1.0 naďalej povoľuje najviac 50 receptov v jednom súbore.
3. Checkboxmi vyberte recepty. Možné duplicity podľa názvu alebo obsahu sú predvolene nevybrané. Náhľad zahŕňa aj historické verzie a archivované recepty, aby sa upravené alebo archivované jedlá nezakladali znovu.
4. Pri podobnom existujúcom recepte môžete výslovne zvoliť **Vytvoriť novú verziu existujúceho receptu**, vybrať cieľ a potvrdiť zmenu. Cieľ musí byť aktívny a zodpovedať názvu alebo obsahu niektorej jeho verzie. Súbežne zmenený cieľ sa odmietne a treba obnoviť náhľad. Staré verzie, fotografie, várky a nákladové snapshoty zostanú zachované.
5. Kliknite **Importovať vybrané recepty**. Výsledok uvádza pridané recepty, nové verzie, preskočené, duplicitné a chybné položky. Odkaz **Zobraziť importované recepty** otvorí galériu filtrovanú na výsledné recepty.

Neplatný súbor neodstráni platné súbory z výberu. Neplatný recept je viditeľný s chybou a nedá sa vybrať. Chyba jednej položky neoznačí celý import za úspešný; ostatné potvrdené položky zostávajú uložené. Pri prerušení pripojenia obnovte náhľad: už spracované položky sa identifikujú zo Supabase a nepridajú sa znovu.

Rovnaký súbor s rovnakým `importId` a obsahom nevytvorí opakované recepty ani opakované verzie. Pri opätovnom nahratí sú spracované položky označené; potvrdenie bez nového výberu zobrazí prehľad preskočených položiek. Z toho istého nezmeneného súboru možno neskôr vybrať pôvodne nevybrané recepty. Zmenený obsah musí mať nové `importId`. To platí aj pre ďalšiu úmyselnú revíziu už spracovanej položky.

## Trhané mäso

`/recipes/pulled` načítava pôvodný denník operácií, novú evidenciu položiek a skutočné receptové verzie. Pred prvým importom ponúkne **Pridať 4 recepty**. Po pridaní zobrazí **4 recepty už boli pridané** a odkazy na aktuálne recepty vrátane používateľom premenovaných verzií. Archivované recepty sa označia a automaticky neobnovujú.

V galérii sa po pridaní nahradí pôvodná výzva filtrom **Trhané mäso**. Pri čiastočnom importe sa pridávajú iba chýbajúce recepty. Otvorenie stránky samo nič nezapisuje. Pôvodný „Sticky ginger pork“ sa nemení.

## Nová migrácia 008

Súbor: `supabase/migrations/202610150008_recipe_batch_import.sql`.

Migrácie 001–007 sa nemenia. Pred produkčnou aktiváciou skontrolujte projekt a zálohy. Migrácia pridáva iba:

- `recipe_import_sources`: úplný nemenný payload podľa používateľa a `importId`;
- `recipe_import_items`: výsledok spracovanej položky a väzbu na recept/verziu;
- vlastnícke SELECT RLS a nové validačné/importné funkcie.

Nové tabuľky nemajú priame používateľské write oprávnenia. `import_recipe_item` overí autentifikáciu, zdroj, výber, vlastníctvo cieľa, aktuálnosť verzie a duplicity. Advisory lock serializuje importy jedného používateľa aj medzi rôznymi súbormi. Každá vybraná položka sa zapisuje transakčne; chyba vráti späť aj jej rezerváciu zdroja. Už úspešné položky sa pri chybe inej položky nemažú.

**Existujúce `import_recipes` ani `revise_recipe` sa nemenia.** Nová obálka ich používa na skutočný zápis. Pôvodné `importId` rezervuje s celým payloadom, čím aj starý RPC replay zabráni duplicitnému zápisu čiastočne spracovaného súboru. Preto samotný záznam v `operation_requests` nemusí pri novom importe znamenať dokončenie všetkých položiek: nové UI najprv overuje novú evidenciu. Pôvodné celosúborové importy bez tejto evidencie zostávajú rozpoznané ako už spracované. Pri nich sa tolerujú staršie vynechané voliteľné predvolené polia, ale nie zmenený obsah.

Podobnosť názvu ignoruje veľkosť písmen, diakritiku a nadbytočné medzery. Obsah zahŕňa porcie, suroviny s množstvami/jednotkami, poradie krokov, skladovanie, zohrievanie, mäso, mrazenie a kuchárske metadáta; poradie surovín sa ignoruje. Samotná podobnosť nikdy neoprávňuje na prepísanie. Obrázkové referencie zostávajú iba čakajúcimi referenciami; žiadne fotografie sa automaticky nesťahujú ani nenahrádzajú.

### Aktivácia v cloudovom Supabase

Produkčné DDL sa neaplikuje automaticky pri Git/Vercel deployi. Po schválení otvorte projekt → **SQL Editor → New query**, vložte celý nový súbor **008** a kliknite **Run**. Na konci majú byť `import_sources_ready=true` a `import_items_ready=true`. Súbor je určený na jedno vykonanie; pri chybe ho neopakujte naslepo a nemažte tabuľky.

Po aktivácii obnovte aplikáciu. Zobrazenie stavu už existujúcich šablón podporuje aj databázu pred 008; nový selektívny import však bez 008 zostane zablokovaný s pravdivým oznámením. Žiadny servisný kľúč ani nová platená služba nie sú potrebné.

## API a overenie

`POST /api/recipes/import` vyžaduje vlastnú prihlásenú reláciu a platný Origin:

- `action:preview`, `files:[{name,data:<obálka 1.0>}]`: read-only náhľad a skutočný stav zo Supabase;
- `action:apply`, rovnaké `files`, `choices:[{key,file,index,mode,target,confirmed}]`: najviac 20 vybraných položiek na požiadavku. Jedno hlavné tlačidlo automaticky spracuje väčší výber po častiach. `mode:version` vyžaduje potvrdenie a UUID konkrétnej aktuálnej verzie.

Lokálne testy: `npm test`, `npm run test:db`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run build`. Databázové testy odmietajú cloudový projekt. Izolovaný test migrácie porovnáva pôvodné RPC aj existujúce recepty, skladové pohyby a finančné snapshoty pred/po 008. E2E pokrývajú 360, 390, 768, 1280 a 1440 px, 12 receptov a replay, viac súborov, novú verziu so súhlasom, chyby, drag & drop a stav pôvodne importovaných používateľsky upravených šablón.
