# Import meal-prepu od AI

**Meal prepy → Importovať od AI** podporuje súbory JSON, viac súborov, drag & drop na počítači aj vloženie textu. Jeden dokument vytvorí jeden projekt. Pred potvrdením vidíte recepty, porcie, spoločný nákup a harmonogram. Checkboxmi vyberáte recepty. Rovnaké `importId` nikdy nevytvorí druhý projekt; ak už projekt existuje, zostanú zachované jeho neskoršie úpravy aj výber receptov. Zmenený obsah pod existujúcim ID sa odmietne. Nový plán potrebuje nové UUID.

## Autoritatívny formát

`docs/meal-prep-import.schema.json` je zdrojom **runtime Zod validácie** (`z.fromJSONSchema`), nie iba dokumentačná kópia. `format` je `freezeros.mealprep.v1`. Pôvodný receptový import FREEZER OS 1.0 sa nemení. Verejné kópie schémy, príkladu a zadania sú na `/api/meal-preps/schema`, `/api/meal-preps/example`, `/api/meal-preps/prompt`.

Povinné polia projektu: `importId` (UUID), `name`, `description`, `days` (1–14), `target_portions` (cieľ hlavných porcií, nie súčet hlavných jedál a príloh), `cooking_date` (YYYY-MM-DD), `recipes`, `timeline`. Jeden súbor má najviac 50 receptov a 3,5 MB v UI. Viac súborov vytvorí samostatné projekty; jednotlivé výsledky sú zobrazené oddelene.

Každý recept má jedinečný lokálny `key`, plný existujúci objekt `recipe`, `planned_portions`, `allergens`, `compatible_sides`, `preservation` a `portioning`. Množstvá sú v **g, ml alebo ks**, bez domýšľania hustoty. `recipe.portions` označuje výťažnosť pôvodného receptu, `planned_portions` množstvo plánované v projekte. Nákup sa škáluje ich pomerom. Neznáma hmotnosť výsledku sa vynechá; voliteľné `yield_g` je návrh výťažku pôvodného receptu, nikdy potvrdené meranie.

`recipe.meal_role`, `allowed_slots` a `side_policy` sú povinné. Hlavné jedlo a prílohy sa prepájajú lokálnymi kľúčmi cez `compatible_sides`. Importér pre nové recepty preloží tieto odkazy na skutočné vlastné ID knižnice. Na rozdiel od príloh môže byť `complete` samostatným obedom či večerou. Nezatriedený existujúci recept zostáva mimo automatického návrhu. Príprava, aktívny čas, pečenie a teplota sa uvádzajú iba ak sú známe; orientačné časy nezaručujú bezpečné prepečenie.

`preservation` obsahuje individuálne `cooling`, `freezing`, `vacuuming`, `thawing`. Ohrev a základné skladovanie patria do `recipe.reheating` a `recipe.storage`. `portioning.mold_ml` sú odporúčané objemy foriem, `description` vysvetlí skutočné váženie a balenie; `cubes_per_package` je voliteľný návrh. **250 ml ≠ 250 g.** Šalát s majonézou sa nemá označiť ako vhodný na mrazenie. Všeobecných 90 dní sa nesmie uvádzať ako univerzálna bezpečnostná hranica. Pokyny od AI musí používateľ skontrolovať podľa skutočných surovín a pracovných podmienok.

`allergens` sú deklarácia autora; prázdne pole nie je zárukou bezalergénnosti. Overte značky a krížovú kontamináciu. Voliteľný `source_url` musí byť HTTPS. Voliteľné `recipe.imageReferences` zachovávajú existujúcu schému zdroja, autora a licencie. Obrázky sa automaticky nesťahujú; zostávajú na kontrolu v existujúcom module fotografií.

`timeline` obsahuje jedinečný `key`, `label`, `start_minute` (relatívne minúty), `duration_minutes` a zoznam `recipe_keys`. Pri vynechaných receptoch sa nezobrazujú nesúvisiace úlohy. Pri výmene receptu sa starý harmonogram označí na kontrolu; pôvodné AI pokyny sa neprenášajú na nové jedlo.

Voliteľný `meal_plan` obsahuje `day_offset` od dátumu varenia, `slot`, `main`, `sides`, `portions`. Import ho **nepridáva automaticky** do kalendára. V projekte kliknite **Pripraviť jedálniček — náhľad**, skontrolujte kombinácie a potvrďte. Obsadené sloty sa neprepisujú a opakované potvrdenie nevytvorí duplicity. Použijú sa plánované várky s výťažkom projektu; do skladu sa nič neprijíma. Pri použití staršej existujúcej verzie bez roly/kompatibility ju najprv zatriedite na `/meal-plan/roles` a potom v projekte výslovne vyberte novú verziu.

## Duplicity a uloženie

Používateľ vidí možné zhody podľa názvu aj obsahu. Zhodný recept možno použiť bez vytvorenia novej knižničnej kópie. Pri rovnakom názve a odlišnom obsahu treba vybrať existujúcu verziu alebo recept vynechať. Používateľské verzie sa automaticky neprepisujú. Pri vedomom použití odlišnej existujúcej verzie sa pôvodné AI pokyny a odhady nepriradia k inému jedlu.

Projekt a receptové referencie sa importujú transakčne. Nákup sa potom dokončí existujúcim shopping enginom. Pri výpadku medzi týmito krokmi zostane projekt zachovaný a UI ponúkne jeho otvorenie/uloženie; opakovaný import je bezpečný a dokončí chýbajúcu inicializáciu. Import sa nevydáva za úplný úspech, ak nákupný krok zlyhal.

Zmeny projektu a jeho nákupu sa ukladajú spolu s kontrolou revízie. Nákup sa pri zmene porcií, výmene či odobratí receptu okamžite prepočíta v náhľade. Kliknutím **Uložiť projekt a nákup** zmeny potvrdíte. Spoločné suroviny sa zlúčia, použiteľná špajza sa odpočíta, g a ml zostávajú oddelené. Ručné položky, označené nákupy a relevantné produktové výbery prežijú prepočet; konflikty sa zobrazia. Projektový nákup upravujte v projekte, nie druhým paralelným editorom `/shopping`. Po označení projektu ako nakúpeného sa recepty uzamknú; pre zmenu vytvorte doplnkový projekt.

## Skutočné varenie, zásoby a náklady

**Navariť — potvrdiť skutočný výťažok** a **Formy, vákuovanie a QR balíčky** otvárajú existujúce autorizované procesy. Zadáte skutočnú hmotnosť, porcie a balenia. Pri vybratej historickej verzii sa používa presne táto verzia. Po vytvorení várky ju možno výslovne prepojiť s projektom a potvrdiť reálny počet porcií. Toto prepojenie nevytvára druhý skladový príjem. Odkazy na skutočné balíčky vedú k existujúcim štítkom 50 × 30 mm v PNG/PDF. Priamu Bluetooth tlač implementácia nedeklaruje.

`estimated_cost_minor` je voliteľný **AI odhad za planned_portions** príslušného importovaného riadku v celých halieroch CZK. Zmena porcií ho škáluje; pri výmene za iný recept sa starý odhad odstráni. Chýbajúce ceny sa nikdy nepočítajú ako nula a čiastočné súčty sú označené. Žiadny odhad nevstupuje do nákupných výdavkov, historických snapshotov ani skutočného Food Cost. Potvrdenú účtenku možno prepojiť samostatne. Jej celková suma môže obsahovať aj ďalší tovar a nepredstavuje automaticky cenu porcií projektu.

## Aktivácia

Vyžaduje novú migráciu **011**, po **010**. Migrácie 001–009 sa nemenia. Pred schváleným spustením overte zálohu a správny projekt `vhjuweumaaysfklkitfi`. `011` vytvára prázdne tabuľky s RLS a nové RPC; triggery na existujúcich nákupných tabuľkách chránia iba nové projektové nákupy. Vytvorenie triggerov potrebuje krátky zámok na `shopping_plan_recipes` a `shopping_plan_items`; limit čakania je 5 sekúnd. Nevykonáva sa reset, spätná kategorizácia ani import dát. Záverečný SELECT musí vrátiť všetky tri hodnoty `true`.

## Prvý pokus

1. Otvorte **Viac → Meal prepy → Importovať od AI**.
2. Stiahnite a nahrajte vzorový JSON s tromi úplnými receptmi alebo skopírujte zadanie so schémou do ChatGPT.
3. Skontrolujte pokyny a duplicity, vyberte recepty a kliknite **Importovať vybrané meal-prepy**.
4. Otvorte uložený projekt. Zmeňte porcie, pridajte ručnú položku a uložte projekt aj nákup.
5. Až po nákupe nahrajte skutočnú účtenku. Až po varení potvrďte skutočný výťažok a balíčky v existujúcom porciovaní.
