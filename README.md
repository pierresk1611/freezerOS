# FREEZER OS

Slovenská aplikácia na správu domáceho jedla. Next.js App Router, React, TypeScript strict, Tailwind, React Hook Form, Zod a Supabase Auth/PostgreSQL.

## Aktuálny funkčný míľnik

Prihlásenie → vytvorenie/import receptu → uvarená várka → rovnako veľké balíčky → presun medzi lokáciami → čiastočná konzumácia → skladový pohyb a história. Desktop používa bočný panel, mobil spodnú navigáciu a karty. Dashboard číta databázu; neznáme ceny a výživa zostávajú neznáme. Základný výber „Prekvap ma“ berie dostupnosť, dátum a 14-dňovú históriu. Nie je zatiaľ kompletným odporúčacím algoritmom zo zadania.

## Vývoj v cloudovom prostredí

Node.js 24, npm a Docker. Použite existujúci checkout `/workspace/freezerOS`; nevytvárajte ďalší worktree.

```sh
cd /workspace/freezerOS
npm ci --cache /workspace/.npm-cache
npm run db:start > /tmp/freezer-supabase-start.log 2>&1
npm run db:migrate
npm run dev:local
```

`db:start` používa menšie oficiálne obrazy Supabase, aby sa zmestili do cloudového stroja. Pri prvom spustení aplikuje migrácie. `dev:local` získava lokálne kľúče zo stavu CLI, bez ich tlačenia. Skripty testov odmietnu cloudovú databázu. Štartovací helper opravuje zistenú chybu BusyBox wget, ktorý ignoruje no_proxy: jeho presná lokálna kontrola Auth používa priamu loopback cestu. Externá proxy a overovanie TLS sa nemenia. Readiness sa ďalej overuje cez skutočné API.

Lokálne API je dostupné na porte 54321 a PostgreSQL na 54322. Vývojový Next.js beží na porte 3000. Log spustenia Supabase môže obsahovať lokálne kľúče; nezverejňujte ho.

Existujúca databáza sa neresetuje automaticky. `npm run db:reset` je deštruktívny lokálny príkaz; používajte ho len pre zahoditeľné vývojové dáta.


Pre vlastný lokálny účet zadajte e-mail a heslo bezpečne v termináli (heslo sa nezobrazuje ani neukladá do histórie):

```sh
read -r FREEZER_LOCAL_EMAIL
read -rs FREEZER_LOCAL_PASSWORD
export FREEZER_LOCAL_EMAIL FREEZER_LOCAL_PASSWORD
npm run user:create
unset FREEZER_LOCAL_PASSWORD FREEZER_LOCAL_EMAIL
```

Príkaz vytvorí potvrdený účet iba v lokálnom Supabase. Produkčný účet vytvorte v administrácii svojho projektu.

## Pripojenie k vášmu Supabase projektu

Skopírujte `.env.example` do `.env.local`, nastavte verejnú URL projektu a publikovateľný kľúč. Súbor je ignorovaný Gitom. Nikdy nepoužívajte service-role kľúč v klientovi.

1. V Supabase SQL Editore spustite migrácie z `supabase/migrations` v poradí podľa názvu. Prípadne použite Supabase CLI s administrátorským prístupom a `supabase db push` po bezpečnom prepojení projektu.
2. V Auth vytvorte používateľa s potvrdeným e-mailom. Verejný registračný formulár zatiaľ nie je implementovaný.
3. Spustite `npm run dev`, prihláste sa a pridajte recept.
4. Pre skenovateľné QR odkazy nastavte `NEXT_PUBLIC_APP_URL` na HTTPS URL aplikácie. Súčasný export je PNG samotného QR kódu, nie kompletný tlačový štítok.

Publikovateľný kľúč neposkytuje oprávnenie meniť schému. Zástupný text `[YOUR-PASSWORD]` nie je databázové heslo. Administrátorské kľúče zadávajte bezpečne v nastaveniach prostredia.

## Overenie

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db
FREEZER_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Posledné dva príkazy vyžadujú bežiaci lokálny Supabase. Testy si vytvárajú samostatných dočasných používateľov a následne ich odstránia. Na stroji bez Chromia použite `npx playwright install --with-deps chromium` a vynechajte `FREEZER_CHROMIUM_PATH`. E2E preverujú reálny proces pri 360, 390, 768, 1280 a 1440 px. CI spúšťa rovnaké kontroly. Stav kontroly v GitHub Actions sa dá overiť až po odoslaní commitu.

## Databáza a finančné pravidlá

Recept má samostatnú nemennú verziu. Úprava vytvorí ďalšiu verziu; súbežná úprava zo zastaranej verzie sa odmietne. Duplikovanie vytvorí samostatný recept. Archivácia skryje recept zo zoznamu a zachová históriu. Várka odkazuje na konkrétnu verziu; balíčky nesú historicky pridelenú cenu. Sumy sú `bigint` v halieroch CZK. Náklady sa medzi balíčky delia so zachovaním každého haliera. Čiastočná konzumácia používa rozdiel zaokrúhlených kumulatívnych alokácií; cena všetkých odpisov sa rovná pôvodnej cene balíčka. Neznáma cena je `NULL`.

RLS obmedzuje čítanie na vlastníka. Priame zápisy do zásob, histórie, receptových verzií a finančných snapshotov nie sú povolené. Zmeny idú cez RPC s kontrolou používateľa, transakciou a idempotency ID. Opätovné použitie ID s iným obsahom sa odmietne. Odpis uzamkne balíček cez `FOR UPDATE`; záporný sklad je zakázaný aj databázovým constraintom. Presun zapíše nulový hmotnostný pohyb s pôvodnou a novou lokáciou.

## Čo ešte nie je dokončené

Toto je prvý vertikálny míľnik, nie celý systém zo zadania. Nasledujú: katalóg ingrediencií, kocky a porcie nezávislé od gramov, rozdielne balenia, plánovač, preferencie, plný odporúčací algoritmus, nutričné snapshoty, QR kamera a kompletné štítky, účtenky/OCR, Food Cost BI, nákupné zoznamy, ostatné AI importy, OpenAPI a nasadenie. Externé AI ani platby sa pri tomto míľniku nepoužívajú.

## Receptové šablóny a JSON import

Po prihlásení použite „Pridať 15 počiatočných receptov“. Vzniknú súkromné editovateľné šablóny, nie skladové zásoby ani finančné záznamy. [JSON šablóny](docs/seed-recipes.json) obsahujú úplné ingrediencie, postupy, zohrievanie a skladovanie. Výživa ani ceny sa nevymýšľajú. Nepovinné množstvá korenín v zadaní sú v šablónach doplnené ako upraviteľné kuchárske množstvá.

[Importná JSON schéma](docs/recipes.schema.json) dokumentuje podporovaný typ recipes. JSON môžete vložiť alebo nahrať, validovať, skontrolovať náhľad a až potom potvrdiť. Rovnaké importId nevytvorí duplicity. Ostatné importType zatiaľ nie sú implementované.

PWA má manifest, PNG ikonu a service worker s verejnou offline obrazovkou. Súkromné stránky ani odpovede API sa neukladajú do offline cache. Inštalácia na fyzickom telefóne ešte nebola overená.

## Rozhranie receptov

Katalóg `/recipes` obsahuje vyhľadávanie, filtre a galériu s jednou kartou na mobile a 2–3 stĺpcami na desktope. Karty obsahujú len prehľad a kontextové menu; žiadne editačné formuláre.

Detail `/recipes/[recipe_id]` zobrazuje aktuálnu verziu, suroviny, celý postup, skladovanie a zohrievanie. Známy Food Cost zobrazuje skutočné náklady poslednej várky tejto verzie, bez odhadovania ceny porcie. Neznáme údaje sa nevypĺňajú. ID v URL je stabilné ID receptu, nie meniace sa ID verzie.

Editor `/recipes/[recipe_id]/edit` ukladá novú verziu cez existujúce RPC. Podporuje dynamické suroviny, kroky a zmenu ich poradia. Pri chybe zachová rozpracovaný formulár. Nový recept a duplikácia používajú `/recipes/new`; JSON import je na `/recipes/import`.

Režim `/recipes/[recipe_id]/cook` zobrazuje veľké jednotlivé kroky. Dokončenie varenia samo nemení sklad. Zaevidovanie várky je na samostatnej stránke `/recipes/[recipe_id]/batch` a používa pôvodnú skladovú transakciu.

`RecipeMedia` prijíma zoznam `RecipePhoto` so signed URL, aby bolo možné v budúcnosti napojiť privátne fotografie zo Storage. Aktuálny dátový adaptér nevracia fotografie, ktoré nie sú uložené; používa označený neutrálny placeholder. Nahrávanie fotografií nie je súčasťou tohto redesignu. Databázová schéma ani RLS sa nemenia.

E2E testy používajú samostatný port 3001 (možno zmeniť cez FREEZER_TEST_PORT), overujú celý receptový workflow aj skladový odpis pri šírkach 360, 390, 768, 1280 a 1440 px.

Fotografie receptov: [aktivácia súkromného Storage, upload a licencie](docs/photos/README.md). Nová migrácia `202610140004_recipe_photos.sql` je potrebná aj pre už existujúce recepty; ID a kuchárske verzie zachováva.

Trhané mäso a vákuové kocky: [aktivácia migrácie 005 a celý workflow](docs/pulled-cubes/README.md). Nové šablóny sa pridávajú výhradne potvrdením v `/recipes/pulled`, porciovanie nájdete v `/portioning`, mäkké preferencie v `/preferences` a základný plán v `/meal-plan`.
