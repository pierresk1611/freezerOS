# Trhané mäso, formy a vákuové kocky

## Aktivácia v cloudovom Supabase

Nová migrácia je **005**; pôvodné 001–004 sa nemenia. Najprv musí byť aktivovaná fotografická migrácia 004, pretože 005 rozširuje jej receptové funkcie a zachováva obrazové referencie.

1. V [Supabase SQL Editore](https://supabase.com/dashboard/project/vhjuweumaaysfklkitfi/sql/new) otvorte nový dotaz.
2. Skopírujte celý [súbor migrácie 005](https://github.com/pierresk1611/freezerOS/blob/main/supabase/migrations/202610140005_pulled_cubes.sql) cez **Raw** do dotazu. Kliknite **Run** raz. Nevkladajte žiadne heslá do chatu.
3. Po úspešnej migrácii počkajte na Vercel deployment najnovšieho commitu. Ak už nasadenie prebehlo pred migráciou, obnovte stránku; v prípade potreby Vercel → projekt FREEZER OS → **Deployments** → najnovší deployment → **Redeploy**.
4. Otvorte [šablóny](https://freezer-os.vercel.app/recipes/pulled). Skontrolujte všetky štyri recepty a až potom kliknite **Potvrdiť pridanie 4 receptov**. Import sa nikdy nespúšťa otvorením stránky ani migráciou.

Cloudovú migráciu agent nevykonal; chýba administrátorské databázové pripojenie. Produkčné nasadenie nie je potvrdené. Nové moduly pred migráciou zobrazia informáciu o aktivácii; staré recepty a zásoby zostávajú dostupné.

## Kompatibilita a riziko

Migrácia len pridáva nullable kuchárske metadáta, nové tabuľky a stĺpce. Staré várky dostanú stav `legacy`; nie sú automaticky preraďované do nového workflow, prebalené ani znovu prijaté. Existujúce fotografie, používateľské účty, receptové verzie, skladové pohyby, finančné hodnoty a FK ostávajú zachované. Receptové RPC majú rovnaké podpisy a idempotenciu, doplnené metadáta sa ukladajú vo verzii. RLS pohľad ostáva `security_invoker`.

DDL krátko zamyká upravované tabuľky a nahrádza tri receptové funkcie. Pred produkčným spustením skontrolujte dostupnú zálohu v Supabase; zvoľte čas, keď neprebieha aktívne varenie/import. Migráciu aplikujte celú ako jeden dotaz a neopakujte ju po úspechu. Nemá mazacie ani hromadné aktualizačné príkazy nad skladom. Samostatné vývojárske lokálne testy preukázali zachovanie pôvodných 15 šablón a historických väzieb.

## Recepty a chute

Štyri šablóny: Sticky Ginger Pulled Pork, Trhané hovädzie na červenom víne, Mexické Carnitas s kukuricou, BBQ Pulled Chicken. Všetky majú presné kuchárske množstvá, 6 plánovaných porcií, oddelené prílohy, úplné kroky, čas prípravy, rozsah pečenia a teplotu rúry. Skutočný výťažok sa vždy váži po varení. Žiadne nákupné ceny ani výživa nie sú vymyslené.

Sticky Ginger Pulled Pork je nový samostatný recept; Sticky ginger pork zostáva pôvodný. Identifikátor importu je nemenný a opakované potvrdenie nemení používateľské úpravy ani nezakladá kópie. Existujúci samostatne vytvorený recept s podobným názvom sa neprepíše.

`/preferences`: Moje chute, texty upraviteľné po riadkoch. Odstránenie položky ju vyradí zo skórovania; prázdny uložený zoznam znamená žiadne preferencie. Odporúčania stále najprv vyberajú existujúcu dostupnú zásobu. K pôvodnej naliehavosti a rôznorodosti pribúda maximálne 0,20 za mäkkú obľúbenosť; ostatné jedlá sa nevylučujú. Obľúbené názvy a suroviny sa porovnávajú bez rozlišovania veľkosti písmen, trhané mäso tiež podľa kategórie/druhu mäsa. Predvolené kombinácie rozpoznávajú prílohy z receptu; ich dostupnosť sa nepredstiera.

`/meal-plan` je základný 7-dňový plán: výber dňa, jedla, receptu a porcií, odstránenie položky. Ponuka je zoradená podľa mäkkých preferencií. Upozorňuje na nedostatočné/neevidované zásoby; pri starých balíčkoch neodhaduje počet porcií bez údajov. Plánovanie neodpisuje sklad. Pokročilé presúvanie, automatický harmonogram a anti-repeat plánovanie nie sú súčasťou tohto rozšírenia.

## Postup porciovania

1. Otvorte `/portioning` cez navigáciu **Porciovanie** alebo tlačidlo na detaile receptu.
2. Potvrďte skutočné vlastníctvo foriem. Predvoľba A: 4 × 250 ml (1 000 ml), B: 2 × 500 ml (1 000 ml). Opakované potvrdenie rovnakého typu a názvu nastaví deklarovaný počet, nevytvorí druhý záznam. Počet nemožno znížiť pod kapacitu aktívnych kociek. Vlastná forma umožňuje názov, počet priehradiek, ml/priehradku a počet fyzických foriem.
3. Vyberte recept, výslednú hmotnosť porciovaného obsahu a dátum výroby. Náklad nechajte prázdny, ak nie je známy. Ak prílohy balíte zvlášť, nezapočítavajte ich hmotnosť ani náklady do tejto várky.
4. Pre každú kocku vyberte vlastnenú formu, **skutočné gramy aj ml**. Možno kombinovať veľkosti a pri 250 ml explicitne potvrdiť naplnenie na 125 ml. Formulár nikdy neprepočíta ml na gramy. Každá priehradka môže obsahovať len jednu aktívnu kocku, objem nesmie prekročiť kapacitu.
5. Uložte várku s kockami. Súčet gramov musí zodpovedať výťažku. Vznikne stav `cooling`, zatiaľ bez balíčkov a skladového príjmu. Rýchlo schlaďte a zmrazte približne pri −18 °C.
6. Keď sú kocky úplne zmrazené, potvrďte dátum zmrazenia. Vznikne stav `frozen`; žiadny skladový príjem.
7. Po vybratí kociek z foriem priraďte každú práve jednému sáčku, zadajte reálny počet porcií v každom balíčku a spoločnú skladovú lokáciu. Náhľad spočíta gramy, balíčky, kocky a náklady. Prázdne sáčky sa nevytvárajú.
8. Potvrďte fyzické vákuovanie. Transakcia vytvorí finálne balíčky, ich UUID pre QR a presne jeden `receive` pohyb na balíček; stav várky `packed`. Opakované ani súbežné potvrdenie nedovolí druhý príjem. Formy sa uvoľnia pre ďalšie varenie.
9. Z mrazničky otvorte štítok, exportujte PNG/PDF. Naskenovanie QR otvorí správny balíček a samo neodpisuje zásobu.
10. Pri konzumácii zadajte skutočné gramy. Existujúca transakcia spotreby ostáva nezmenená; zobrazovaný zostatok porcií je pomer zostávajúcich gramov k pôvodnej hmotnosti.

Staré už prijaté várky nemožno týmto procesom prijať znovu. Ich spotreba, presuny a štítky fungujú ďalej. Hromadné prebalenie starých čiastočne spotrebovaných balíčkov je samostatná budúca funkcia.

## Hmotnostná a finančná bilancia

Várka 1 200 g: kocky 200 + 200 + 100 + 400 + 300 g, objemy 250 + 250 + 125 + 450 + 300 ml. Finálne balíčky 400, 500, 300 g: 2, 2, 1 kocka. Gramy a objemy zostávajú samostatné.

Celkový skutočný náklad sa zadáva v CZK, ukladá v celých halieroch. Každý balíček okrem posledného dostane `floor(batch_cost × package_weight / batch_weight)`, posledný dostane presný zostávajúci počet halierov. Finálna transakcia vyžaduje rovnosť hmotnosti, všetkých kociek aj nákladov. Pri neznámom náklade majú všetky balíčky `NULL`, nie nulu. Konzumácia využíva pôvodnú kumulatívnu zaokrúhlenú alokáciu, čím zachová finančný snapshot.

## QR štítky NIIMBOT B1

`/labels/[id]` → kompletný PNG (400 × 240 px, približne 203 dpi) alebo PDF s presnou stranou 50 × 30 mm. Obsahuje názov, celé ID, pôvodnú hmotnosť, pôvodné porcie, výrobu, zmrazenie, orientačný dátum kvality a QR s ochranným bielym okrajom. Neznáme údaje starších balíčkov sú označené, nevymýšľajú sa. Font DejaVu Sans je pribalený s licenciou v `assets/fonts`; text sa vykreslí ako vektorové obrysy pred rasterizáciou, takže export nezávisí od fontov operačného systému Vercelu. Pri skenovaní vždy platí aktuálny zostatok v aplikácii.

PDF tlačte na 100 %, PNG importujte do aplikácie NIIMBOT a zvoľte 50 × 30 mm. Priama Bluetooth tlač nie je implementovaná ani overená.

## Databáza a testy

`recipe_versions.metadata`, `food_preferences`, `portion_molds`, `batch_cubes`, `meal_plan_entries`; nové stavy/dátumy várky a údaje balíčka. Kocky aj sklad sa menia iba autorizovanými RPC, ktoré zamykajú várku a kapacitu formy. RLS vlastníctvo chráni všetky nové tabuľky a planner overuje vlastníctvo receptovej verzie.

Lokálne: `npm run db:migrate`, `npm run test:db` (pôvodné kontroly aj nové `test-cubes.mjs`), `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `FREEZER_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`.

Testy používajú lokálne náhodné účty a fixture náklady, nie produkčné údaje. Overujú starých 15 + nové 4, verziovanie metadát, dve formy, rozdielne objemy/hmotnosti, nesúlad, kapacitu, RLS, zmrazenie, duplicitnú kocku, chýbajúcu kocku, súbežné balenie, idempotenciu, finančnú bilanciu, konzumáciu, planner a čitateľnosť QR v exportovanom PNG. E2E šírky 360, 390, 768, 1280, 1440 px. Fyzické zariadenie NIIMBOT ani jeho Bluetooth neboli testované.
