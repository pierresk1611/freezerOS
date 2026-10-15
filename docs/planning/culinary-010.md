# Oprava kulinárskeho plánovania (010)

Rola receptu je verziovaná v `recipe_versions.metadata`: `unknown`, `main`, `complete`, `side`, `vegetable_side`, `component`, `breakfast`, `snack`. `allowed_slots` explicitne povoľuje sloty. Kategória prípravy sa používa samostatne. Nezatriedený recept nikdy nevstúpi do automatického návrhu. Manuálny výber vyžaduje vedomé povolenie používateľa.

Na `/meal-plan/roles` používateľ potvrdí návrhy. Tie sa opierajú o obsah pôvodných 19 šablón, nie o všeobecné rozpoznávanie názvov. Úprava surovín alebo postupu vyžaduje ručné zatriedenie. Potvrdenie vytvorí novú verziu; staré verzie a historické várky sa nemenia. Hlavný recept má `side_policy` a explicitný zoznam kompatibilných koreňových ID príloh. Recept s ryžou už v surovinách má predvolene návrh bez ďalšej prílohy. Alergény ani vhodnosť kombinácie systém neodvodzuje ako istotu.

Jedlo má jednu hlavnú položku a prílohy v `meal_plan_components`. Každá položka odkazuje na nemennú verziu. Automatický návrh a RPC kontrolujú roly, sloty, kompatibilitu aj počet porcií. Vedome manuálne zvolený samostatný komponent zostáva možný.

`planned_cooking_batches` predstavujú iba plán: dátum varenia a výťažok. Rozdelenie výťažku medzi viac termínov sa kontroluje transakčne. Predvolené nastavenia sú 2 dni varenia a 6 porcií várky. Prvé varenie je v nedeľu pred vybraným týždňom. Skutočné hotové porcie sa používajú iba pri známom počte; gramy sa neprezentujú ako potvrdené porcie. Plán nikdy neodpisuje sklad.

Nákup z týždňa započíta výťažok každej plánovanej várky raz vrátane príloh. Spoločné suroviny agreguje existujúci shopping engine. Staré neprepojené `batch_portions` sa nezlučujú odhadom. Potvrdené nákupy a ich položky sa pri výmene nemenia; dostanú príznak na kontrolu. Zápis do kalendára cez starý nákupný editor je pre kombinované jedlá zablokovaný, aby nezahodil prílohy. Upravte ich v jedálničku a vytvorte nový/doplnkový nákup po porovnaní.

## Bezpečná oprava existujúceho týždňa

1. Po aktivácii 010 otvorte **Jedálniček → Zatriediť recepty a prílohy**, skontrolujte návrhy, vyberte sloty a kompatibilné prílohy, potvrďte vybrané roly.
2. Otvorte chybný týždeň. Pôvodné záznamy zostávajú zobrazené s upozornením pri neplatnej/neznámej role.
3. Použite **Vymeniť**, alebo označte chyby checkboxmi a zvoľte **Navrhnúť týždeň → Nahradiť označené jedlá**. Kompletný reset cez nahradenie celého týždňa vyžaduje samostatné potvrdenie rozdielov.
4. Skontrolujte náhľad. Náhrady zachovávajú logické ID, dátum a slot; pri ručnej výmene aj počet porcií. Záznam napojený na nákup nemožno odstrániť; vymeňte recept pri zachovaní ID. Nákup potom skontrolujte osobitne.
5. Opakované **Doplniť iba prázdne sloty** už obsadené jedlá nemení.

## Migrácia a overenie

Spustite iba `supabase/migrations/202610150010_culinary_planner.sql`, po schválení, v správnom projekte `vhjuweumaaysfklkitfi`. Skript bol overený nad izolovanou databázou 001–009 aj historickou várkou. Produkčné dáta ani dostupnosť zálohy nemožno z lokálneho prostredia overiť; pred spustením skontrolujte zálohu v Supabase. `ALTER TABLE` potrebuje krátky exkluzívny zámok na `meal_plan_entries` a `shopping_plans`; limit čakania je 5 sekúnd, celá transakcia 60 sekúnd. Pri prekročení sa transakcia zruší. Nie je potrebný reset ani opakovanie 001–009.

Záverečný SELECT v skripte musí vrátiť `components_ready`, `planned_batches_ready`, `roles_ready` = true. SQL vytvára iba nové tabuľky/stĺpce a autorizované funkcie; nespúšťa kategorizáciu receptov ani opravu používateľovho týždňa. RLS, revízie, vlastníctvo a idempotencia sú kontrolované databázou. Súbežná úprava tej istej revízie má jedného úspešného zapisovateľa.
