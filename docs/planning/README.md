# Jedálniček, nákupy a špajza – míľnik 009

## Prvé použitie

1. Otvorte **Jedálniček** (`/meal-plan`). Týždeň je pondelok až nedeľa, šípkami možno prejsť na iné týždne. Na mobile sú dni v samostatných kartách s odkazmi na konkrétny deň; desktop má sedem stĺpcov.
2. **Pridať jedlo** alebo **Navrhnúť týždeň**. Generátor umožňuje 1–14 dní, osoby, jedlá denne, prioritu, dni varenia/hotového jedla, veľkosť plánovanej várky, voliteľnú samostatnú prílohu a orientačný rozpočet. Tvrdé zákazy sú doslovné normalizované názvy/výrazy, vrátane základných druhov mäsa, nie automatická kompletná alergénová klasifikácia.
3. Skontrolujte celý náhľad a potvrďte. Nové záznamy sa pridávajú k existujúcim; generovanie nevymaže pôvodný plán. Uložiteľné nastavenia sú oddelené od mäkkých preferencií v **Moje chute**.
4. **Vymeniť jedlo** otvorí samostatný výber s vyhľadávaním, fotografiami, dostupnými mrazenými jedlami a prekvapením. Potvrďte recept, dátum, slot a porcie. ID záznamu zostane zachované. Odkaz na recept z plánu alebo nákupu otvára čítací detail konkrétnej nemennej verzie (`/meal-plan/recipe/[versionId]`), ktorý zostane funkčný aj po archivácii receptu; aktuálny editor sa tým nemení. Možno aj presúvať, kopírovať jedlo, kopírovať týždeň dopredu alebo prevziať minulý týždeň.
5. **Vytvoriť nákup** → **Nákup z týždňa**, prípadne samostatne **Viac → Nákupy a špajza → Nový meal prep nákup**. Nastavte recepty a porcie.
6. Pri známych hotových porciách výslovne nastavte, koľko použijete z mrazničky. Evidencia samotných gramov neoprávňuje odhadnúť porcie. Všetky alokácie sú návrhom, nie rezerváciou. Pred varením znova skontrolujte aktuálnu dostupnosť.
7. **Prepočítať ingrediencie – náhľad** → **Prijať prepočet**. Pri zmene receptov/porcií treba prepočet potvrdiť pred uložením. Manuálne položky zostanú. Pri výmene receptu z kalendára možno v náhľade výslovne zvoliť synchronizáciu kalendára; vykoná sa transakčne pri uložení plánu. Zrušenie náhľadu výmenu neuloží.
8. Upravte nákupné množstvá alebo rozbaľte **Nákupné balenie** a zadajte reálny obsah balenia a minimálny počet balení. Tieto údaje sú používateľské, nie automaticky získané z Rohlíka. Potvrdenie ukáže počet balení a prebytok.
9. **Uložiť nákupný plán**. Neuložené úpravy sú označené; pri obnovení stránky prehliadač upozorní na ich možné zahodenie. Až úspešné uloženie garantuje zachovanie po obnovení. Zoznam možno kopírovať, exportovať do TXT/CSV alebo pripraviť české zadanie pre Rohlík/ChatGPT. **JSON zadanie pre ChatGPT** uloží štruktúrovaný súbor `freezer-rohlik-zadanie.json` s formátom `freezer.shopping-task` verzie 1.0: požadované množstvá a jednotky, pôvodné receptové verzie, používateľské balenia a podmienky potvrdenia. Nakúpené položky sa do zadania nezahrnú. Produktové ID, aktuálne ceny a dostupnosť zostávajú `null`, kým ich autorizovaný asistent nezistí. Pripojte súbor v ChatGPT so zapnutým oficiálnym Rohlík MCP; žiadne pripojenie FREEZER OS tým nevzniká. Priamy košík FREEZER OS zatiaľ nemení.
10. Po nákupe nahrajte účtenku v **Food Cost → Účtenky** a potvrďte skutočné položky. V nákupnom pláne vyberte potvrdenú účtenku a uložte väzbu. Táto väzba nevytvára druhý nákupný výdavok.

## Čo sa počíta

`recipe_quantity × planned_portions / recipe_portions`. Pri explicitnom použití hotových porcií sa suroviny počítajú iba na zvyšné porcie; generované plánované várky môžu byť väčšie než aktuálne jedené porcie. Nejde o záznam skutočného dovarenia.

Rovnaká normalizovaná ingrediencia v rovnakej jednotke sa zlúči a zachová pôvodné receptové verzie. Potvrdené aliasy možno upraviť v **Potvrdené názvy surovín**. Alias je priamym mapovaním na spoločný názov, nie prepočtom fyzikálnych jednotiek ani automatickým jazykovým odhadom. Gramy, mililitre a kusy sa nikdy automaticky nezamieňajú.

Odpočítajú sa iba ručne evidované alebo výslovne prevzaté suroviny v špajze s rovnakou jednotkou a bez prekročeného uvedeného dátumu spotreby. Neznámy dátum sa nevymyslí. Účtenka sama o sebe nie je dostupný sklad. Hotové balíčky zostávajú oddelené.

Pri prepočte sa zachovávajú manuálne položky, používateľské úpravy množstva, výbery balení a označené zakúpené položky. Ak požiadavka zanikla, ale mala potvrdený výber alebo bola označená ako nakúpená, zostane s nulovou receptovou potrebou a zobrazí sa konflikt. Používateľ musí výber/množstvo skontrolovať. Prepočet nie je tichým zmazaním fyzického nákupu.

Orientačný náklad receptových surovín používa iba potvrdené vlastné historické ceny s mapovaním ingrediencie a porovnateľnou jednotkou. Je zobrazený oddelene od ceny nákupných balení, manuálnych položiek a zaplatenej účtenky. Ak ceny chýbajú, odhad alebo rozdiel zostáva neznámy; rozpočet vtedy nemožno overiť. Ekonomická priorita je heuristické zvýhodnenie známych lacnejších receptov, nie garancia globálne najlacnejšieho košíka.

Alkohol a drogéria majú vlastné kategórie, zostávajú v súčte účtenky a nevstupujú do potravinového Food Cost. Staré kategorizácie sa nemenia. Pôvodný databázový `kind=equipment` sa využíva ako kompatibilná trieda mimo potravín; samostatné rozlíšenie zabezpečuje ID kategórie.

## Prevzatie účtenky do špajze

Sekcia **Prevziať skutočný nákup do špajze** vyžaduje výslovný výber fyzicky dostupných položiek a potvrdenie. Ponúka len potraviny s mapovanou ingredienciou, kladným známym množstvom v g/kg/ml/l/ks a nezápornou sumou. kg sa presne prevádza na g, l na ml. Neznáme balenia, refundácie a nepotravinové položky sa automaticky nepreberajú.

Jedna účtenka sa prevezme najviac raz; nevybrané položky treba pridať ručne. Ledger je viazaný na stabilný identifikátor účtenky, takže ani jej neskoršia korekcia nepovolí dvojitý príjem. Snapshot uchováva pôvodné položky a ID vytvorených domácich zásob. Oprava alebo storno účtenky nemení automaticky fyzickú špajzu. Expiráciu a skutočný zostávajúci stav nastaví používateľ.

## Stav, oprávnenia a súbežnosť

Stavy nákupu: draft, ready, exported, partially_purchased, purchased, closed, cancelled. Exportované a nakúpené návrhy nepovoľujú zmeny receptov, množstiev a balení; použite doplnkový nákup. Označenie už kúpených položiek je možné pri aktívnom exportovanom/čiastočne nakúpenom pláne. Uzavretý alebo zrušený zoznam ostáva zamknutý.

Receptové väzby vedú na nemenné verzie. Jedlá majú revízie; nákupný plán má vlastnú revíziu a súvisiace riadky sa ukladajú transakčne. Každá mutácia má request UUID a kontrolu vlastníka. Bezpečnostné RPC používajú owner advisory lock, row locks, `search_path=''`, RLS a audit. Konflikt revízie vyžaduje obnovenie stránky. Dva nezávislé vedomé príkazy pridať nové jedlo sú dve samostatné operácie; nejde o rezerváciu celého týždňa.

`POST /api/planning`: actions `meals`, `shopping`, `pantry`, `settings`, `alias`, `receive`. Cookie auth, same-origin kontrola, Zod validácia. API nezapisuje do `inventory_packages`, skladových pohybov ani historických batch snapshotov. Zmena kalendára z nákupu je súčasťou jednej databázovej transakcie; konflikt kalendára vracia späť aj uloženie nákupného plánu.

## Rohlík

Pozrite [výsledok discovery](./rohlik-discovery.md). HTTP/OAuth a funkcie sú dokumentované dodaným oficiálnym textom; tools/list, vlastná registrácia, token refresh a živý košík neboli overené. Stav je **Rohlík nie je pripojený**. Tokeny sa nežiadajú ani neukladajú. Funkčný je export a zadanie pre autorizovaného asistenta alebo manuálny nákup. Objednávku vždy potvrdzuje používateľ na Rohlíku.

## Aktivácia produkcie

Súbor: [`supabase/migrations/202610150009_planner_shopping.sql`](../../supabase/migrations/202610150009_planner_shopping.sql). Migrácie 001–008 sú bez zmien.

1. Pred schválením si prezrite SQL. V tomto prostredí nemáme administrátorský prístup k produkcii a nemôžeme overiť stav produkčnej zálohy. V Supabase **Database → Backups** overte dostupnú zálohu alebo svoj overený export pred spustením DDL.
2. Overte správny projekt **vhjuweumaaysfklkitfi**, nie iný otvorený projekt: https://supabase.com/dashboard/project/vhjuweumaaysfklkitfi/sql/new . Kontrola základov: `select to_regclass('public.recipes'),to_regclass('public.purchase_receipts');` Oba výsledky musia obsahovať názov tabuľky.
3. Až po výslovnom schválení spustite celý súbor 009 ako jeden dotaz. Nespúšťajte staré migrácie ani reset. Súbor používa `BEGIN/COMMIT`, `lock_timeout=5s`, `statement_timeout=60s`. Pridanie stĺpcov a kontrolných obmedzení krátko vyžaduje zámok `meal_plan_entries`; pri prekročení timeoutu sa celá transakcia vráti späť. Nikdy nenechávajte čiastočne vybraný SQL úsek.
4. Záverečný SELECT musí vrátiť `shopping_ready=true`, `pantry_ready=true`, `planner_ready=true`. Obnovte aplikáciu. Pred aktiváciou nových tabuliek aplikácia zobrazuje požiadavku na migráciu namiesto predstierania úspechu.

Dodatočná kontrola:

```sql
select
  to_regprocedure('public.save_shopping_plan(uuid,jsonb)') is not null as shopping_rpc,
  to_regprocedure('public.receive_receipt_pantry(uuid,uuid,jsonb)') is not null as pantry_receipt_rpc,
  (select count(*)=2 from public.purchase_categories where id in ('alcohol','drugstore') and kind<>'food') as nonfood_categories;
```

Migrácia pridáva iba nové entity a stĺpce. Jedinou úpravou existujúceho RPC `save_purchase` je nahradenie pevného zoznamu povolených kategórií kontrolou katalógu. Pred nahradením funkcie migrácia overí checksum pôvodného tela z 007. Ak sa produkčné RPC líši, zastaví sa s `PURCHASE_RPC_CHANGED` a celá transakcia sa vráti späť; treba skontrolovať lokálnu úpravu, nie vypnúť kontrolu. Signatúra a účtovné výpočty zostávajú rovnaké; izolovaný test overuje presne tento rozdiel a zhodu všetkých ostatných pôvodných RPC aj existujúcich skladových a nákladových dát.

## Overenie vývoja

`npm test`, `npm run test:db`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run build`. Použiť výhradne lokálny Supabase cez existujúce skripty; testy vytvárajú dočasných používateľov a izolovanú databázu, nie produkčné nákupy. DB testy pokrývajú súbežné úpravy, idempotenciu, dva RLS účty, immutable export, presnú zmenu pôvodného purchase RPC, fyzický príjem účtenky najviac raz a zachovanie historického skladu. E2E pokrývajú 360, 390, 768, 1280 a 1440 px.
